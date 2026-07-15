import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
import { config, billingEnabled, mpBillingEnabled } from './config.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import { onlyDigits, isValidCPF, isValidCNPJ } from './cpf-cnpj.js';
import { slugify } from './slug.js';
import { generateBrailleCode } from './braille.js';
import {
  createEntryHandle,
  generateEntryCode,
  OPENING_SYMBOLS,
  MIDDLE_SYMBOLS,
  QUESTION_SYMBOLS,
} from './entry.js';
import { getPlanLimits } from './plans.js';

export { slugify };

mkdirSync(dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// Sob concorrência (vários webhooks simultâneos), uma escrita pode esbarrar em
// outra. busy_timeout faz a conexão ESPERAR até 5s pela trava em vez de falhar
// com SQLITE_BUSY na hora. synchronous=NORMAL é seguro com WAL e reduz muito o
// custo de fsync por commit (maior throughput de escrita sem risco de corrupção).
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

// --- Esquema base ---
db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  id                 TEXT PRIMARY KEY,
  email              TEXT UNIQUE NOT NULL,
  password_hash      TEXT NOT NULL,
  business_name      TEXT NOT NULL DEFAULT 'Meu Negócio',
  atendente_name     TEXT NOT NULL DEFAULT 'Ana',
  business_json      TEXT NOT NULL DEFAULT '{}',
  checkout_url       TEXT NOT NULL DEFAULT '',
  wa_phone_number_id TEXT UNIQUE,
  wa_token           TEXT,
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wa_phone        TEXT NOT NULL,
  name            TEXT,
  stage           TEXT NOT NULL DEFAULT 'novo_contato',
  buy_intent      TEXT NOT NULL DEFAULT 'baixa',
  summary         TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, wa_phone)
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);

CREATE TABLE IF NOT EXISTS catalog_files (
  tenant_id   TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL DEFAULT 'catalogo.pdf',
  content     BLOB NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_contact ON contact_notes(contact_id);

CREATE TABLE IF NOT EXISTS customer_routes (
  phone      TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wa_tokens (
  token      TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS message_media (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  filename   TEXT,
  content    BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_message_media_tenant ON message_media(tenant_id);

CREATE TABLE IF NOT EXISTS inbound_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  provider          TEXT NOT NULL DEFAULT 'meta',
  external_event_id TEXT NOT NULL,
  tenant_id         TEXT NOT NULL,
  payload_json      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  attempts          INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   TEXT NOT NULL DEFAULT (datetime('now')),
  locked_at         TEXT,
  processed_at      TEXT,
  last_error        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, external_event_id)
);
CREATE INDEX IF NOT EXISTS idx_inbound_events_status ON inbound_events(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS sales (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id          INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'rascunho',
  amount              REAL,
  total_cents         INTEGER,
  items               TEXT,
  items_json          TEXT,
  mp_preference_id    TEXT,
  mp_payment_id       TEXT,
  checkout_url        TEXT,
  payment_provider    TEXT,
  external_payment_id TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_tenant ON sales(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_contact ON sales(contact_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash  TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tenant ON password_reset_tokens(tenant_id);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash  TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_verification_tenant ON email_verification_tokens(tenant_id);

-- Eventos de conversão da landing/cadastro (medição first-party, anônima).
-- session_id é um uuid aleatório do navegador — NUNCA dados pessoais aqui.
CREATE TABLE IF NOT EXISTS conversion_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  session_id  TEXT,
  path        TEXT,
  referrer    TEXT,
  utm_source  TEXT,
  utm_medium  TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term    TEXT,
  props_json  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conversion_events_name ON conversion_events(name, created_at);
`);

// --- Migracoes leves: adiciona colunas novas se ainda nao existirem ---
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const tenantColumnsBeforeMigrations = db.prepare(`PRAGMA table_info(tenants)`).all();
const hadEmailVerifiedAtColumn = tenantColumnsBeforeMigrations.some((c) => c.name === 'email_verified_at');
const hadOnboardingCompletedAtColumn = tenantColumnsBeforeMigrations.some((c) => c.name === 'onboarding_completed_at');

ensureColumn('tenants', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('tenants', 'subscription_status', "TEXT NOT NULL DEFAULT 'trialing'");
ensureColumn('tenants', 'trial_ends_at', 'TEXT');
ensureColumn('tenants', 'stripe_customer_id', 'TEXT');
ensureColumn('tenants', 'stripe_subscription_id', 'TEXT');
ensureColumn('tenants', 'notify_phone', 'TEXT');
ensureColumn('tenants', 'mp_access_token', 'TEXT');
ensureColumn('tenants', 'cep_origem', 'TEXT');
ensureColumn('tenants', 'melhor_envio_token', 'TEXT');
ensureColumn('tenants', 'plan', "TEXT NOT NULL DEFAULT 'essencial'");
ensureColumn('tenants', 'mp_preapproval_id', 'TEXT');
// Registro de consentimento (LGPD, Art. 8º — ônus da prova é do controlador):
// carimbo de quando o lojista aceitou os Termos de Uso / Política de Privacidade
// no cadastro. Nunca sobrescrito depois — é a prova do aceite original.
ensureColumn('tenants', 'terms_accepted_at', 'TEXT');
// Contas anteriores a esta migração são consideradas verificadas para não
// bloquear clientes existentes. Novos cadastros começam com NULL.
ensureColumn('tenants', 'email_verified_at', 'TEXT');
ensureColumn('tenants', 'onboarding_completed_at', 'TEXT');
// Última análise profunda da configuração. A nota permanece como referência
// oficial até o lojista executar uma nova análise após corrigir as pendências.
ensureColumn('tenants', 'setup_analysis_score', 'INTEGER');
ensureColumn('tenants', 'setup_analysis_json', 'TEXT');
ensureColumn('tenants', 'setup_analysis_at', 'TEXT');
// Contas que já existiam antes do onboarding persistente não devem ser forçadas
// a refazer os primeiros passos. Somente contas criadas após esta migração
// começam com NULL e são encaminhadas ao assistente.
if (!hadOnboardingCompletedAtColumn) {
  db.prepare(`UPDATE tenants
    SET onboarding_completed_at = COALESCE(created_at, datetime('now'))
    WHERE onboarding_completed_at IS NULL`).run();
}
if (!hadEmailVerifiedAtColumn) {
  db.prepare(`UPDATE tenants
    SET email_verified_at = COALESCE(created_at, datetime('now'))
    WHERE email_verified_at IS NULL`).run();
}

// Bling ERP (OAuth2) — sincroniza produtos/estoque e envia pedidos pagos para
// emissão de nota fiscal. access/refresh tokens cifrados (mesmo padrão de
// mp_access_token); expires_at em texto ISO pra decidir quando renovar.
ensureColumn('tenants', 'bling_access_token', 'TEXT');
ensureColumn('tenants', 'bling_refresh_token', 'TEXT');
ensureColumn('tenants', 'bling_token_expires_at', 'TEXT');
ensureColumn('tenants', 'bling_connected_at', 'TEXT');

// Nuvemshop (Tiendanube) — OAuth2, mesmo uso do Bling: sincroniza produtos/
// estoque (nunca expira, então sem refresh_token/expires_at).
ensureColumn('tenants', 'nuvemshop_access_token', 'TEXT');
ensureColumn('tenants', 'nuvemshop_store_id', 'TEXT');
ensureColumn('tenants', 'nuvemshop_connected_at', 'TEXT');

// Tray — OAuth2, expira e precisa de refresh_token (mesmo padrão do Bling).
// api_address é específico da loja (retornado na troca do code) — toda
// chamada subsequente usa essa base em vez de uma URL fixa.
ensureColumn('tenants', 'tray_access_token', 'TEXT');
ensureColumn('tenants', 'tray_refresh_token', 'TEXT');
ensureColumn('tenants', 'tray_token_expires_at', 'TEXT');
ensureColumn('tenants', 'tray_api_address', 'TEXT');
ensureColumn('tenants', 'tray_connected_at', 'TEXT');

// Google OAuth login — sub (google_id) é único por conta Google.
ensureColumn('tenants', 'google_id', 'TEXT');

// Hotmart — não é OAuth: o lojista cola o Hottok (token do webhook) gerado no
// painel do Hotmart. Cifrado como os demais tokens (encryptSecret).
ensureColumn('tenants', 'hotmart_hottok', 'TEXT');
ensureColumn('tenants', 'hotmart_connected_at', 'TEXT');

// Webhook genérico (Zapier/Make) — o lojista cola sua própria URL e recebe
// eventos (venda paga, novo contato, pedido de humano) assinados por HMAC.
ensureColumn('tenants', 'webhook_url', 'TEXT');
ensureColumn('tenants', 'webhook_secret', 'TEXT');
ensureColumn('tenants', 'webhook_enabled', 'INTEGER NOT NULL DEFAULT 1');

db.exec(`
  CREATE TABLE IF NOT EXISTS tenant_integrations (
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,
    access_token    TEXT,
    refresh_token   TEXT,
    expires_at      TEXT,
    external_id     TEXT,
    external_url    TEXT,
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    connected_at    TEXT,
    last_sync_at    TEXT,
    disconnected_at TEXT,
    PRIMARY KEY (tenant_id, provider)
  )
`);

ensureColumn('sales', 'bling_pedido_id', 'TEXT');
ensureColumn('sales', 'bling_push_status', "TEXT NOT NULL DEFAULT 'pendente'");
ensureColumn('sales', 'bling_push_error', 'TEXT');
// Melhor Envio — etiqueta / rastreio. Populados por src/melhorenvio.js
// (generateLabel). me_label_status: 'pendente' | 'gerada' | 'erro'.
ensureColumn('sales', 'me_order_id', 'TEXT');
ensureColumn('sales', 'me_tracking_code', 'TEXT');
ensureColumn('sales', 'me_label_url', 'TEXT');
ensureColumn('sales', 'me_label_status', "TEXT NOT NULL DEFAULT 'pendente'");
ensureColumn('sales', 'me_label_error', 'TEXT');
// Timestamp da 1ª vez que o rastreio foi enviado pelo WhatsApp pro cliente.
// Idempotência: mesmo com auto_send + retry, a mensagem sai só uma vez.
ensureColumn('sales', 'me_tracking_sent_at', 'TEXT');
ensureColumn('sessions', 'impersonated_by', 'TEXT');
ensureColumn('sessions', 'admin_token', 'TEXT');
ensureColumn('sessions', 'expires_at', 'TEXT');
ensureColumn('sessions', 'last_seen_at', 'TEXT');
ensureColumn('contacts', 'needs_human', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('contacts', 'follow_up_sent_at', 'TEXT');
ensureColumn('tenants', 'routing_slug', 'TEXT');
// Período de cobrança escolhido na assinatura self-service (mensal/semestral/
// anual, ver src/plans.js BILLING_PERIODS) — usado só pra exibição, o valor
// real cobrado já está fixado no preapproval do Mercado Pago.
ensureColumn('tenants', 'billing_period', "TEXT NOT NULL DEFAULT 'mensal'");
ensureColumn('messages', 'media_id', 'TEXT');
ensureColumn('tenants', 'route_code', 'TEXT');

// Handoff system — new columns for human handoff tracking.
ensureColumn('contacts', 'handoff_status', "TEXT NOT NULL DEFAULT 'none'");
ensureColumn('contacts', 'handoff_reason', 'TEXT');
ensureColumn('contacts', 'handoff_requested_at', 'TEXT');
ensureColumn('contacts', 'handoff_started_at', 'TEXT');
ensureColumn('contacts', 'handoff_resolved_at', 'TEXT');
ensureColumn('contacts', 'handoff_notified', 'INTEGER NOT NULL DEFAULT 0');

// Off-topic protection columns.
ensureColumn('contacts', 'off_topic_count', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('contacts', 'off_topic_window_started_at', 'TEXT');
ensureColumn('contacts', 'off_topic_muted_until', 'TEXT');

// AI rate limiting columns (per-contact windows).
ensureColumn('contacts', 'ai_calls_10min', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('contacts', 'ai_window_10min_started_at', 'TEXT');
ensureColumn('contacts', 'ai_calls_day', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('contacts', 'ai_window_day_started_at', 'TEXT');

// Recuperação de turnos perdidos: marcado quando um turno de IA é enfileirado e
// limpo quando processTurn termina. Se ficar preso (restart/crash antes de
// concluir), a varredura de recuperação re-enfileira. Índice para a varredura.
ensureColumn('contacts', 'pending_ai_at', 'TEXT');
db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_pending_ai ON contacts(pending_ai_at)`);

// --- Planos por uso: ciclo de cobrança mensal (base para os limites do plano) ---
ensureColumn('tenants', 'billing_cycle_start', 'TEXT');
ensureColumn('tenants', 'billing_cycle_end', 'TEXT');

// Transcrições de áudio — usadas para contabilizar minutos/mês por tenant e
// apagar o áudio bruto após transcrever (só o texto fica no histórico).
db.exec(`
  CREATE TABLE IF NOT EXISTS audio_transcriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id INTEGER,
    seconds    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_audio_transcriptions_tenant_day ON audio_transcriptions(tenant_id, created_at)`);

// Documentos extras — upload avulso (além do catálogo PDF), contam para o
// armazenamento e têm limite de quantidade/tamanho por plano.
db.exec(`
  CREATE TABLE IF NOT EXISTS extra_documents (
    id         TEXT PRIMARY KEY,
    tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    filename   TEXT NOT NULL,
    mime       TEXT NOT NULL,
    content    BLOB NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_extra_documents_tenant ON extra_documents(tenant_id)`);

// Base de conhecimento documental — indexa o texto extraido dos PDFs em FTS5.
// O arquivo bruto continua em catalog_files/extra_documents para preservar o
// envio do catalogo e downloads existentes; aqui ficam metadados, chunks e fila.
db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_documents (
    id                 TEXT PRIMARY KEY,
    tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_type        TEXT NOT NULL,
    source_id          TEXT,
    filename           TEXT NOT NULL,
    mime_type          TEXT NOT NULL,
    size_bytes         INTEGER NOT NULL,
    sha256             TEXT NOT NULL,
    status             TEXT NOT NULL,
    active             INTEGER NOT NULL DEFAULT 1,
    page_count         INTEGER DEFAULT 0,
    indexed_pages      INTEGER DEFAULT 0,
    chunks_count       INTEGER DEFAULT 0,
    extraction_version INTEGER NOT NULL DEFAULT 1,
    progress_percent   INTEGER NOT NULL DEFAULT 0,
    error_code         TEXT,
    error_message      TEXT,
    replaced_by_document_id TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at       TEXT,
    FOREIGN KEY (replaced_by_document_id) REFERENCES knowledge_documents(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_documents_tenant ON knowledge_documents(tenant_id, active, status);
  CREATE INDEX IF NOT EXISTS idx_knowledge_documents_source ON knowledge_documents(tenant_id, source_type, source_id);
  CREATE INDEX IF NOT EXISTS idx_knowledge_documents_sha ON knowledge_documents(tenant_id, sha256);
  CREATE UNIQUE INDEX IF NOT EXISTS ux_knowledge_documents_active_sha
    ON knowledge_documents(tenant_id, sha256)
    WHERE active = 1 AND status != 'disabled';

  CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id        TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    page_from          INTEGER,
    page_to            INTEGER,
    section_title      TEXT,
    content            TEXT NOT NULL,
    normalized_content TEXT,
    content_hash       TEXT NOT NULL,
    metadata_json      TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(document_id, content_hash)
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tenant ON knowledge_chunks(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document ON knowledge_chunks(document_id);

  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
    section_title,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TABLE IF NOT EXISTS knowledge_jobs (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id     TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    status          TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    locked_at       TEXT,
    lock_token      TEXT,
    last_error      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    started_at      TEXT,
    completed_at    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_status ON knowledge_jobs(status, next_attempt_at);
  CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_tenant ON knowledge_jobs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_document ON knowledge_jobs(document_id);

  CREATE TABLE IF NOT EXISTS knowledge_document_products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id   TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    product_json  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending_review',
    duplicate_hint TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_document_products_document
    ON knowledge_document_products(document_id);

  CREATE TABLE IF NOT EXISTS knowledge_usage (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    message_id  INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    document_id TEXT REFERENCES knowledge_documents(id) ON DELETE SET NULL,
    chunk_id    INTEGER REFERENCES knowledge_chunks(id) ON DELETE SET NULL,
    score       REAL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_usage_tenant ON knowledge_usage(tenant_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_knowledge_usage_message ON knowledge_usage(message_id);
`);

// Message AI inclusion flag — used to filter context sent to Claude.
ensureColumn('messages', 'include_in_ai', 'INTEGER NOT NULL DEFAULT 1');

// Entry Route — novo sistema de pontuação natural (entry_handle + entry_code).
ensureColumn('tenants', 'entry_handle', 'TEXT');
ensureColumn('tenants', 'entry_code',   'TEXT');

// Migrações da tabela de vendas (sales) para suportar unificação
ensureColumn('sales', 'amount', 'REAL');
ensureColumn('sales', 'total_cents', 'INTEGER');
ensureColumn('sales', 'items', 'TEXT');
ensureColumn('sales', 'items_json', 'TEXT');
ensureColumn('sales', 'mp_preference_id', 'TEXT');
ensureColumn('sales', 'mp_payment_id', 'TEXT');
ensureColumn('sales', 'checkout_url', 'TEXT');
ensureColumn('sales', 'payment_provider', 'TEXT');
ensureColumn('sales', 'external_payment_id', 'TEXT');
ensureColumn('sales', 'notes', 'TEXT');
ensureColumn('sales', 'paid_at', 'TEXT');

// Attendance code — formato TX579 (2 letras maiúsculas + 3 dígitos). Permanente, único, não editável.
ensureColumn('tenants', 'attendance_code', 'TEXT');
ensureColumn('tenants', 'link_logo_mime', 'TEXT');
ensureColumn('tenants', 'link_logo_content', 'BLOB');
ensureColumn('tenants', 'link_logo_updated_at', 'TEXT');

// Índice único para route_code — idempotente via IF NOT EXISTS.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_route_code ON tenants(route_code)`);

// Índice composto para entry route — o par (handle, code) deve ser único,
// mas o mesmo handle OU o mesmo code podem existir em lojas diferentes.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_entry_route ON tenants(entry_handle, entry_code)`);

// Tabela de códigos de atendimento reservados — impede reutilização quando um tenant é removido.
db.exec(`
  CREATE TABLE IF NOT EXISTS reserved_attendance_codes (
    code        TEXT PRIMARY KEY,
    reserved_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_attendance_code ON tenants(attendance_code)`);

// Índices de desempenho (aditivos) — aceleram stats, dashboard e insights por tenant.
db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_tenant_stage ON contacts(tenant_id, stage)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_tenant_lastmsg ON contacts(tenant_id, last_message_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_contact_role ON messages(contact_id, role)`);
// (Índices compostos para paginação por cursor ficam abaixo, DEPOIS dos
// ensureColumn de archived/handoff — colunas dependentes.)
db.exec(`CREATE INDEX IF NOT EXISTS idx_sales_page ON sales(tenant_id, updated_at DESC, id DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sales_page_status ON sales(tenant_id, status, updated_at DESC, id DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_page ON messages(contact_id, id DESC)`);

// Tokens de sessão gerados na landing page /c/:slug — segunda camada de identificação.
// TTL curto (30 min): se o usuário clicar no botão e enviar dentro do prazo, identifica
// o tenant mesmo que o padrão de texto falhe (variation selectors, edição da mensagem, etc).
db.exec(`
  CREATE TABLE IF NOT EXISTS entry_tokens (
    token      TEXT PRIMARY KEY,
    tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_entry_tokens_expires ON entry_tokens(expires_at)`);

// AI usage tracking table
db.exec(`
  CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    contact_id INTEGER,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_day ON ai_usage(tenant_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_contact ON ai_usage(contact_id);
`);

// --- Marketing, Attribution and Meta Conversions API columns & tables ---
ensureColumn('tenants', 'capi_enabled', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('tenants', 'capi_pixel_id', 'TEXT');
ensureColumn('tenants', 'capi_access_token', 'TEXT');
ensureColumn('tenants', 'capi_test_code', 'TEXT');
ensureColumn('tenants', 'capi_graph_version', "TEXT NOT NULL DEFAULT 'v21.0'");

db.exec(`
  CREATE TABLE IF NOT EXISTS marketing_links (
    id                 TEXT PRIMARY KEY,
    tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    slug               TEXT NOT NULL,
    source             TEXT NOT NULL,
    medium             TEXT NOT NULL,
    campaign           TEXT NOT NULL,
    content            TEXT,
    term               TEXT,
    meta_campaign_id   TEXT,
    meta_adset_id      TEXT,
    meta_ad_id         TEXT,
    notes              TEXT,
    active             INTEGER NOT NULL DEFAULT 1,
    created_by_user_id TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, slug)
  );

  CREATE TABLE IF NOT EXISTS attribution_clicks (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    marketing_link_id   TEXT NOT NULL REFERENCES marketing_links(id) ON DELETE CASCADE,
    entry_token_hash    TEXT NOT NULL UNIQUE,
    anonymous_session_id TEXT,
    fbclid              TEXT,
    gclid               TEXT,
    ttclid              TEXT,
    msclkid             TEXT,
    referrer            TEXT,
    user_agent_summary  TEXT,
    clicked_at          TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at          TEXT NOT NULL,
    matched_contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    matched_at          TEXT
  );

  CREATE TABLE IF NOT EXISTS contact_attributions (
    id                   TEXT PRIMARY KEY,
    tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id           INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE UNIQUE,
    first_touch_click_id TEXT REFERENCES attribution_clicks(id) ON DELETE SET NULL,
    last_touch_click_id  TEXT REFERENCES attribution_clicks(id) ON DELETE SET NULL,
    first_touch_at       TEXT,
    last_touch_at        TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS marketing_conversions (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id        INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    sale_id           TEXT REFERENCES sales(id) ON DELETE SET NULL,
    event_name        TEXT NOT NULL,
    event_id          TEXT NOT NULL,
    event_time        INTEGER NOT NULL,
    attribution_model TEXT NOT NULL,
    marketing_link_id TEXT REFERENCES marketing_links(id) ON DELETE SET NULL,
    value_cents       INTEGER,
    currency          TEXT NOT NULL DEFAULT 'BRL',
    payload_json      TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS conversion_delivery_jobs (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    conversion_event_id TEXT NOT NULL REFERENCES marketing_conversions(id) ON DELETE CASCADE,
    provider            TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',
    attempts            INTEGER NOT NULL DEFAULT 0,
    next_attempt_at     TEXT NOT NULL DEFAULT (datetime('now')),
    locked_at           TEXT,
    lock_token          TEXT,
    last_error_code     TEXT,
    last_error_summary  TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at        TEXT,
    UNIQUE(tenant_id, conversion_event_id, provider)
  );

  CREATE INDEX IF NOT EXISTS idx_mkt_links_tenant_slug ON marketing_links(tenant_id, slug);
  CREATE INDEX IF NOT EXISTS idx_clicks_entry_token ON attribution_clicks(entry_token_hash);
  CREATE INDEX IF NOT EXISTS idx_clicks_contact ON attribution_clicks(matched_contact_id);
  CREATE INDEX IF NOT EXISTS idx_clicks_tenant_link ON attribution_clicks(tenant_id, marketing_link_id);
  CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON attribution_clicks(clicked_at);
  CREATE INDEX IF NOT EXISTS idx_conversions_contact ON marketing_conversions(contact_id);
  CREATE INDEX IF NOT EXISTS idx_conversions_tenant_contact ON marketing_conversions(tenant_id, contact_id);
  CREATE INDEX IF NOT EXISTS idx_conversions_tenant_sale ON marketing_conversions(tenant_id, sale_id);
  CREATE INDEX IF NOT EXISTS idx_conversions_created_at ON marketing_conversions(created_at);
  CREATE INDEX IF NOT EXISTS idx_capi_jobs_status_next ON conversion_delivery_jobs(status, next_attempt_at);
`);

// --- CRM leve: origem do lead, dados de PF/PJ, responsável/prioridade/tarefa ---
// cpf_cnpj é sensível (LGPD): guardado cifrado (mesmo padrão de wa_token/mp_access_token
// em crypto.js) + um hash determinístico (HMAC) só para detectar duplicidade sem
// precisar decifrar todo mundo. Nunca é exposto em texto puro fora de decrypt explícito.
ensureColumn('contacts', 'lead_source', "TEXT NOT NULL DEFAULT 'whatsapp_direto'");
ensureColumn('contacts', 'lead_source_detail', 'TEXT');
ensureColumn('contacts', 'tipo_cliente', 'TEXT');
ensureColumn('contacts', 'cpf_cnpj_enc', 'TEXT');
ensureColumn('contacts', 'cpf_cnpj_hash', 'TEXT');
ensureColumn('contacts', 'razao_social', 'TEXT');
ensureColumn('contacts', 'nome_fantasia', 'TEXT');
ensureColumn('contacts', 'email', 'TEXT');
ensureColumn('contacts', 'cep', 'TEXT');
ensureColumn('contacts', 'endereco', 'TEXT');
ensureColumn('contacts', 'cidade', 'TEXT');
ensureColumn('contacts', 'uf', 'TEXT');
ensureColumn('contacts', 'responsavel', 'TEXT');
ensureColumn('contacts', 'prioridade', "TEXT NOT NULL DEFAULT 'media'");
ensureColumn('contacts', 'proxima_tarefa', 'TEXT');
ensureColumn('contacts', 'prazo_resposta', 'TEXT');
db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_cpf_hash ON contacts(tenant_id, cpf_cnpj_hash)`);

// --- Multiusuários, Equipes, Permissões e Distribuição ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('admin', 'agent')),
    active        INTEGER NOT NULL DEFAULT 1,
    available     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS teams (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS team_users (
    team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS user_invitations (
    id         TEXT PRIMARY KEY,
    tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,
    role       TEXT NOT NULL CHECK(role IN ('admin', 'agent')),
    token      TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_teams_tenant ON teams(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_invitations_token ON user_invitations(token);
`);

ensureColumn('contacts', 'assigned_user_id', 'TEXT REFERENCES users(id) ON DELETE SET NULL');
ensureColumn('contacts', 'assigned_team_id', 'TEXT REFERENCES teams(id) ON DELETE SET NULL');
ensureColumn('contacts', 'assigned_at', 'TEXT');
ensureColumn('sessions', 'user_id', 'TEXT REFERENCES users(id) ON DELETE SET NULL');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_contacts_assigned_user ON contacts(assigned_user_id);
  CREATE INDEX IF NOT EXISTS idx_contacts_assigned_team ON contacts(assigned_team_id);
`);

// Arquivar contato — sai da lista principal sem apagar nada (reversível).
// Diferente de excluir, que remove o registro (e em cascata mensagens,
// notas, tags e cálculos de frete — vendas ficam com contact_id nulo).
ensureColumn('contacts', 'archived', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('contacts', 'archived_at', 'TEXT');
db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_archived ON contacts(tenant_id, archived)`);
// Índices compostos para paginação por cursor de contatos. Precisam
// vir DEPOIS de ensureColumn('archived') e ensureColumn('handoff_status').
db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_page ON contacts(tenant_id, archived, last_message_at DESC, id DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_page_stage ON contacts(tenant_id, stage, last_message_at DESC, id DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_page_handoff ON contacts(tenant_id, handoff_status, last_message_at DESC, id DESC)`);

// Limpeza retroativa: contatos sem mensagens não podem ter buy_intent/handoff derivados de conversa.
db.prepare(`
  UPDATE contacts SET buy_intent = 'baixa', summary = '', handoff_status = 'none', handoff_reason = NULL
  WHERE (buy_intent != 'baixa' OR handoff_status != 'none')
    AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = contacts.id)
`).run();

// Tags inteligentes — normalizado (não JSON) para permitir filtro/contagem por tag.
db.exec(`
  CREATE TABLE IF NOT EXISTS contact_tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag        TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(contact_id, tag)
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contact_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_contact_tags_tenant_tag ON contact_tags(tenant_id, tag)`);

// Registro de cada cálculo de frete feito pela IA — usado só para o indicador
// "fretes calculados sem compra" no painel de dinheiro parado (não guarda o
// resultado do cálculo, só que ele aconteceu).
db.exec(`
  CREATE TABLE IF NOT EXISTS frete_calculos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    cep_destino TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_frete_calculos_tenant ON frete_calculos(tenant_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_frete_calculos_contact ON frete_calculos(contact_id)`);

// Lista de espera de reposição — cliente pediu pra ser avisado quando um
// produto marcado "esgotado" no catálogo voltar ao estoque. Produtos não têm
// ID estável (são só objetos dentro de business_json.produtos), então a
// referência é pelo nome exato cadastrado.
db.exec(`
  CREATE TABLE IF NOT EXISTS product_waitlist (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id   INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    produto_nome TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    notified_at  TEXT
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_product_waitlist_tenant_produto ON product_waitlist(tenant_id, produto_nome)`);

// Resumo diário via WhatsApp — guarda a data (YYYY-MM-DD) do último envio pra
// não mandar duas vezes no mesmo dia (o scheduler roda a cada 30 min).
ensureColumn('tenants', 'daily_summary_sent_date', 'TEXT');

// Aviso automático de recompra (Central de Avisos) — mesma lógica de guarda
// por dia do resumo diário, pra não repetir o aviso a cada 30 min enquanto
// a sugestão continuar valendo (ver src/repurchase-notify.js).
ensureColumn('tenants', 'repurchase_notice_sent_date', 'TEXT');

// Sinal de demanda agregada — a IA marca o último produto do catálogo que
// foi o foco principal da mensagem do cliente (ver "produto_mencionado" na
// tool responder_cliente, em ai.js). Só guarda o último por contato (não um
// histórico completo) — suficiente para contar quantos contatos distintos
// demonstraram interesse no mesmo produto numa janela recente de horas.
ensureColumn('contacts', 'last_produto_mencionado', 'TEXT');
ensureColumn('contacts', 'last_produto_mencionado_at', 'TEXT');
db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_produto_mencionado ON contacts(tenant_id, last_produto_mencionado, last_produto_mencionado_at)`);

// Controle de estoque — produtos com "estoque_qtd" configurado (business_json)
// têm o estoque descontado quando a IA fecha um pedido. Esta coluna marca se
// ESTA venda específica já teve estoque descontado, pra devolver certo (e só
// uma vez) se a venda for cancelada/recusada depois (ver src/stock.js).
ensureColumn('sales', 'stock_adjusted', 'INTEGER NOT NULL DEFAULT 0');

// Food service / restaurantes — tipo de pedido, entrega, mesa e comanda.
ensureColumn('sales', 'order_type', 'TEXT');          // 'delivery' | 'retirada' | 'mesa'
ensureColumn('sales', 'delivery_address', 'TEXT');    // JSON: {rua, numero, complemento, bairro, cep}
ensureColumn('sales', 'table_number', 'TEXT');        // número/nome da mesa
ensureColumn('sales', 'estimated_minutes', 'INTEGER'); // ETA em minutos
ensureColumn('sales', 'delivery_fee', 'INTEGER');     // taxa de entrega em centavos
ensureColumn('sales', 'comanda_number', 'INTEGER');   // número sequencial da comanda

// PrintNode — impressão térmica de comandas (API key cifrada, printer_id é texto).
ensureColumn('tenants', 'printnode_api_key', 'TEXT');
ensureColumn('tenants', 'printnode_printer_id', 'TEXT');

// Central de Avisos — registro persistente de eventos que o lojista precisa
// ver (estoque esgotado, aguardando humano, limite de IA atingido). Diferente
// dos alertas operacionais de src/alerts.js (que avisam o DONO DA PLATAFORMA
// por WhatsApp) — aqui é por tenant, pro lojista ver no painel.
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    message    TEXT NOT NULL,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at    TEXT
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id, read_at, created_at)`);
ensureColumn('notifications', 'archived_at', 'TEXT');
db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_tenant_history ON notifications(tenant_id, archived_at, created_at)`);

// --- Log de auditoria (LGPD, Art. 6º, X — responsabilização/accountability) ---
// Registra ações sensíveis de admin (impersonation, backup, restore, troca de
// plano) e exclusões de conta — quem fez, quando, em qual tenant. target_tenant_id
// usa SET NULL (não CASCADE): o registro de que uma conta foi excluída precisa
// sobreviver à própria exclusão da conta, senão a auditoria desaparece exatamente
// no caso mais sensível.
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_tenant_id  TEXT REFERENCES tenants(id) ON DELETE SET NULL,
    actor_email      TEXT,
    target_tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
    target_email     TEXT,
    action           TEXT NOT NULL,
    detail           TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_tenant_id, created_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_tenant_id, created_at)`);

export const auditLogQueries = {
  insert: db.prepare(`
    INSERT INTO audit_log (actor_tenant_id, actor_email, target_tenant_id, target_email, action, detail)
    VALUES (@actor_tenant_id, @actor_email, @target_tenant_id, @target_email, @action, @detail)
  `),
  recent: db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 200`),
  byTargetTenant: db.prepare(`SELECT * FROM audit_log WHERE target_tenant_id = ? ORDER BY id DESC LIMIT 100`),
};

/** Registra uma ação sensível no log de auditoria. Nunca lança — auditoria não pode derrubar a ação em si. */
export function logAudit({ actorTenantId, actorEmail, targetTenantId, targetEmail, action, detail }) {
  try {
    auditLogQueries.insert.run({
      actor_tenant_id: actorTenantId || null,
      actor_email: actorEmail || null,
      target_tenant_id: targetTenantId || null,
      target_email: targetEmail || null,
      action,
      detail: detail ? String(detail) : null,
    });
  } catch (e) {
    console.error('[audit] falha ao registrar:', e.message);
  }
}

export const notificationQueries = {
  create: db.prepare(`
    INSERT INTO notifications (tenant_id, type, title, message, contact_id)
    VALUES (@tenant_id, @type, @title, @message, @contact_id)
  `),
  listByTenant: db.prepare(`
    SELECT n.*, c.wa_phone, c.name AS contact_name
    FROM notifications n
    LEFT JOIN contacts c ON c.id = n.contact_id
    WHERE n.tenant_id = ?
      AND n.archived_at IS NULL
      AND n.created_at >= datetime('now', '-1 year')
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT 500
  `),
  listArchivedByTenant: db.prepare(`
    SELECT n.*, c.wa_phone, c.name AS contact_name
    FROM notifications n
    LEFT JOIN contacts c ON c.id = n.contact_id
    WHERE n.tenant_id = ?
      AND n.archived_at IS NOT NULL
      AND n.created_at >= datetime('now', '-1 year')
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT 500
  `),
  unreadCount: db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE tenant_id = ? AND read_at IS NULL AND archived_at IS NULL AND created_at >= datetime('now', '-1 year')`),
  markRead: db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND tenant_id = ?`),
  markAllRead: db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE tenant_id = ? AND read_at IS NULL AND archived_at IS NULL`),
  archive: db.prepare(`UPDATE notifications SET archived_at = datetime('now') WHERE id = ? AND tenant_id = ?`),
  delete: db.prepare(`DELETE FROM notifications WHERE id = ? AND tenant_id = ?`),
};

// --- Bling ERP: mapa de produtos ---
// Produtos do Zapien vivem em business_json.produtos[] sem ID estável (mesma
// limitação já aceita pelo controle de estoque em src/stock.js — casamento
// por nome exato). Esta tabela reconcilia o nome do produto no Zapien com o
// ID real do produto no Bling.
db.exec(`
  CREATE TABLE IF NOT EXISTS bling_product_map (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    produto_nome      TEXT NOT NULL,
    produto_codigo    TEXT,
    bling_produto_id  TEXT NOT NULL,
    bling_sku         TEXT,
    last_synced_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, produto_nome)
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_bling_product_map_tenant ON bling_product_map(tenant_id)`);
ensureColumn('bling_product_map', 'produto_codigo', 'TEXT');
db.exec(`DROP INDEX IF EXISTS idx_bling_product_map_codigo`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bling_product_map_codigo ON bling_product_map(tenant_id, produto_codigo)`);
// product_id permanente (ver src/products.js). Coluna nova adicionada por
// ensureColumn pra manter mapas antigos (só nome/sku) funcionando durante a
// transição. Migração idempotente no boot faz o backfill onde consegue.
ensureColumn('bling_product_map', 'product_id', 'TEXT');
db.exec(`CREATE INDEX IF NOT EXISTS idx_bling_product_map_product_id ON bling_product_map(tenant_id, product_id)`);

export const blingProductMapQueries = {
  upsert: db.prepare(`
    INSERT INTO bling_product_map (tenant_id, produto_nome, produto_codigo, bling_produto_id, bling_sku, product_id, last_synced_at)
    VALUES (@tenant_id, @produto_nome, @produto_codigo, @bling_produto_id, @bling_sku, @product_id, datetime('now'))
    ON CONFLICT(tenant_id, produto_nome) DO UPDATE SET
      produto_codigo = excluded.produto_codigo,
      bling_produto_id = excluded.bling_produto_id,
      bling_sku = excluded.bling_sku,
      product_id = COALESCE(excluded.product_id, bling_product_map.product_id),
      last_synced_at = excluded.last_synced_at
  `),
  upsertByCodigo: db.prepare(`
    INSERT INTO bling_product_map (tenant_id, produto_nome, produto_codigo, bling_produto_id, bling_sku, product_id, last_synced_at)
    VALUES (@tenant_id, @produto_nome, @produto_codigo, @bling_produto_id, @bling_sku, @product_id, datetime('now'))
    ON CONFLICT(tenant_id, produto_codigo) DO UPDATE SET
      produto_nome = excluded.produto_nome,
      bling_produto_id = excluded.bling_produto_id,
      bling_sku = excluded.bling_sku,
      product_id = COALESCE(excluded.product_id, bling_product_map.product_id),
      last_synced_at = excluded.last_synced_at
  `),
  byTenant: db.prepare(`SELECT * FROM bling_product_map WHERE tenant_id = ?`),
  // Lookup por nome do produto (do catálogo do Zapien): usado ao montar o
  // pedido para o Bling quando o item vendido não trouxe codigo/sku — a
  // sincronização anterior descobriu o código pela reconciliação.
  byTenantAndNome: db.prepare(`SELECT * FROM bling_product_map WHERE tenant_id = ? AND produto_nome = ?`),
  // Preferido depois de PR2: lookup por product_id imutável. Renomear o
  // produto no Zapien não quebra a sincronização.
  byTenantAndProductId: db.prepare(`SELECT * FROM bling_product_map WHERE tenant_id = ? AND product_id = ?`),
};

// --- Nuvemshop / Tray: mapa de produtos (mesma reconciliação por nome do Bling) ---
db.exec(`
  CREATE TABLE IF NOT EXISTS nuvemshop_product_map (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    produto_nome          TEXT NOT NULL,
    nuvemshop_produto_id  TEXT NOT NULL,
    nuvemshop_sku         TEXT,
    last_synced_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, produto_nome)
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_nuvemshop_product_map_tenant ON nuvemshop_product_map(tenant_id)`);
ensureColumn('nuvemshop_product_map', 'product_id', 'TEXT');
db.exec(`CREATE INDEX IF NOT EXISTS idx_nuvemshop_product_map_product_id ON nuvemshop_product_map(tenant_id, product_id)`);

export const nuvemshopProductMapQueries = {
  upsert: db.prepare(`
    INSERT INTO nuvemshop_product_map (tenant_id, produto_nome, nuvemshop_produto_id, nuvemshop_sku, product_id, last_synced_at)
    VALUES (@tenant_id, @produto_nome, @nuvemshop_produto_id, @nuvemshop_sku, @product_id, datetime('now'))
    ON CONFLICT(tenant_id, produto_nome) DO UPDATE SET
      nuvemshop_produto_id = excluded.nuvemshop_produto_id,
      nuvemshop_sku = excluded.nuvemshop_sku,
      product_id = COALESCE(excluded.product_id, nuvemshop_product_map.product_id),
      last_synced_at = excluded.last_synced_at
  `),
  byTenant: db.prepare(`SELECT * FROM nuvemshop_product_map WHERE tenant_id = ?`),
  byTenantAndProductId: db.prepare(`SELECT * FROM nuvemshop_product_map WHERE tenant_id = ? AND product_id = ?`),
};

db.exec(`
  CREATE TABLE IF NOT EXISTS tray_product_map (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    produto_nome      TEXT NOT NULL,
    tray_produto_id   TEXT NOT NULL,
    tray_sku          TEXT,
    last_synced_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, produto_nome)
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tray_product_map_tenant ON tray_product_map(tenant_id)`);

export const trayProductMapQueries = {
  upsert: db.prepare(`
    INSERT INTO tray_product_map (tenant_id, produto_nome, tray_produto_id, tray_sku, last_synced_at)
    VALUES (@tenant_id, @produto_nome, @tray_produto_id, @tray_sku, datetime('now'))
    ON CONFLICT(tenant_id, produto_nome) DO UPDATE SET
      tray_produto_id = excluded.tray_produto_id,
      tray_sku = excluded.tray_sku,
      last_synced_at = excluded.last_synced_at
  `),
  byTenant: db.prepare(`SELECT * FROM tray_product_map WHERE tenant_id = ?`),
};

// --- Webhook genérico (Zapier/Make) ---
// Registro das entregas de eventos para o lojista ver na tela de config
// (últimos envios, sucesso/falha) sem precisar poluir a Central de Avisos
// a cada evento — só um aviso após falhas consecutivas (circuit breaker).
db.exec(`
  CREATE TABLE IF NOT EXISTS webhook_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type    TEXT NOT NULL,
    payload_json  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pendente',
    http_status   INTEGER,
    attempts      INTEGER NOT NULL DEFAULT 0,
    error         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    delivered_at  TEXT
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_log_tenant ON webhook_log(tenant_id, created_at)`);

// --- Saúde da conexão Meta (WhatsApp Cloud API) ---
// Snapshot por tenant do último estado conhecido da conexão + telemetria leve
// (último inbound/outbound). tenant_id pode ser o id de um tenant OU o marcador
// '_platform' (verificação das credenciais compartilhadas da plataforma) — por
// isso NÃO há FK para tenants aqui. Nunca gravar corpo de mensagem nesta tabela.
db.exec(`
  CREATE TABLE IF NOT EXISTS meta_connection_health (
    tenant_id                TEXT PRIMARY KEY,
    status                   TEXT NOT NULL DEFAULT 'unknown',
    token_valid              INTEGER,
    display_phone_number     TEXT,
    verified_name            TEXT,
    quality_rating           TEXT,
    messaging_limit          TEXT,
    templates_approved       INTEGER,
    templates_pending        INTEGER,
    templates_rejected       INTEGER,
    templates_unknown        INTEGER,
    last_inbound_at          TEXT,
    last_processed_at        TEXT,
    last_outbound_success_at TEXT,
    last_outbound_error_at   TEXT,
    last_error_code          TEXT,
    last_error_summary       TEXT,
    last_checked_at          TEXT,
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
// Eventos de transição de estado (crítico, recuperado, token inválido...) com
// retenção limitada (limpeza periódica no scheduler). Só resumo seguro do erro.
db.exec(`
  CREATE TABLE IF NOT EXISTS meta_health_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id   TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    detail      TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_health_events_tenant ON meta_health_events(tenant_id, created_at)`);

export const metaHealthQueries = {
  get: db.prepare(`SELECT * FROM meta_connection_health WHERE tenant_id = ?`),
  recordInbound: db.prepare(`
    INSERT INTO meta_connection_health (tenant_id, last_inbound_at, updated_at)
    VALUES (?, datetime('now'), datetime('now'))
    ON CONFLICT(tenant_id) DO UPDATE SET last_inbound_at = datetime('now'), updated_at = datetime('now')
  `),
  recordProcessed: db.prepare(`
    INSERT INTO meta_connection_health (tenant_id, last_processed_at, updated_at)
    VALUES (?, datetime('now'), datetime('now'))
    ON CONFLICT(tenant_id) DO UPDATE SET last_processed_at = datetime('now'), updated_at = datetime('now')
  `),
  recordOutboundSuccess: db.prepare(`
    INSERT INTO meta_connection_health (tenant_id, last_outbound_success_at, updated_at)
    VALUES (?, datetime('now'), datetime('now'))
    ON CONFLICT(tenant_id) DO UPDATE SET last_outbound_success_at = datetime('now'), updated_at = datetime('now')
  `),
  recordOutboundError: db.prepare(`
    INSERT INTO meta_connection_health (tenant_id, last_outbound_error_at, last_error_code, last_error_summary, updated_at)
    VALUES (@tenant_id, datetime('now'), @code, @summary, datetime('now'))
    ON CONFLICT(tenant_id) DO UPDATE SET
      last_outbound_error_at = datetime('now'),
      last_error_code = @code,
      last_error_summary = @summary,
      updated_at = datetime('now')
  `),
  upsertCheck: db.prepare(`
    INSERT INTO meta_connection_health (
      tenant_id, status, token_valid, display_phone_number, verified_name,
      quality_rating, messaging_limit, templates_approved, templates_pending,
      templates_rejected, templates_unknown, last_checked_at, updated_at
    ) VALUES (
      @tenant_id, @status, @token_valid, @display_phone_number, @verified_name,
      @quality_rating, @messaging_limit, @templates_approved, @templates_pending,
      @templates_rejected, @templates_unknown, datetime('now'), datetime('now')
    )
    ON CONFLICT(tenant_id) DO UPDATE SET
      status = excluded.status,
      token_valid = excluded.token_valid,
      display_phone_number = COALESCE(excluded.display_phone_number, meta_connection_health.display_phone_number),
      verified_name = COALESCE(excluded.verified_name, meta_connection_health.verified_name),
      quality_rating = COALESCE(excluded.quality_rating, meta_connection_health.quality_rating),
      messaging_limit = COALESCE(excluded.messaging_limit, meta_connection_health.messaging_limit),
      templates_approved = COALESCE(excluded.templates_approved, meta_connection_health.templates_approved),
      templates_pending = COALESCE(excluded.templates_pending, meta_connection_health.templates_pending),
      templates_rejected = COALESCE(excluded.templates_rejected, meta_connection_health.templates_rejected),
      templates_unknown = COALESCE(excluded.templates_unknown, meta_connection_health.templates_unknown),
      last_checked_at = datetime('now'),
      updated_at = datetime('now')
  `),
  statusCounts: db.prepare(`
    SELECT status, COUNT(*) AS n FROM meta_connection_health
    WHERE tenant_id != '_platform' GROUP BY status
  `),
  insertEvent: db.prepare(`INSERT INTO meta_health_events (tenant_id, event_type, detail) VALUES (?, ?, ?)`),
  lastEventOfType: db.prepare(`
    SELECT * FROM meta_health_events WHERE tenant_id = ? AND event_type = ?
    ORDER BY id DESC LIMIT 1
  `),
  recentEvents: db.prepare(`
    SELECT event_type, detail, created_at FROM meta_health_events
    WHERE tenant_id = ? ORDER BY id DESC LIMIT 20
  `),
  cleanupEvents: db.prepare(`DELETE FROM meta_health_events WHERE created_at < datetime('now', '-30 days')`),
};

// --- Web Push (notificações no celular/desktop via PWA) ---
// Uma assinatura por navegador/aparelho; endpoint é único globalmente (URL
// gerada pelo push service do navegador). Chaves p256dh/auth não são segredo
// do servidor (são públicas da assinatura), mas nunca aparecem em log.
db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    endpoint        TEXT NOT NULL UNIQUE,
    p256dh          TEXT NOT NULL,
    auth            TEXT NOT NULL,
    user_agent      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_success_at TEXT,
    failure_count   INTEGER NOT NULL DEFAULT 0,
    disabled_at     TEXT
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_push_subs_tenant ON push_subscriptions(tenant_id)`);
// Deduplicação/cooldown de pushes: 1 linha por (tenant, chave semântica do
// evento). Impede alerta crítico repetido; limpeza periódica no scheduler.
db.exec(`
  CREATE TABLE IF NOT EXISTS push_dedupe (
    tenant_id  TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tenant_id, dedupe_key)
  )
`);

// Preferências de push por tenant (JSON com categorias ligadas/desligadas).
ensureColumn('tenants', 'push_preferences_json', 'TEXT');

export const pushSubscriptionQueries = {
  upsert: db.prepare(`
    INSERT INTO push_subscriptions (tenant_id, endpoint, p256dh, auth, user_agent)
    VALUES (@tenant_id, @endpoint, @p256dh, @auth, @user_agent)
    ON CONFLICT(endpoint) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      updated_at = datetime('now'),
      failure_count = 0,
      disabled_at = NULL
  `),
  listActiveByTenant: db.prepare(`
    SELECT * FROM push_subscriptions WHERE tenant_id = ? AND disabled_at IS NULL
  `),
  countActiveByTenant: db.prepare(`
    SELECT COUNT(*) AS n FROM push_subscriptions WHERE tenant_id = ? AND disabled_at IS NULL
  `),
  deleteByEndpoint: db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND tenant_id = ?`),
  markSuccess: db.prepare(`
    UPDATE push_subscriptions SET last_success_at = datetime('now'), failure_count = 0 WHERE id = ?
  `),
  markFailure: db.prepare(`
    UPDATE push_subscriptions SET failure_count = failure_count + 1, updated_at = datetime('now') WHERE id = ?
  `),
  disableById: db.prepare(`UPDATE push_subscriptions SET disabled_at = datetime('now') WHERE id = ?`),
};

// --- Automações comerciais (QUANDO → SE → ENTÃO) ---
// automations: a regra criada pelo lojista. Eventos de domínio ficam em
// automation_events (auditoria), jobs em automation_jobs (fila persistente,
// sobrevive a reinício — inclusive contact_idle agendado para o futuro),
// execuções em automation_runs (dedupe único por tenant) e o resultado de
// cada ação em automation_run_actions.
db.exec(`
  CREATE TABLE IF NOT EXISTS automations (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    description         TEXT,
    enabled             INTEGER NOT NULL DEFAULT 1,
    trigger_type        TEXT NOT NULL,
    trigger_config_json TEXT NOT NULL DEFAULT '{}',
    conditions_json     TEXT NOT NULL DEFAULT '[]',
    actions_json        TEXT NOT NULL DEFAULT '[]',
    cooldown_seconds    INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    last_run_at         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_automations_tenant ON automations(tenant_id, enabled);
  CREATE INDEX IF NOT EXISTS idx_automations_trigger ON automations(tenant_id, trigger_type, enabled);

  CREATE TABLE IF NOT EXISTS automation_events (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type   TEXT NOT NULL,
    entity_type  TEXT,
    entity_id    TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    origin       TEXT NOT NULL DEFAULT 'system',
    chain_depth  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_automation_events_pending ON automation_events(processed_at, created_at);
  CREATE INDEX IF NOT EXISTS idx_automation_events_tenant ON automation_events(tenant_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_automation_events_entity ON automation_events(tenant_id, entity_type, entity_id);

  CREATE TABLE IF NOT EXISTS automation_jobs (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    automation_id   TEXT NOT NULL,
    event_id        TEXT NOT NULL,
    run_at          TEXT NOT NULL DEFAULT (datetime('now')),
    status          TEXT NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
    locked_at       TEXT,
    lock_token      TEXT,
    last_error      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_automation_jobs_due ON automation_jobs(status, run_at, next_attempt_at);
  CREATE INDEX IF NOT EXISTS idx_automation_jobs_tenant ON automation_jobs(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_automation_jobs_automation ON automation_jobs(automation_id, event_id);

  CREATE TABLE IF NOT EXISTS automation_runs (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    automation_id TEXT NOT NULL,
    event_id      TEXT,
    status        TEXT NOT NULL DEFAULT 'running',
    dedupe_key    TEXT NOT NULL,
    started_at    TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at   TEXT,
    error_summary TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, dedupe_key)
  );
  CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id, created_at);

  CREATE TABLE IF NOT EXISTS automation_run_actions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id        TEXT NOT NULL,
    action_index  INTEGER NOT NULL,
    action_type   TEXT NOT NULL,
    status        TEXT NOT NULL,
    result_json   TEXT,
    error_summary TEXT,
    started_at    TEXT,
    finished_at   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_automation_run_actions_run ON automation_run_actions(run_id, action_index);
`);

export const automationQueries = {
  insert: db.prepare(`
    INSERT INTO automations (id, tenant_id, name, description, enabled, trigger_type,
      trigger_config_json, conditions_json, actions_json, cooldown_seconds)
    VALUES (@id, @tenant_id, @name, @description, @enabled, @trigger_type,
      @trigger_config_json, @conditions_json, @actions_json, @cooldown_seconds)
  `),
  update: db.prepare(`
    UPDATE automations SET
      name = @name, description = @description, trigger_type = @trigger_type,
      trigger_config_json = @trigger_config_json, conditions_json = @conditions_json,
      actions_json = @actions_json, cooldown_seconds = @cooldown_seconds,
      updated_at = datetime('now')
    WHERE id = @id AND tenant_id = @tenant_id
  `),
  byId: db.prepare(`SELECT * FROM automations WHERE id = ? AND tenant_id = ?`),
  listByTenant: db.prepare(`SELECT * FROM automations WHERE tenant_id = ? ORDER BY created_at DESC`),
  listEnabledByTrigger: db.prepare(`
    SELECT * FROM automations WHERE tenant_id = ? AND trigger_type = ? AND enabled = 1
  `),
  countActive: db.prepare(`SELECT COUNT(*) AS n FROM automations WHERE tenant_id = ? AND enabled = 1`),
  setEnabled: db.prepare(`
    UPDATE automations SET enabled = @enabled, updated_at = datetime('now')
    WHERE id = @id AND tenant_id = @tenant_id
  `),
  touchLastRun: db.prepare(`UPDATE automations SET last_run_at = datetime('now') WHERE id = ?`),
  delete: db.prepare(`DELETE FROM automations WHERE id = ? AND tenant_id = ?`),
  runCounts: db.prepare(`
    SELECT automation_id, COUNT(*) AS total,
           MAX(created_at) AS last_run_at,
           (SELECT status FROM automation_runs r2 WHERE r2.automation_id = r1.automation_id
              AND r2.tenant_id = r1.tenant_id ORDER BY r2.created_at DESC, r2.id DESC LIMIT 1) AS last_status
    FROM automation_runs r1 WHERE tenant_id = ? GROUP BY automation_id
  `),
};

export const automationEventQueries = {
  insert: db.prepare(`
    INSERT INTO automation_events (id, tenant_id, event_type, entity_type, entity_id,
      payload_json, origin, chain_depth)
    VALUES (@id, @tenant_id, @event_type, @entity_type, @entity_id, @payload_json, @origin, @chain_depth)
  `),
  byId: db.prepare(`SELECT * FROM automation_events WHERE id = ?`),
  markProcessed: db.prepare(`UPDATE automation_events SET processed_at = datetime('now') WHERE id = ?`),
  countPending: db.prepare(`SELECT COUNT(*) AS n FROM automation_events WHERE processed_at IS NULL`),
  cleanup: db.prepare(`DELETE FROM automation_events WHERE created_at < datetime('now', '-30 days')`),
};

export const automationJobQueries = {
  insert: db.prepare(`
    INSERT INTO automation_jobs (id, tenant_id, automation_id, event_id, run_at, next_attempt_at)
    VALUES (@id, @tenant_id, @automation_id, @event_id, @run_at, @run_at)
  `),
  byId: db.prepare(`SELECT * FROM automation_jobs WHERE id = ?`),
  // Reserva atômica: só um worker pega o job (RETURNING garante o vencedor).
  reserveById: db.prepare(`
    UPDATE automation_jobs
    SET status = 'processing', locked_at = datetime('now'), lock_token = @lock_token,
        attempts = attempts + 1
    WHERE id = @id AND status IN ('pending', 'retry')
      AND run_at <= datetime('now') AND next_attempt_at <= datetime('now')
    RETURNING *
  `),
  nextDueByTenant: db.prepare(`
    SELECT id FROM automation_jobs
    WHERE tenant_id = ? AND status IN ('pending', 'retry')
      AND run_at <= datetime('now') AND next_attempt_at <= datetime('now')
    ORDER BY run_at ASC LIMIT 1
  `),
  distinctTenantsDue: db.prepare(`
    SELECT DISTINCT tenant_id FROM automation_jobs
    WHERE status IN ('pending', 'retry')
      AND run_at <= datetime('now') AND next_attempt_at <= datetime('now')
  `),
  markDone: db.prepare(`
    UPDATE automation_jobs SET status = 'done', finished_at = datetime('now'), last_error = NULL WHERE id = ?
  `),
  markFailed: db.prepare(`
    UPDATE automation_jobs SET status = 'failed', finished_at = datetime('now'), last_error = ? WHERE id = ?
  `),
  markRetry: db.prepare(`
    UPDATE automation_jobs SET status = 'retry', next_attempt_at = ?, last_error = ?, locked_at = NULL, lock_token = NULL WHERE id = ?
  `),
  markCancelled: db.prepare(`
    UPDATE automation_jobs SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?
  `),
  // Cancela jobs pendentes ligados a eventos de uma entidade (ex.: cliente
  // respondeu → cancela contact_idle; venda paga → cancela lembretes da venda).
  cancelPendingByEventEntity: db.prepare(`
    UPDATE automation_jobs SET status = 'cancelled', finished_at = datetime('now')
    WHERE status IN ('pending', 'retry') AND tenant_id = @tenant_id
      AND event_id IN (
        SELECT id FROM automation_events
        WHERE tenant_id = @tenant_id AND event_type = @event_type
          AND entity_type = @entity_type AND entity_id = @entity_id
      )
  `),
  // Recupera locks expirados (worker morreu no meio) — volta pra retry.
  reclaimStale: db.prepare(`
    UPDATE automation_jobs SET status = 'retry', locked_at = NULL, lock_token = NULL
    WHERE status = 'processing' AND locked_at < datetime('now', ?)
  `),
  statusCounts: db.prepare(`SELECT status, COUNT(*) AS n FROM automation_jobs GROUP BY status`),
  cleanup: db.prepare(`
    DELETE FROM automation_jobs
    WHERE status IN ('done', 'cancelled', 'failed') AND created_at < datetime('now', '-30 days')
  `),
};

export const automationRunQueries = {
  // INSERT OR IGNORE + changes=0 → dedupe (já executado para esta chave).
  tryInsert: db.prepare(`
    INSERT OR IGNORE INTO automation_runs (id, tenant_id, automation_id, event_id, dedupe_key)
    VALUES (@id, @tenant_id, @automation_id, @event_id, @dedupe_key)
  `),
  finish: db.prepare(`
    UPDATE automation_runs SET status = @status, finished_at = datetime('now'), error_summary = @error_summary
    WHERE id = @id
  `),
  byId: db.prepare(`SELECT * FROM automation_runs WHERE id = ? AND tenant_id = ?`),
  listByAutomation: db.prepare(`
    SELECT * FROM automation_runs WHERE tenant_id = ? AND automation_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
  `),
  countByAutomation: db.prepare(`
    SELECT COUNT(*) AS n FROM automation_runs WHERE tenant_id = ? AND automation_id = ?
  `),
  lastRunForEntityWithin: db.prepare(`
    SELECT r.* FROM automation_runs r
    JOIN automation_events e ON e.id = r.event_id
    WHERE r.tenant_id = @tenant_id AND r.automation_id = @automation_id
      AND e.entity_type = @entity_type AND e.entity_id = @entity_id
      AND r.status != 'skipped'
      AND r.id != @exclude_run_id
      AND r.created_at > datetime('now', @window)
    ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1
  `),
  countLast24h: db.prepare(`SELECT COUNT(*) AS n FROM automation_runs WHERE created_at > datetime('now', '-1 day')`),
  insertAction: db.prepare(`
    INSERT INTO automation_run_actions (run_id, action_index, action_type, status, result_json, error_summary, started_at, finished_at)
    VALUES (@run_id, @action_index, @action_type, @status, @result_json, @error_summary, datetime('now'), datetime('now'))
  `),
  actionsByRun: db.prepare(`
    SELECT * FROM automation_run_actions WHERE run_id = ? ORDER BY action_index ASC
  `),
  deleteRunsByAutomation: db.prepare(`DELETE FROM automation_runs WHERE automation_id = ? AND tenant_id = ?`),
};

export const pushDedupeQueries = {
  get: db.prepare(`SELECT sent_at FROM push_dedupe WHERE tenant_id = ? AND dedupe_key = ?`),
  upsert: db.prepare(`
    INSERT INTO push_dedupe (tenant_id, dedupe_key, sent_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(tenant_id, dedupe_key) DO UPDATE SET sent_at = datetime('now')
  `),
  deleteByPrefix: db.prepare(`DELETE FROM push_dedupe WHERE tenant_id = ? AND dedupe_key LIKE ?`),
  cleanup: db.prepare(`DELETE FROM push_dedupe WHERE sent_at < datetime('now', '-7 days')`),
};

export const tenantIntegrationQueries = {
  get: db.prepare(`SELECT * FROM tenant_integrations WHERE tenant_id = ? AND provider = ? AND disconnected_at IS NULL`),
  getAny: db.prepare(`SELECT * FROM tenant_integrations WHERE tenant_id = ? AND provider = ?`),
  upsert: db.prepare(`
    INSERT INTO tenant_integrations (tenant_id, provider, access_token, refresh_token, expires_at, external_id, external_url, metadata_json, connected_at, last_sync_at, disconnected_at)
    VALUES (@tenant_id, @provider, @access_token, @refresh_token, @expires_at, @external_id, @external_url, @metadata_json, COALESCE(@connected_at, datetime('now')), @last_sync_at, NULL)
    ON CONFLICT(tenant_id, provider) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, tenant_integrations.refresh_token),
      expires_at = excluded.expires_at,
      external_id = excluded.external_id,
      external_url = excluded.external_url,
      metadata_json = excluded.metadata_json,
      connected_at = COALESCE(tenant_integrations.connected_at, excluded.connected_at),
      disconnected_at = NULL
  `),
  setExternal: db.prepare(`
    UPDATE tenant_integrations
    SET external_id = @external_id, external_url = @external_url, metadata_json = @metadata_json
    WHERE tenant_id = @tenant_id AND provider = @provider
  `),
  setTokens: db.prepare(`
    UPDATE tenant_integrations
    SET access_token = @access_token, refresh_token = COALESCE(@refresh_token, refresh_token), expires_at = @expires_at
    WHERE tenant_id = @tenant_id AND provider = @provider
  `),
  markSynced: db.prepare(`UPDATE tenant_integrations SET last_sync_at = datetime('now') WHERE tenant_id = ? AND provider = ?`),
  disconnect: db.prepare(`
    UPDATE tenant_integrations
    SET access_token = NULL, refresh_token = NULL, disconnected_at = datetime('now')
    WHERE tenant_id = ? AND provider = ?
  `),
};

export const webhookLogQueries = {
  insert: db.prepare(`
    INSERT INTO webhook_log (tenant_id, event_type, payload_json)
    VALUES (@tenant_id, @event_type, @payload_json)
  `),
  markDelivered: db.prepare(`
    UPDATE webhook_log SET status = 'sucesso', http_status = ?, attempts = attempts + 1, delivered_at = datetime('now') WHERE id = ?
  `),
  markFailed: db.prepare(`
    UPDATE webhook_log SET status = 'falha', http_status = ?, attempts = attempts + 1, error = ? WHERE id = ?
  `),
  recentByTenant: db.prepare(`
    SELECT * FROM webhook_log WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT 20
  `),
  // Últimas N entregas (mais recente primeiro) — usado pelo circuit breaker
  // pra decidir se avisa o lojista após falhas consecutivas.
  recentStatuses: db.prepare(`
    SELECT status FROM webhook_log WHERE tenant_id = ? ORDER BY id DESC LIMIT ?
  `),
};

export const freteCalculoQueries = {
  insert: db.prepare(`INSERT INTO frete_calculos (tenant_id, contact_id, cep_destino) VALUES (?, ?, ?)`),
  // Contatos distintos que tiveram frete calculado mas ainda não fecharam venda.
  semCompraCount: db.prepare(`
    SELECT COUNT(DISTINCT fc.contact_id) AS n
    FROM frete_calculos fc
    JOIN contacts c ON c.id = fc.contact_id
    WHERE fc.tenant_id = ? AND c.stage != 'fechado'
  `),
};

export const productWaitlistQueries = {
  // Dedup: mesmo contato não entra duas vezes na espera do mesmo produto.
  existsActive: db.prepare(`
    SELECT 1 FROM product_waitlist
    WHERE tenant_id = ? AND contact_id = ? AND produto_nome = ? AND notified_at IS NULL
  `),
  add: db.prepare(`INSERT INTO product_waitlist (tenant_id, contact_id, produto_nome) VALUES (?, ?, ?)`),
  // Contagem por produto — usado no painel de Configurações pra mostrar "N esperando".
  countsByTenant: db.prepare(`
    SELECT produto_nome, COUNT(*) AS n FROM product_waitlist
    WHERE tenant_id = ? AND notified_at IS NULL
    GROUP BY produto_nome
  `),
  activeByProduto: db.prepare(`
    SELECT pw.*, c.wa_phone, c.name
    FROM product_waitlist pw
    JOIN contacts c ON c.id = pw.contact_id
    WHERE pw.tenant_id = ? AND pw.produto_nome = ? AND pw.notified_at IS NULL
  `),
  // Marca só a entrada específica como notificada — usado após confirmar o
  // envio individual da mensagem, pra não perder da lista quem não recebeu
  // por falha transitória do WhatsApp.
  markNotified: db.prepare(`UPDATE product_waitlist SET notified_at = datetime('now') WHERE id = ?`),
};

// Verifica se um slug já está em uso, ignorando opcionalmente um tenant específico (para re-geração).
const stmtSlugExists = db.prepare(`SELECT 1 FROM tenants WHERE routing_slug = ? AND id != ?`);

// Verifica se um route_code já existe (usado antes de tenantQueries ser definido).
const stmtRouteCodeExists = db.prepare(`SELECT 1 FROM tenants WHERE route_code = ?`);

// Verifica se o par (entry_handle, entry_code) já está em uso.
const stmtEntryRouteExists = db.prepare(`SELECT 1 FROM tenants WHERE entry_handle = ? AND entry_code = ?`);

// Verifica se um attendance_code já está em uso (tenants ativos ou reservados).
const stmtAttendanceCodeInTenants = db.prepare(`SELECT 1 FROM tenants WHERE attendance_code = ?`);
const stmtAttendanceCodeReserved  = db.prepare(`SELECT 1 FROM reserved_attendance_codes WHERE code = ?`);

/**
 * Gera um slug único a partir de uma base, acrescentando "-2", "-3", … se necessário.
 * @param {string} base  Slug desejado (já normalizado por slugify).
 * @param {string} [excludeId='']  ID do tenant a ignorar na verificação de unicidade.
 */
export function generateUniqueSlug(base, excludeId = '') {
  if (!stmtSlugExists.get(base, excludeId)) return base;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`;
    if (!stmtSlugExists.get(candidate, excludeId)) return candidate;
  }
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}

/** Valida se `code` segue o formato TX579 (2 letras maiúsculas + 3 dígitos). */
export function isValidAttendanceCode(code) {
  return typeof code === 'string' && /^[A-Z]{2}[0-9]{3}$/.test(code);
}

/**
 * Gera um attendance_code único no formato TX579 (ex: "TX579").
 * 26² × 10³ = 676.000 combinações possíveis — colisão verificada contra
 * tenants ativos e tabela de reservas.
 */
export function generateUniqueAttendanceCode() {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const D = '0123456789';
  for (let attempt = 0; attempt < 500; attempt++) {
    const code =
      L[randomInt(26)] + L[randomInt(26)] +
      D[randomInt(10)] + D[randomInt(10)] + D[randomInt(10)];
    if (!stmtAttendanceCodeInTenants.get(code) && !stmtAttendanceCodeReserved.get(code)) return code;
  }
  throw new Error('[Attendance Code] Esgotaram as tentativas de gerar código único');
}

/**
 * Gera um route_code Braille único, verificando colisão no banco.
 * Usa crypto.randomInt via generateBrailleCode() — nunca Math.random.
 * Lança erro se não conseguir gerar em 200 tentativas (probabilidade astronomicamente baixa).
 */
export function generateUniqueRouteCode() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const code = generateBrailleCode();
    if (!stmtRouteCodeExists.get(code)) return code;
  }
  throw new Error('[Route Code] Esgotaram as tentativas de gerar código Braille único');
}

/**
 * Converte n em sufixo alfabético: 0→'', 1→'-a', 2→'-b', ..., 26→'-z', 27→'-aa', 28→'-ab', ...
 * Progressão previsível e estável, sem uso de números.
 */
function alphabeticSuffix(n) {
  if (n === 0) return '';
  let s = '';
  let r = n;
  while (r > 0) {
    r--;
    s = String.fromCharCode(97 + (r % 26)) + s;
    r = Math.floor(r / 26);
  }
  return '-' + s;
}

/**
 * Encontra um entry_code disponível dentro do entry_handle especificado.
 * Tenta combinações aleatórias primeiro (eficiente quando há espaço).
 * Se falharem, faz varredura determinística pelas 64 combinações possíveis.
 * Retorna null se todas as 64 combinações do handle estiverem ocupadas.
 */
function generateAvailableEntryCode(entryHandle) {
  // Tentativas aleatórias
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = generateEntryCode();
    if (!stmtEntryRouteExists.get(entryHandle, code)) return code;
  }
  // Varredura determinística — garante encontrar slot se houver algum disponível
  for (const o of OPENING_SYMBOLS) {
    for (const m of MIDDLE_SYMBOLS) {
      for (const q of QUESTION_SYMBOLS) {
        const code = o + m + q;
        if (!stmtEntryRouteExists.get(entryHandle, code)) return code;
      }
    }
  }
  return null; // Todas as 64 combinações deste handle estão ocupadas
}

/**
 * Aloca um par (entry_handle, entry_code) único para um tenant.
 * Se o handle estiver saturado (64 combinações usadas), acrescenta sufixo alfabético:
 *   vilaflor → vilaflor-a → vilaflor-b → ... → vilaflor-z → vilaflor-aa → ...
 * Nunca adiciona números — apenas letras minúsculas.
 * @param {string} businessName  Nome comercial do tenant.
 * @returns {{ handle: string, code: string }}
 */
export function allocateEntryRoute(businessName) {
  const base = createEntryHandle(businessName);
  for (let n = 0; n < 10000; n++) {
    const suffix = alphabeticSuffix(n);
    // Garante que o handle final não ultrapasse 60 caracteres.
    const candidate = (base + suffix).slice(0, 60);
    const code = generateAvailableEntryCode(candidate);
    if (code !== null) return { handle: candidate, code };
  }
  throw new Error('[Entry Route] Impossível alocar entry_handle após 10.000 tentativas');
}

// Atribui route_code a tenants existentes que ainda não têm (idempotente — não substitui os já existentes).
(function migrateRouteCodes() {
  const missing = db.prepare(`SELECT id FROM tenants WHERE route_code IS NULL`).all();
  const update = db.prepare(`UPDATE tenants SET route_code = ? WHERE id = ?`);
  for (const t of missing) {
    update.run(generateUniqueRouteCode(), t.id);
  }
})();

// Gera slug limpo para tenants que ainda não têm (executado uma única vez na inicialização).
(function migrateRoutingSlugs() {
  const missing = db.prepare(`SELECT id, business_name FROM tenants WHERE routing_slug IS NULL`).all();
  const update = db.prepare(`UPDATE tenants SET routing_slug = ? WHERE id = ?`);
  for (const t of missing) {
    const base = slugify(t.business_name || 'loja');
    const slug = generateUniqueSlug(base, t.id);
    update.run(slug, t.id);
  }
})();

// Atribui entry_handle + entry_code a tenants que ainda não têm (idempotente).
(function migrateEntryRoutes() {
  const missing = db.prepare(
    `SELECT id, business_name FROM tenants WHERE entry_handle IS NULL OR entry_code IS NULL`
  ).all();
  const stmt = db.prepare(`UPDATE tenants SET entry_handle = ?, entry_code = ? WHERE id = ?`);
  for (const t of missing) {
    const { handle, code } = allocateEntryRoute(t.business_name || 'loja');
    stmt.run(handle, code, t.id);
  }
})();

// Atribui attendance_code a tenants que ainda não têm (idempotente).
(function migrateAttendanceCodes() {
  const missing = db.prepare(`SELECT id FROM tenants WHERE attendance_code IS NULL`).all();
  const update = db.prepare(`UPDATE tenants SET attendance_code = ? WHERE id = ?`);
  for (const t of missing) {
    update.run(generateUniqueAttendanceCode(), t.id);
  }
})();

// Migra needs_human → handoff_status (idempotente).
(function migrateHandoffStatus() {
  // needs_human=1 → waiting; needs_human=0 → none (only where handoff_status='none' to be idempotent)
  db.exec(`UPDATE contacts SET handoff_status = 'waiting' WHERE needs_human = 1 AND handoff_status = 'none'`);
})();

// Marca o administrador configurado por env, se a conta ja existir.
if (config.adminEmail) {
  db.prepare(`UPDATE tenants SET is_admin = 1, plan = 'elite', subscription_status = 'active' WHERE email = ?`).run(config.adminEmail);
}

// --- Tenants ---
export const tenantQueries = {
  create: db.prepare(`
    INSERT INTO tenants (id, email, password_hash, is_admin, subscription_status, trial_ends_at, terms_accepted_at)
    VALUES (@id, @email, @password_hash, @is_admin, @subscription_status, @trial_ends_at, @terms_accepted_at)
  `),
  byEmail: db.prepare(`SELECT * FROM tenants WHERE email = ?`),
  byId: db.prepare(`SELECT * FROM tenants WHERE id = ?`),
  byPhoneNumberId: db.prepare(`SELECT * FROM tenants WHERE wa_phone_number_id = ?`),
  byStripeCustomer: db.prepare(`SELECT * FROM tenants WHERE stripe_customer_id = ?`),
  markEmailVerified: db.prepare(`UPDATE tenants SET email_verified_at = datetime('now') WHERE id = ?`),
  markOnboardingCompleted: db.prepare(`UPDATE tenants SET onboarding_completed_at = COALESCE(onboarding_completed_at, datetime('now')) WHERE id = ?`),
  // Exclusão real de conta (LGPD, Art. 18, VI). foreign_keys=ON (ver topo do
  // arquivo) faz o ON DELETE CASCADE apagar em cadeia contatos, mensagens,
  // vendas, mídia, notas, tags e tudo mais referenciado por tenant_id/contact_id.
  delete: db.prepare(`DELETE FROM tenants WHERE id = ?`),
  updateSettings: db.prepare(`
    UPDATE tenants SET
      business_name = @business_name,
      atendente_name = @atendente_name,
      business_json = @business_json,
      checkout_url = @checkout_url,
      wa_phone_number_id = @wa_phone_number_id,
      wa_token = @wa_token,
      notify_phone = @notify_phone,
      mp_access_token = @mp_access_token,
      cep_origem = @cep_origem,
      melhor_envio_token = @melhor_envio_token
    WHERE id = @id
  `),
  updateWhatsappConnection: db.prepare(`
    UPDATE tenants SET wa_phone_number_id = @wa_phone_number_id, wa_token = @wa_token WHERE id = @id
  `),
  bySlug: db.prepare(`SELECT * FROM tenants WHERE routing_slug = ?`),
  setSlug: db.prepare(`UPDATE tenants SET routing_slug = ? WHERE id = ?`),
  byRouteCode: db.prepare(`SELECT * FROM tenants WHERE route_code = ?`),
  setRouteCode: db.prepare(`UPDATE tenants SET route_code = ? WHERE id = ?`),
  byEntryRoute: db.prepare(`SELECT * FROM tenants WHERE entry_handle = ? AND entry_code = ?`),
  setEntryRoute: db.prepare(`UPDATE tenants SET entry_handle = ?, entry_code = ? WHERE id = ?`),
  byAttendanceCode: db.prepare(`SELECT * FROM tenants WHERE attendance_code = ?`),
  setAttendanceCode: db.prepare(`UPDATE tenants SET attendance_code = ? WHERE id = ?`),
  setStripeCustomer: db.prepare(`UPDATE tenants SET stripe_customer_id = ? WHERE id = ?`),
  setSubscription: db.prepare(`
    UPDATE tenants SET subscription_status = @status, stripe_subscription_id = @sub_id WHERE id = @id
  `),
  setActive: db.prepare(`UPDATE tenants SET active = ? WHERE id = ?`),
  listAll: db.prepare(`SELECT * FROM tenants ORDER BY created_at DESC`),
  setPlan: db.prepare(`UPDATE tenants SET plan = @plan WHERE id = @id`),
  setPushPreferences: db.prepare(`UPDATE tenants SET push_preferences_json = @prefs WHERE id = @id`),
  grantTemporaryAccess: db.prepare(`
    UPDATE tenants SET
      active = 1,
      plan = @plan,
      subscription_status = 'trialing',
      trial_ends_at = datetime('now', '+' || @days || ' days')
    WHERE id = @id
  `),
  setMpPreapproval: db.prepare(`
    UPDATE tenants SET mp_preapproval_id = @mp_preapproval_id, subscription_status = @status, plan = @plan, billing_period = @billing_period WHERE id = @id
  `),
  byMpPreapproval: db.prepare(`SELECT * FROM tenants WHERE mp_preapproval_id = ?`),
  setDailySummarySentDate: db.prepare(`UPDATE tenants SET daily_summary_sent_date = ? WHERE id = ?`),
  setRepurchaseNoticeSentDate: db.prepare(`UPDATE tenants SET repurchase_notice_sent_date = ? WHERE id = ?`),
  // Update estreito, usado pelo controle de estoque (src/stock.js) pra persistir
  // só o business_json (produtos) sem precisar reconstruir os outros campos que
  // updateSettings exige. Prefira `saveBusinessJson()` — ele garante que os
  // produtos gravados tenham product_id.
  updateBusinessJson: db.prepare(`UPDATE tenants SET business_json = ? WHERE id = ?`),
  setPasswordHash: db.prepare(`UPDATE tenants SET password_hash = ? WHERE id = ?`),
  byGoogleId: db.prepare(`SELECT * FROM tenants WHERE google_id = ?`),
  setGoogleId: db.prepare(`UPDATE tenants SET google_id = ? WHERE id = ?`),

  // Bling OAuth — tokens já vêm cifrados de quem chama (encryptSecret).
  setBlingCredentials: db.prepare(`
    UPDATE tenants SET
      bling_access_token = @bling_access_token,
      bling_refresh_token = @bling_refresh_token,
      bling_token_expires_at = @bling_token_expires_at,
      bling_connected_at = COALESCE(bling_connected_at, datetime('now'))
    WHERE id = @id
  `),
  clearBlingCredentials: db.prepare(`
    UPDATE tenants SET bling_access_token = NULL, bling_refresh_token = NULL, bling_token_expires_at = NULL, bling_connected_at = NULL WHERE id = ?
  `),

  // Nuvemshop OAuth — token não expira (sem refresh_token).
  setNuvemshopCredentials: db.prepare(`
    UPDATE tenants SET
      nuvemshop_access_token = @nuvemshop_access_token,
      nuvemshop_store_id = @nuvemshop_store_id,
      nuvemshop_connected_at = COALESCE(nuvemshop_connected_at, datetime('now'))
    WHERE id = @id
  `),
  clearNuvemshopCredentials: db.prepare(`
    UPDATE tenants SET nuvemshop_access_token = NULL, nuvemshop_store_id = NULL, nuvemshop_connected_at = NULL WHERE id = ?
  `),

  // Tray OAuth — expira e precisa de refresh_token (mesmo padrão do Bling).
  setTrayCredentials: db.prepare(`
    UPDATE tenants SET
      tray_access_token = @tray_access_token,
      tray_refresh_token = @tray_refresh_token,
      tray_token_expires_at = @tray_token_expires_at,
      tray_api_address = @tray_api_address,
      tray_connected_at = COALESCE(tray_connected_at, datetime('now'))
    WHERE id = @id
  `),
  clearTrayCredentials: db.prepare(`
    UPDATE tenants SET tray_access_token = NULL, tray_refresh_token = NULL, tray_token_expires_at = NULL, tray_api_address = NULL, tray_connected_at = NULL WHERE id = ?
  `),

  // Hotmart — não é OAuth, só um token (Hottok) colado pelo lojista.
  setHotmartCredentials: db.prepare(`
    UPDATE tenants SET hotmart_hottok = @hotmart_hottok, hotmart_connected_at = COALESCE(hotmart_connected_at, datetime('now')) WHERE id = @id
  `),
  clearHotmartCredentials: db.prepare(`
    UPDATE tenants SET hotmart_hottok = NULL, hotmart_connected_at = NULL WHERE id = ?
  `),

  // Webhook genérico — secret já vem cifrado de quem chama.
  setWebhookSettings: db.prepare(`
    UPDATE tenants SET webhook_url = @webhook_url, webhook_secret = @webhook_secret, webhook_enabled = @webhook_enabled WHERE id = @id
  `),

  // PrintNode — api_key cifrada.
  setPrintNodeCredentials: db.prepare(`
    UPDATE tenants SET printnode_api_key = @printnode_api_key, printnode_printer_id = @printnode_printer_id WHERE id = @id
  `),
  clearPrintNodeCredentials: db.prepare(`
    UPDATE tenants SET printnode_api_key = NULL, printnode_printer_id = NULL WHERE id = ?
  `),
  updateCapiConfig: db.prepare(`
    UPDATE tenants
       SET capi_enabled = @capi_enabled,
           capi_pixel_id = @capi_pixel_id,
           capi_access_token = @capi_access_token,
           capi_test_code = @capi_test_code,
           capi_graph_version = @capi_graph_version
     WHERE id = @id
  `),
};

/**
 * Grava business_json garantindo que todos os produtos tenham product_id.
 * Esta é a via preferida para qualquer código que modifica biz.produtos —
 * substituindo `tenantQueries.updateBusinessJson.run(JSON.stringify(biz), id)`.
 * O import é dinâmico pra evitar ciclo (products.js não depende de db.js).
 */
import { ensureProductIds as _ensureProductIds } from './products.js';
export function saveBusinessJson(tenantId, biz) {
  const b = biz && typeof biz === 'object' ? biz : {};
  if (Array.isArray(b.produtos)) {
    const { produtos } = _ensureProductIds(b.produtos);
    b.produtos = produtos;
  }
  tenantQueries.updateBusinessJson.run(JSON.stringify(b), tenantId);
  return b;
}

export const customerRouteQueries = {
  byPhone: db.prepare(`SELECT tenant_id FROM customer_routes WHERE phone = ?`),
  upsert: db.prepare(`
    INSERT INTO customer_routes (phone, tenant_id) VALUES (?, ?)
    ON CONFLICT(phone) DO UPDATE SET tenant_id = excluded.tenant_id, created_at = datetime('now')
  `),
  delete: db.prepare(`DELETE FROM customer_routes WHERE phone = ?`),
};

export const waTokenQueries = {
  insert: db.prepare(`INSERT OR REPLACE INTO wa_tokens (token, slug, expires_at) VALUES (?, ?, ?)`),
  byToken: db.prepare(`SELECT slug FROM wa_tokens WHERE token = ? AND expires_at > ?`),
  delete: db.prepare(`DELETE FROM wa_tokens WHERE token = ?`),
  cleanupExpired: db.prepare(`DELETE FROM wa_tokens WHERE expires_at < ?`),
};

/**
 * Wraps a tenant row, decrypting sensitive token fields on read.
 */
export function decryptTenant(tenant) {
  if (!tenant) return tenant;
  return {
    ...tenant,
    wa_token: decryptSecret(tenant.wa_token),
    mp_access_token: decryptSecret(tenant.mp_access_token),
    melhor_envio_token: decryptSecret(tenant.melhor_envio_token),
    bling_access_token: decryptSecret(tenant.bling_access_token),
    bling_refresh_token: decryptSecret(tenant.bling_refresh_token),
    nuvemshop_access_token: decryptSecret(tenant.nuvemshop_access_token),
    tray_access_token: decryptSecret(tenant.tray_access_token),
    tray_refresh_token: decryptSecret(tenant.tray_refresh_token),
    hotmart_hottok: decryptSecret(tenant.hotmart_hottok),
    webhook_secret: decryptSecret(tenant.webhook_secret),
    printnode_api_key: decryptSecret(tenant.printnode_api_key),
    capi_access_token: decryptSecret(tenant.capi_access_token),
  };
}

/**
 * Decifra o CPF/CNPJ (dígitos puros) de um contato, se houver. Retorna null
 * quando não há documento salvo. Quem chama decide se mostra mascarado
 * (padrão, via maskDocument) ou completo (só em ação explícita do usuário).
 */
export function decryptContactDocument(contact) {
  if (!contact?.cpf_cnpj_enc) return null;
  return decryptSecret(contact.cpf_cnpj_enc);
}

// --- Sessions ---
export const sessionQueries = {
  create: db.prepare(`INSERT INTO sessions (token, tenant_id, user_id, expires_at) VALUES (?, ?, ?, datetime('now', '+30 days'))`),
  createImpersonation: db.prepare(
    `INSERT INTO sessions (token, tenant_id, impersonated_by, admin_token, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+30 days'))`
  ),
  byToken: db.prepare(`SELECT * FROM sessions WHERE token = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`),
  delete: db.prepare(`DELETE FROM sessions WHERE token = ?`),
  // Revoga todas as sessões de um tenant, exceto o token atual (usado na troca de senha).
  deleteAllForTenantExcept: db.prepare(`DELETE FROM sessions WHERE tenant_id = ? AND token != ?`),
  touch: db.prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE token = ?`),
  cleanup: db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now', '-1 day')`),
};

// --- Password reset tokens ---
// Guardamos só o HASH do token (SHA-256, feito por auth.js) — o valor cru
// só existe no link enviado por e-mail. Se o banco vazar, o link já emitido
// continua inutilizável. Um único token válido por tenant: o create limpa
// os anteriores para evitar acúmulo/uso paralelo.
export const passwordResetTokenQueries = {
  create: db.prepare(`INSERT INTO password_reset_tokens (token_hash, tenant_id, expires_at) VALUES (?, ?, ?)`),
  byHash: db.prepare(`SELECT * FROM password_reset_tokens WHERE token_hash = ?`),
  markUsed: db.prepare(`UPDATE password_reset_tokens SET used_at = datetime('now') WHERE token_hash = ?`),
  deleteForTenant: db.prepare(`DELETE FROM password_reset_tokens WHERE tenant_id = ?`),
  cleanupExpired: db.prepare(`DELETE FROM password_reset_tokens WHERE datetime(expires_at) < datetime('now', '-1 day')`),
};

// --- Email verification tokens ---
export const emailVerificationTokenQueries = {
  create: db.prepare(`INSERT INTO email_verification_tokens (token_hash, tenant_id, expires_at) VALUES (?, ?, ?)`),
  byHash: db.prepare(`SELECT * FROM email_verification_tokens WHERE token_hash = ?`),
  markUsed: db.prepare(`UPDATE email_verification_tokens SET used_at = datetime('now') WHERE token_hash = ?`),
  deleteForTenant: db.prepare(`DELETE FROM email_verification_tokens WHERE tenant_id = ?`),
  cleanupExpired: db.prepare(`DELETE FROM email_verification_tokens WHERE datetime(expires_at) < datetime('now', '-1 day')`),
};

// --- Contacts ---
export const contactQueries = {
  byPhone: db.prepare(`SELECT * FROM contacts WHERE tenant_id = ? AND wa_phone = ?`),
  byId: db.prepare(`SELECT * FROM contacts WHERE id = ?`),
  insert: db.prepare(`INSERT INTO contacts (tenant_id, wa_phone, name) VALUES (?, ?, ?)`),
  updateAfterTurn: db.prepare(`
    UPDATE contacts SET
      stage = @stage,
      buy_intent = @buy_intent,
      summary = @summary,
      name = COALESCE(@name, name),
      last_produto_mencionado = COALESCE(@last_produto_mencionado, last_produto_mencionado),
      last_produto_mencionado_at = CASE
        WHEN @last_produto_mencionado IS NOT NULL THEN datetime('now')
        ELSE last_produto_mencionado_at
      END,
      last_message_at = datetime('now')
    WHERE id = @id
  `),
  touch: db.prepare(`UPDATE contacts SET last_message_at = datetime('now') WHERE id = ?`),
  setNeedsHuman: db.prepare(`UPDATE contacts SET needs_human = ? WHERE tenant_id = ? AND wa_phone = ?`),
  // Recuperação de turnos: marca/limpa "devendo resposta da IA".
  setPendingAi: db.prepare(`UPDATE contacts SET pending_ai_at = datetime('now') WHERE id = ?`),
  clearPendingAi: db.prepare(`UPDATE contacts SET pending_ai_at = NULL WHERE id = ?`),
  // Turnos presos: enfileirados mas não concluídos (restart/crash). Só recupera
  // os que ainda podem ser atendidos (ativo, sem humano, sem handoff).
  pendingAiStuck: db.prepare(`
    SELECT c.id, c.tenant_id
    FROM contacts c
    JOIN tenants t ON t.id = c.tenant_id
    WHERE c.pending_ai_at IS NOT NULL
      AND c.pending_ai_at < datetime('now', '-90 seconds')
      AND c.pending_ai_at > datetime('now', '-1 day')
      AND t.active = 1
      AND c.needs_human = 0
      AND c.handoff_status = 'none'
    ORDER BY c.pending_ai_at ASC
    LIMIT 50
  `),
  listByTenant: db.prepare(`
    SELECT * FROM contacts WHERE tenant_id = ? AND archived = 0
    ORDER BY last_message_at DESC LIMIT 200
  `),
  listArchivedByTenant: db.prepare(`
    SELECT * FROM contacts WHERE tenant_id = ? AND archived = 1
    ORDER BY archived_at DESC LIMIT 200
  `),
  // Paginação por cursor (last_message_at DESC, id DESC). Pedimos limit+1
  // para detectar has_more sem outra query. `since_t/since_id` são o cursor
  // decodificado; quando null, é a primeira página.
  listByTenantPage: db.prepare(`
    SELECT * FROM contacts
     WHERE tenant_id = @tenant_id
       AND archived = 0
       AND (
         @since_t IS NULL OR
         last_message_at < @since_t OR
         (last_message_at = @since_t AND id < @since_id)
       )
     ORDER BY last_message_at DESC, id DESC
     LIMIT @limit_plus_one
  `),
  listArchivedByTenantPage: db.prepare(`
    SELECT * FROM contacts
     WHERE tenant_id = @tenant_id
       AND archived = 1
       AND (
         @since_t IS NULL OR
         archived_at < @since_t OR
         (archived_at = @since_t AND id < @since_id)
       )
     ORDER BY archived_at DESC, id DESC
     LIMIT @limit_plus_one
  `),
  // Refresh incremental: contatos alterados desde `since` (last_message_at
  // ou stage/handoff atualizado). Front usa pra atualizar cache local sem
  // baixar toda a lista de novo.
  listChangedSince: db.prepare(`
    SELECT * FROM contacts
     WHERE tenant_id = @tenant_id
       AND (last_message_at > @since OR
            (archived_at IS NOT NULL AND archived_at > @since))
     ORDER BY last_message_at DESC, id DESC
     LIMIT @limit
  `),
  archive: db.prepare(`UPDATE contacts SET archived = 1, archived_at = datetime('now') WHERE tenant_id = ? AND wa_phone = ?`),
  unarchive: db.prepare(`UPDATE contacts SET archived = 0, archived_at = NULL WHERE tenant_id = ? AND wa_phone = ?`),
  deleteByPhone: db.prepare(`DELETE FROM contacts WHERE tenant_id = ? AND wa_phone = ?`),
  followUpCandidates: db.prepare(`
    SELECT c.*, t.business_json, t.wa_phone_number_id, t.wa_token, t.business_name
    FROM contacts c
    JOIN tenants t ON t.id = c.tenant_id
    WHERE t.active = 1
      AND c.needs_human = 0
      AND c.stage IN ('orcamento', 'negociacao')
      AND c.follow_up_sent_at IS NULL
      AND datetime(c.last_message_at) < datetime('now', ?)
    ORDER BY c.last_message_at ASC
    LIMIT 100
  `),
  setFollowUpSent: db.prepare(`UPDATE contacts SET follow_up_sent_at = datetime('now') WHERE id = ?`),
  setHandoffStatus: db.prepare(`UPDATE contacts SET handoff_status = ?, handoff_reason = ?, handoff_requested_at = COALESCE(handoff_requested_at, datetime('now')), needs_human = 1 WHERE id = ?`),
  claimHandoff: db.prepare(`UPDATE contacts SET handoff_status = 'in_progress', handoff_started_at = datetime('now') WHERE id = ? AND handoff_status = 'waiting'`),
  releaseHandoff: db.prepare(`UPDATE contacts SET handoff_status = 'none', handoff_resolved_at = datetime('now'), needs_human = 0 WHERE id = ?`),
  setHandoffNotified: db.prepare(`UPDATE contacts SET handoff_notified = 1 WHERE id = ?`),
  updateOffTopic: db.prepare(`UPDATE contacts SET off_topic_count = ?, off_topic_window_started_at = ?, off_topic_muted_until = ? WHERE id = ?`),
  updateAiCalls: db.prepare(`UPDATE contacts SET ai_calls_10min = ?, ai_window_10min_started_at = ?, ai_calls_day = ?, ai_window_day_started_at = ? WHERE id = ?`),
  handoffWaiting: db.prepare(`SELECT c.*, t.business_name FROM contacts c JOIN tenants t ON t.id = c.tenant_id WHERE c.tenant_id = ? AND c.handoff_status = 'waiting' ORDER BY c.handoff_requested_at ASC LIMIT 20`),
  handoffInProgress: db.prepare(`SELECT c.* FROM contacts c WHERE c.tenant_id = ? AND c.handoff_status = 'in_progress' ORDER BY c.handoff_started_at ASC LIMIT 20`),

  // --- CRM leve ---
  setLeadSource: db.prepare(`UPDATE contacts SET lead_source = ?, lead_source_detail = ? WHERE id = ? AND lead_source = 'whatsapp_direto'`),
  updateCrmFields: db.prepare(`
    UPDATE contacts SET
      tipo_cliente    = @tipo_cliente,
      cpf_cnpj_enc    = @cpf_cnpj_enc,
      cpf_cnpj_hash   = @cpf_cnpj_hash,
      razao_social    = @razao_social,
      nome_fantasia   = @nome_fantasia,
      email           = @email,
      cep             = @cep,
      endereco        = @endereco,
      cidade          = @cidade,
      uf              = @uf,
      lead_source     = @lead_source,
      responsavel     = @responsavel,
      prioridade      = @prioridade,
      proxima_tarefa  = @proxima_tarefa,
      prazo_resposta  = @prazo_resposta
    WHERE id = @id AND tenant_id = @tenant_id
  `),
  findByCpfCnpjHash: db.prepare(`SELECT id, name, wa_phone FROM contacts WHERE tenant_id = ? AND cpf_cnpj_hash = ? AND id != ?`),
  assign: db.prepare(`UPDATE contacts SET assigned_user_id = ?, assigned_team_id = ?, assigned_at = datetime('now') WHERE id = ? AND tenant_id = ?`),
};

// --- Tags inteligentes ---
export const contactTagQueries = {
  add: db.prepare(`INSERT OR IGNORE INTO contact_tags (tenant_id, contact_id, tag) VALUES (?, ?, ?)`),
  remove: db.prepare(`DELETE FROM contact_tags WHERE contact_id = ? AND tag = ?`),
  byContact: db.prepare(`SELECT tag FROM contact_tags WHERE contact_id = ? ORDER BY tag ASC`),
  byTenant: db.prepare(`SELECT tag, COUNT(*) AS n FROM contact_tags WHERE tenant_id = ? GROUP BY tag ORDER BY n DESC, tag ASC`),
  contactsByTag: db.prepare(`SELECT contact_id FROM contact_tags WHERE tenant_id = ? AND tag = ?`),
  // Contatos de uma tag com telefone/nome, para audiência de campanha (src/api.js /api/campaigns).
  contactsWithPhoneByTag: db.prepare(`
    SELECT c.id, c.wa_phone, c.name
    FROM contact_tags ct
    JOIN contacts c ON c.id = ct.contact_id
    WHERE ct.tenant_id = ? AND ct.tag = ? AND c.archived = 0
    ORDER BY c.name ASC
  `),
};

// Campanhas segmentadas via template do WhatsApp Business API (Elite) — um
// registro por disparo, guarda contagens para histórico no painel. O envio em
// si roda síncrono na rota (ver src/api.js), sem fila — volume esperado é de
// pequeno lojista (uma tag, algumas dezenas/centenas de contatos).
db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    template_nome  TEXT NOT NULL,
    tag            TEXT NOT NULL,
    total_contatos INTEGER NOT NULL DEFAULT 0,
    enviados       INTEGER NOT NULL DEFAULT 0,
    falhas         INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id, created_at)`);

export const campaignQueries = {
  insert: db.prepare(`
    INSERT INTO campaigns (tenant_id, template_nome, tag, total_contatos, enviados, falhas)
    VALUES (@tenant_id, @template_nome, @tag, @total_contatos, @enviados, @falhas)
  `),
  listByTenant: db.prepare(`SELECT * FROM campaigns WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`),
};

// Fila persistente de envios em massa (campanhas, avisos de reposição etc.).
// Diferente da fila de IA em memória (src/queue.js), esta sobrevive a reinício
// do servidor. O padrão é: rota HTTP cria o job + itens e responde 202; o
// worker (src/outbound-queue.js) processa em background com concorrência
// limitada e justiça por tenant. Nada de manter conexão HTTP aberta enquanto
// dezenas/centenas de mensagens são enviadas.
db.exec(`
  CREATE TABLE IF NOT EXISTS outbound_jobs (
    id                 TEXT PRIMARY KEY,
    tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type               TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending',
    total_items        INTEGER NOT NULL DEFAULT 0,
    pending_items      INTEGER NOT NULL DEFAULT 0,
    sent_items         INTEGER NOT NULL DEFAULT 0,
    failed_items       INTEGER NOT NULL DEFAULT 0,
    cancelled_items    INTEGER NOT NULL DEFAULT 0,
    payload_json       TEXT,
    idempotency_key    TEXT,
    scheduled_at       TEXT,
    next_run_at        TEXT,
    locked_at          TEXT,
    lock_token         TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    started_at         TEXT,
    completed_at       TEXT,
    cancelled_at       TEXT,
    last_error         TEXT
  );
  CREATE TABLE IF NOT EXISTS outbound_job_items (
    id                   TEXT PRIMARY KEY,
    job_id               TEXT NOT NULL REFERENCES outbound_jobs(id) ON DELETE CASCADE,
    tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id           INTEGER,
    destination          TEXT,
    payload_json         TEXT,
    status               TEXT NOT NULL DEFAULT 'pending',
    attempts             INTEGER NOT NULL DEFAULT 0,
    next_attempt_at      TEXT NOT NULL DEFAULT (datetime('now')),
    locked_at            TEXT,
    provider_message_id  TEXT,
    sent_at              TEXT,
    failed_at            TEXT,
    last_error           TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_outbound_jobs_tenant_status ON outbound_jobs(tenant_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_outbound_jobs_status ON outbound_jobs(status, next_run_at);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_jobs_idem ON outbound_jobs(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_outbound_items_job_status ON outbound_job_items(job_id, status);
  CREATE INDEX IF NOT EXISTS idx_outbound_items_status_next ON outbound_job_items(status, next_attempt_at);
  CREATE INDEX IF NOT EXISTS idx_outbound_items_tenant_status ON outbound_job_items(tenant_id, status);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_items_job_contact ON outbound_job_items(job_id, contact_id) WHERE contact_id IS NOT NULL;
`);

export const outboundJobQueries = {
  insert: db.prepare(`
    INSERT INTO outbound_jobs (
      id, tenant_id, type, status, total_items, pending_items,
      payload_json, idempotency_key, scheduled_at, next_run_at
    ) VALUES (
      @id, @tenant_id, @type, 'pending', @total_items, @pending_items,
      @payload_json, @idempotency_key, @scheduled_at, @next_run_at
    )
  `),
  findByIdempotency: db.prepare(`SELECT * FROM outbound_jobs WHERE tenant_id = ? AND idempotency_key = ?`),
  getById: db.prepare(`SELECT * FROM outbound_jobs WHERE id = ? AND tenant_id = ?`),
  listByTenant: db.prepare(`
    SELECT * FROM outbound_jobs WHERE tenant_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ?
  `),
  updateStatus: db.prepare(`UPDATE outbound_jobs SET status = ?, last_error = ? WHERE id = ?`),
  markStarted: db.prepare(`
    UPDATE outbound_jobs SET status = 'processing', started_at = COALESCE(started_at, datetime('now'))
    WHERE id = ? AND status IN ('pending','processing')
  `),
  markCompleted: db.prepare(`
    UPDATE outbound_jobs
       SET status = @status,
           completed_at = datetime('now'),
           last_error = @last_error
     WHERE id = @id
  `),
  markPaused: db.prepare(`UPDATE outbound_jobs SET status = 'paused' WHERE id = ? AND tenant_id = ? AND status IN ('pending','processing')`),
  markResumed: db.prepare(`UPDATE outbound_jobs SET status = 'pending' WHERE id = ? AND tenant_id = ? AND status = 'paused'`),
  markCancelled: db.prepare(`
    UPDATE outbound_jobs SET status = 'cancelled', cancelled_at = datetime('now')
     WHERE id = ? AND tenant_id = ? AND status IN ('pending','processing','paused')
  `),
  refreshCounters: db.prepare(`
    UPDATE outbound_jobs SET
      pending_items   = (SELECT COUNT(*) FROM outbound_job_items WHERE job_id = outbound_jobs.id AND status IN ('pending','retry')),
      sent_items      = (SELECT COUNT(*) FROM outbound_job_items WHERE job_id = outbound_jobs.id AND status = 'sent'),
      failed_items    = (SELECT COUNT(*) FROM outbound_job_items WHERE job_id = outbound_jobs.id AND status = 'failed'),
      cancelled_items = (SELECT COUNT(*) FROM outbound_job_items WHERE job_id = outbound_jobs.id AND status = 'cancelled')
     WHERE id = ?
  `),
  // Retomada após restart: qualquer job em processamento com lock expirado
  // volta para pending (sem trocar de status se o worker atual ainda segura).
  reclaimStale: db.prepare(`
    UPDATE outbound_jobs
       SET locked_at = NULL, lock_token = NULL, status = 'pending'
     WHERE status = 'processing'
       AND (locked_at IS NULL OR locked_at < datetime('now', ?))
  `),
  // Lista de jobs prontos para o worker (pending com next_run_at expirado).
  pickReady: db.prepare(`
    SELECT * FROM outbound_jobs
     WHERE status = 'pending'
       AND (next_run_at IS NULL OR next_run_at <= datetime('now'))
     ORDER BY created_at ASC
     LIMIT ?
  `),
};

export const outboundJobItemQueries = {
  insert: db.prepare(`
    INSERT OR IGNORE INTO outbound_job_items (
      id, job_id, tenant_id, contact_id, destination, payload_json,
      status, next_attempt_at
    ) VALUES (
      @id, @job_id, @tenant_id, @contact_id, @destination, @payload_json,
      'pending', datetime('now')
    )
  `),
  // Reserva atomicamente até N itens PENDING/RETRY prontos, marcando-os como
  // "processing" e gravando um lock_token para o worker reconhecer.
  reserveByJob: db.prepare(`
    UPDATE outbound_job_items
       SET status = 'processing', locked_at = datetime('now')
     WHERE id IN (
       SELECT id FROM outbound_job_items
        WHERE job_id = ? AND status IN ('pending','retry')
          AND next_attempt_at <= datetime('now')
        ORDER BY next_attempt_at ASC, id ASC
        LIMIT ?
     )
     RETURNING *
  `),
  markSent: db.prepare(`
    UPDATE outbound_job_items
       SET status = 'sent', provider_message_id = ?, sent_at = datetime('now'), locked_at = NULL
     WHERE id = ? AND status = 'processing'
  `),
  markRetry: db.prepare(`
    UPDATE outbound_job_items
       SET status = 'retry', attempts = attempts + 1,
           next_attempt_at = ?, last_error = ?, locked_at = NULL
     WHERE id = ? AND status = 'processing'
  `),
  markFailed: db.prepare(`
    UPDATE outbound_job_items
       SET status = 'failed', attempts = attempts + 1,
           failed_at = datetime('now'), last_error = ?, locked_at = NULL
     WHERE id = ? AND status IN ('processing','retry','pending')
  `),
  cancelPending: db.prepare(`
    UPDATE outbound_job_items SET status = 'cancelled', locked_at = NULL
     WHERE job_id = ? AND status IN ('pending','retry','processing')
  `),
  retryFailed: db.prepare(`
    UPDATE outbound_job_items
       SET status = 'pending', next_attempt_at = datetime('now'), locked_at = NULL, last_error = NULL
     WHERE job_id = ? AND status = 'failed'
  `),
  reclaimStale: db.prepare(`
    UPDATE outbound_job_items
       SET status = 'pending', locked_at = NULL
     WHERE status = 'processing' AND (locked_at IS NULL OR locked_at < datetime('now', ?))
  `),
  countByJobStatus: db.prepare(`SELECT status, COUNT(*) AS n FROM outbound_job_items WHERE job_id = ? GROUP BY status`),
  // Listagem paginada de erros por job (para UI de retry). Sem telefone
  // completo por padrão: só id do contato + trecho do erro.
  listFailedByJob: db.prepare(`
    SELECT id, contact_id, attempts, last_error, failed_at
      FROM outbound_job_items
     WHERE job_id = ? AND status = 'failed'
     ORDER BY failed_at DESC LIMIT ?
  `),
  // Usado pelo worker para saber o próximo tenant elegível na rotação.
  distinctTenantsPending: db.prepare(`
    SELECT DISTINCT j.tenant_id
      FROM outbound_jobs j
     WHERE j.status IN ('pending','processing')
       AND EXISTS (
         SELECT 1 FROM outbound_job_items i
          WHERE i.job_id = j.id AND i.status IN ('pending','retry')
            AND i.next_attempt_at <= datetime('now')
       )
  `),
  // Próximo item de um tenant específico (usado para round-robin cross-job).
  nextByTenant: db.prepare(`
    SELECT i.*, j.type AS job_type, j.status AS job_status
      FROM outbound_job_items i
      JOIN outbound_jobs j ON j.id = i.job_id
     WHERE i.tenant_id = ?
       AND i.status IN ('pending','retry')
       AND i.next_attempt_at <= datetime('now')
       AND j.status IN ('pending','processing')
     ORDER BY i.next_attempt_at ASC, i.id ASC
     LIMIT 1
  `),
  reserveById: db.prepare(`
    UPDATE outbound_job_items
       SET status = 'processing', locked_at = datetime('now')
     WHERE id = ? AND status IN ('pending','retry')
     RETURNING *
  `),
};

// --- Catalog files ---
export const catalogFileQueries = {
  upsert: db.prepare(`
    INSERT INTO catalog_files (tenant_id, filename, content)
    VALUES (?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      filename = excluded.filename,
      content  = excluded.content,
      uploaded_at = datetime('now')
  `),
  get: db.prepare(`SELECT filename, content FROM catalog_files WHERE tenant_id = ?`),
  exists: db.prepare(`SELECT 1 AS ok FROM catalog_files WHERE tenant_id = ?`),
  delete: db.prepare(`DELETE FROM catalog_files WHERE tenant_id = ?`),
};

// --- Notes ---
export const noteQueries = {
  insert: db.prepare(`INSERT INTO contact_notes (contact_id, tenant_id, content) VALUES (?, ?, ?)`),
  byContact: db.prepare(`SELECT id, content, created_at FROM contact_notes WHERE contact_id = ? ORDER BY id ASC`),
  delete: db.prepare(`DELETE FROM contact_notes WHERE id = ? AND tenant_id = ?`),
};

// --- Messages ---
// Clientes às vezes digitam o próprio CPF/CNPJ direto na conversa (ex: fluxo de
// checkout PJ em ai.js pede o CNPJ no chat) — sem isso, o número ficava em texto
// puro em messages.content para sempre. Detecta documento com checksum válido
// (evita falso positivo em telefone/código de pedido) e criptografa só esse
// conteúdo, com o mesmo padrão (AES-256-GCM) já usado pro CPF/CNPJ do cadastro.
function containsValidDocument(text) {
  if (!text) return false;
  const candidates = String(text).match(/\d[\d.\-/\s]{9,20}\d/g) || [];
  return candidates.some((c) => {
    const digits = onlyDigits(c);
    return (digits.length === 11 && isValidCPF(digits)) || (digits.length === 14 && isValidCNPJ(digits));
  });
}
function maybeEncryptMessageContent(content) {
  return containsValidDocument(content) ? encryptSecret(content) : content;
}
function decryptMessageRow(row) {
  return row ? { ...row, content: decryptSecret(row.content) } : row;
}

const stmtMsgInsert = db.prepare(`INSERT INTO messages (contact_id, role, content) VALUES (?, ?, ?)`);
const stmtMsgInsertWithMedia = db.prepare(`INSERT INTO messages (contact_id, role, content, media_id) VALUES (?, ?, ?, ?)`);
const stmtMsgInsertWithFlag = db.prepare(`INSERT INTO messages (contact_id, role, content, include_in_ai) VALUES (?, ?, ?, ?)`);
const stmtMsgInsertWithMediaAndFlag = db.prepare(`INSERT INTO messages (contact_id, role, content, media_id, include_in_ai) VALUES (?, ?, ?, ?, ?)`);
const stmtMsgRecentByContact = db.prepare(`
  SELECT role, content FROM messages
  WHERE contact_id = ? ORDER BY id DESC LIMIT 20
`);
const stmtMsgRecentByContactForAI = db.prepare(`SELECT role, content FROM messages WHERE contact_id = ? AND include_in_ai = 1 ORDER BY id DESC LIMIT 12`);
// Paginação de mensagens (id DESC). `before_id` é o cursor: ao rolar para
// cima na conversa, o front pede mensagens anteriores àquele id.
const stmtMsgPageByContact = db.prepare(`
  SELECT * FROM messages
   WHERE contact_id = @contact_id
     AND (@before_id IS NULL OR id < @before_id)
   ORDER BY id DESC
   LIMIT @limit_plus_one
`);

export const messageQueries = {
  insert: { run: (contactId, role, content) => stmtMsgInsert.run(contactId, role, maybeEncryptMessageContent(content)) },
  insertWithMedia: { run: (contactId, role, content, mediaId) => stmtMsgInsertWithMedia.run(contactId, role, maybeEncryptMessageContent(content), mediaId) },
  insertWithFlag: { run: (contactId, role, content, includeInAi) => stmtMsgInsertWithFlag.run(contactId, role, maybeEncryptMessageContent(content), includeInAi) },
  insertWithMediaAndFlag: { run: (contactId, role, content, mediaId, includeInAi) => stmtMsgInsertWithMediaAndFlag.run(contactId, role, maybeEncryptMessageContent(content), mediaId, includeInAi) },
  recentByContact: { all: (contactId) => stmtMsgRecentByContact.all(contactId).map(decryptMessageRow) },
  recentByContactForAI: { all: (contactId) => stmtMsgRecentByContactForAI.all(contactId).map(decryptMessageRow) },
  page: { all: (params) => stmtMsgPageByContact.all(params).map(decryptMessageRow) },
  countByTenant: db.prepare(`
    SELECT COUNT(*) AS n FROM messages m
    JOIN contacts c ON c.id = m.contact_id WHERE c.tenant_id = ?
  `),
};

// --- AI usage tracking ---
export const aiUsageQueries = {
  insert: db.prepare(`INSERT INTO ai_usage (tenant_id, contact_id, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)`),
  countByTenantDay: db.prepare(`SELECT SUM(input_tokens + output_tokens) AS total_tokens, COUNT(*) AS calls FROM ai_usage WHERE tenant_id = ? AND created_at >= datetime('now', 'start of day')`),
  countByContactWindow: db.prepare(`SELECT COUNT(*) AS calls FROM ai_usage WHERE contact_id = ? AND created_at >= datetime('now', ?)`),
  // "Respostas de IA" do plano: 1 linha = 1 turno concluído (contagem usada
  // para o limite mensal exibido ao lojista, ex.: "1.248 de 2.000 usadas").
  countByTenantSince: db.prepare(`SELECT COUNT(*) AS calls FROM ai_usage WHERE tenant_id = ? AND created_at >= ?`),
};

// --- Ciclo de cobrança mensal (base dos limites do plano) ---
const stmtSetBillingCycle = db.prepare(`UPDATE tenants SET billing_cycle_start = ?, billing_cycle_end = ? WHERE id = ?`);

/**
 * Garante que o ciclo de cobrança do tenant está atual (rola mensalmente de
 * forma preguiçosa — sem cron). Retorna { start, end } já vigentes.
 * Primeira chamada: inicializa a partir de created_at.
 */
export function ensureBillingCycle(tenant) {
  let start = tenant.billing_cycle_start;
  let end = tenant.billing_cycle_end;
  if (!start || !end) {
    start = tenant.created_at;
    end = db.prepare(`SELECT datetime(?, '+1 month') AS d`).get(start).d;
  }
  const now = db.prepare(`SELECT datetime('now') AS d`).get().d;
  let rolled = false;
  while (end <= now) {
    start = end;
    end = db.prepare(`SELECT datetime(?, '+1 month') AS d`).get(start).d;
    rolled = true;
  }
  if (rolled || start !== tenant.billing_cycle_start || end !== tenant.billing_cycle_end) {
    stmtSetBillingCycle.run(start, end, tenant.id);
  }
  return { start, end };
}

// --- Transcrição de áudio (minutos/mês) ---
export const audioTranscriptionQueries = {
  insert: db.prepare(`INSERT INTO audio_transcriptions (tenant_id, contact_id, seconds) VALUES (?, ?, ?)`),
  sumSecondsSince: db.prepare(`SELECT COALESCE(SUM(seconds), 0) AS total_seconds FROM audio_transcriptions WHERE tenant_id = ? AND created_at >= ?`),
};

// --- Documentos extras ---
export const extraDocumentQueries = {
  insert: db.prepare(`INSERT INTO extra_documents (id, tenant_id, filename, mime, content, size_bytes) VALUES (?, ?, ?, ?, ?, ?)`),
  listByTenant: db.prepare(`SELECT id, filename, mime, size_bytes, created_at FROM extra_documents WHERE tenant_id = ? ORDER BY created_at DESC`),
  get: db.prepare(`SELECT * FROM extra_documents WHERE id = ? AND tenant_id = ?`),
  countByTenant: db.prepare(`SELECT COUNT(*) AS n FROM extra_documents WHERE tenant_id = ?`),
  delete: db.prepare(`DELETE FROM extra_documents WHERE id = ? AND tenant_id = ?`),
};

// --- Base de conhecimento documental ---
export const knowledgeDocumentQueries = {
  insert: db.prepare(`
    INSERT INTO knowledge_documents (
      id, tenant_id, source_type, source_id, filename, mime_type, size_bytes,
      sha256, status, active, progress_percent
    ) VALUES (
      @id, @tenant_id, @source_type, @source_id, @filename, @mime_type, @size_bytes,
      @sha256, @status, @active, @progress_percent
    )
  `),
  byId: db.prepare(`SELECT * FROM knowledge_documents WHERE id = ?`),
  byIdForTenant: db.prepare(`SELECT * FROM knowledge_documents WHERE id = ? AND tenant_id = ?`),
  findActiveDuplicate: db.prepare(`
    SELECT * FROM knowledge_documents
    WHERE tenant_id = ? AND sha256 = ? AND active = 1 AND status != 'disabled'
    ORDER BY created_at DESC LIMIT 1
  `),
  latestCatalogForTenant: db.prepare(`
    SELECT * FROM knowledge_documents
    WHERE tenant_id = ? AND source_type = 'catalog'
    ORDER BY created_at DESC LIMIT 1
  `),
  listByTenant: db.prepare(`
    SELECT id, source_type, source_id, filename, mime_type, size_bytes, sha256,
           status, active, page_count, indexed_pages, chunks_count, progress_percent,
           error_code, error_message, created_at, updated_at, processed_at, replaced_by_document_id
    FROM knowledge_documents
    WHERE tenant_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `),
  updateQueued: db.prepare(`
    UPDATE knowledge_documents
    SET status = 'queued', progress_percent = 5, updated_at = datetime('now')
    WHERE id = ?
  `),
  updateProgress: db.prepare(`
    UPDATE knowledge_documents
    SET status = @status, progress_percent = @progress_percent, updated_at = datetime('now')
    WHERE id = @id
  `),
  updateExtractedCounts: db.prepare(`
    UPDATE knowledge_documents
    SET page_count = @page_count,
        indexed_pages = @indexed_pages,
        chunks_count = @chunks_count,
        updated_at = datetime('now')
    WHERE id = @id
  `),
  markReady: db.prepare(`
    UPDATE knowledge_documents
    SET status = @status,
        active = 1,
        page_count = @page_count,
        indexed_pages = @indexed_pages,
        chunks_count = @chunks_count,
        progress_percent = 100,
        error_code = @error_code,
        error_message = @error_message,
        processed_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = @id
  `),
  markFailed: db.prepare(`
    UPDATE knowledge_documents
    SET status = @status,
        active = @active,
        progress_percent = @progress_percent,
        error_code = @error_code,
        error_message = @error_message,
        updated_at = datetime('now')
    WHERE id = @id
  `),
  disable: db.prepare(`
    UPDATE knowledge_documents
    SET active = 0, status = CASE WHEN status = 'disabled' THEN status ELSE 'disabled' END, updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `),
  enable: db.prepare(`
    UPDATE knowledge_documents
    SET active = 1, status = CASE WHEN status = 'disabled' THEN 'ready' ELSE status END, updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `),
  supersedeSource: db.prepare(`
    UPDATE knowledge_documents
    SET active = 0,
        replaced_by_document_id = @new_id,
        updated_at = datetime('now')
    WHERE tenant_id = @tenant_id
      AND source_type = @source_type
      AND COALESCE(source_id, '') = COALESCE(@source_id, '')
      AND id != @new_id
      AND active = 1
      AND status IN ('ready', 'partial')
  `),
  delete: db.prepare(`DELETE FROM knowledge_documents WHERE id = ? AND tenant_id = ?`),
  activeUsageByTenant: db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN active = 1 THEN indexed_pages ELSE 0 END), 0) AS pages,
           COALESCE(SUM(CASE WHEN active = 1 THEN chunks_count ELSE 0 END), 0) AS chunks,
           SUM(CASE WHEN active = 1 AND status IN ('ready', 'partial') THEN 1 ELSE 0 END) AS ready,
           SUM(CASE WHEN status IN ('uploaded', 'queued', 'extracting', 'indexing', 'extracting_products') THEN 1 ELSE 0 END) AS processing
    FROM knowledge_documents
    WHERE tenant_id = ? AND status NOT IN ('failed', 'rejected_limit', 'disabled')
  `),
  health: db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('queued', 'uploaded') THEN 1 ELSE 0 END) AS jobs_pending,
      SUM(CASE WHEN status IN ('extracting', 'indexing', 'extracting_products') THEN 1 ELSE 0 END) AS jobs_processing,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS documents_failed,
      SUM(CASE WHEN status IN ('ready', 'partial') THEN 1 ELSE 0 END) AS documents_ready
    FROM knowledge_documents
  `),
};

const stmtKnowledgeChunkInsert = db.prepare(`
  INSERT OR IGNORE INTO knowledge_chunks (
    tenant_id, document_id, page_from, page_to, section_title, content,
    normalized_content, content_hash, metadata_json
  ) VALUES (
    @tenant_id, @document_id, @page_from, @page_to, @section_title, @content,
    @normalized_content, @content_hash, @metadata_json
  )
`);
const stmtKnowledgeFtsInsert = db.prepare(`
  INSERT INTO knowledge_chunks_fts(rowid, section_title, content) VALUES (?, ?, ?)
`);
const stmtKnowledgeFtsDelete = db.prepare(`DELETE FROM knowledge_chunks_fts WHERE rowid = ?`);
const stmtKnowledgeChunksForDelete = db.prepare(`SELECT id FROM knowledge_chunks WHERE document_id = ?`);
const stmtKnowledgeChunksDelete = db.prepare(`DELETE FROM knowledge_chunks WHERE document_id = ?`);

export const knowledgeChunkQueries = {
  insert: {
    run(chunk) {
      const info = stmtKnowledgeChunkInsert.run(chunk);
      if (info.changes > 0) {
        stmtKnowledgeFtsInsert.run(info.lastInsertRowid, chunk.section_title || '', chunk.content);
      }
      return info;
    },
  },
  deleteByDocument: {
    run(documentId) {
      const rows = stmtKnowledgeChunksForDelete.all(documentId);
      for (const row of rows) stmtKnowledgeFtsDelete.run(row.id);
      return stmtKnowledgeChunksDelete.run(documentId);
    },
  },
  listByDocument: db.prepare(`
    SELECT id, page_from, page_to, section_title, content, created_at
    FROM knowledge_chunks
    WHERE tenant_id = ? AND document_id = ?
    ORDER BY page_from, id
    LIMIT ? OFFSET ?
  `),
  countByDocument: db.prepare(`SELECT COUNT(*) AS n FROM knowledge_chunks WHERE document_id = ?`),
};

export const knowledgeJobQueries = {
  insert: db.prepare(`
    INSERT INTO knowledge_jobs (id, tenant_id, document_id, type, status, next_attempt_at)
    VALUES (@id, @tenant_id, @document_id, @type, @status, @next_attempt_at)
  `),
  cancelPendingForDocument: db.prepare(`
    UPDATE knowledge_jobs
    SET status = 'cancelled', completed_at = datetime('now'), last_error = 'cancelled'
    WHERE document_id = ? AND status IN ('pending', 'processing')
  `),
  complete: db.prepare(`
    UPDATE knowledge_jobs
    SET status = 'completed', completed_at = datetime('now'), lock_token = NULL
    WHERE id = ?
  `),
  fail: db.prepare(`
    UPDATE knowledge_jobs
    SET status = @status,
        next_attempt_at = @next_attempt_at,
        locked_at = NULL,
        lock_token = NULL,
        last_error = @last_error,
        completed_at = CASE WHEN @status = 'failed' THEN datetime('now') ELSE completed_at END
    WHERE id = @id
  `),
  metrics: db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM knowledge_jobs
  `),
};

export const knowledgeProductQueries = {
  replaceForDocument: db.transaction((tenantId, documentId, products) => {
    db.prepare(`DELETE FROM knowledge_document_products WHERE document_id = ?`).run(documentId);
    const insert = db.prepare(`
      INSERT INTO knowledge_document_products (tenant_id, document_id, product_json, duplicate_hint)
      VALUES (?, ?, ?, ?)
    `);
    for (const item of products) {
      insert.run(tenantId, documentId, JSON.stringify(item.product), item.duplicate_hint || null);
    }
  }),
  listByDocument: db.prepare(`
    SELECT id, product_json, status, duplicate_hint, created_at
    FROM knowledge_document_products
    WHERE tenant_id = ? AND document_id = ?
    ORDER BY id
  `),
};

export const knowledgeUsageQueries = {
  insert: db.prepare(`
    INSERT INTO knowledge_usage (tenant_id, contact_id, message_id, document_id, chunk_id, score)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
};

// --- Armazenamento usado (soma de BLOBs do tenant) ---
const stmtStorageCatalog = db.prepare(`SELECT COALESCE(SUM(LENGTH(content)), 0) AS n FROM catalog_files WHERE tenant_id = ?`);
const stmtStorageMedia = db.prepare(`SELECT COALESCE(SUM(LENGTH(content)), 0) AS n FROM message_media WHERE tenant_id = ?`);
const stmtStorageDocs = db.prepare(`SELECT COALESCE(SUM(LENGTH(content)), 0) AS n FROM extra_documents WHERE tenant_id = ?`);

/** Armazenamento total usado pelo tenant, em bytes (catálogo + mídia recebida + documentos extras). */
export function storageUsedBytes(tenantId) {
  return (
    stmtStorageCatalog.get(tenantId).n +
    stmtStorageMedia.get(tenantId).n +
    stmtStorageDocs.get(tenantId).n
  );
}

// --- Agenda / agendamentos (MVP profissional individual) ---
db.exec(`
  CREATE TABLE IF NOT EXISTS booking_services (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    duration_minutes  INTEGER NOT NULL DEFAULT 30,
    price_cents       INTEGER NOT NULL DEFAULT 0,
    booking_fee_cents INTEGER NOT NULL DEFAULT 0,
    active            INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_booking_services_tenant
    ON booking_services(tenant_id, active, name);

  CREATE TABLE IF NOT EXISTS appointments (
    id                 TEXT PRIMARY KEY,
    tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id         INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    service_id         TEXT NOT NULL REFERENCES booking_services(id) ON DELETE RESTRICT,
    customer_name      TEXT NOT NULL,
    customer_phone     TEXT,
    starts_at          TEXT NOT NULL,
    ends_at            TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'aguardando_confirmacao',
    fee_status         TEXT NOT NULL DEFAULT 'nao_cobrada',
    fee_amount_cents   INTEGER NOT NULL DEFAULT 0,
    sale_id            TEXT REFERENCES sales(id) ON DELETE SET NULL,
    notes              TEXT,
    confirmed_at       TEXT,
    notified_at        TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_appointments_tenant_start
    ON appointments(tenant_id, starts_at);
  CREATE INDEX IF NOT EXISTS idx_appointments_contact
    ON appointments(contact_id, starts_at);

  CREATE TABLE IF NOT EXISTS booking_settings (
    tenant_id           TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    weekly_json         TEXT NOT NULL DEFAULT '{}',
    min_notice_minutes  INTEGER NOT NULL DEFAULT 60,
    max_advance_days    INTEGER NOT NULL DEFAULT 60,
    buffer_minutes      INTEGER NOT NULL DEFAULT 0,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS booking_blocks (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    starts_at   TEXT NOT NULL,
    ends_at     TEXT NOT NULL,
    reason      TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_booking_blocks_tenant_range
    ON booking_blocks(tenant_id, starts_at, ends_at);
`);

export const bookingServiceQueries = {
  list: db.prepare(`
    SELECT * FROM booking_services
    WHERE tenant_id = ?
    ORDER BY active DESC, name COLLATE NOCASE
  `),
  active: db.prepare(`
    SELECT * FROM booking_services
    WHERE tenant_id = ? AND active = 1
    ORDER BY name COLLATE NOCASE
  `),
  byId: db.prepare(`SELECT * FROM booking_services WHERE id = ? AND tenant_id = ?`),
  insert: db.prepare(`
    INSERT INTO booking_services
      (id, tenant_id, name, duration_minutes, price_cents, booking_fee_cents, active)
    VALUES
      (@id, @tenant_id, @name, @duration_minutes, @price_cents, @booking_fee_cents, @active)
  `),
  update: db.prepare(`
    UPDATE booking_services SET
      name = @name,
      duration_minutes = @duration_minutes,
      price_cents = @price_cents,
      booking_fee_cents = @booking_fee_cents,
      active = @active,
      updated_at = datetime('now')
    WHERE id = @id AND tenant_id = @tenant_id
  `),
};

export const bookingSettingsQueries = {
  byTenant: db.prepare(`SELECT * FROM booking_settings WHERE tenant_id = ?`),
  upsert: db.prepare(`
    INSERT INTO booking_settings
      (tenant_id, weekly_json, min_notice_minutes, max_advance_days, buffer_minutes, updated_at)
    VALUES
      (@tenant_id, @weekly_json, @min_notice_minutes, @max_advance_days, @buffer_minutes, datetime('now'))
    ON CONFLICT(tenant_id) DO UPDATE SET
      weekly_json = excluded.weekly_json,
      min_notice_minutes = excluded.min_notice_minutes,
      max_advance_days = excluded.max_advance_days,
      buffer_minutes = excluded.buffer_minutes,
      updated_at = datetime('now')
  `),
};

export const bookingBlockQueries = {
  listUpcoming: db.prepare(`
    SELECT * FROM booking_blocks
    WHERE tenant_id = ? AND ends_at >= datetime('now')
    ORDER BY starts_at ASC
    LIMIT 100
  `),
  overlapping: db.prepare(`
    SELECT id, starts_at, ends_at, reason
    FROM booking_blocks
    WHERE tenant_id = @tenant_id
      AND starts_at < @ends_at
      AND ends_at > @starts_at
    LIMIT 1
  `),
  insert: db.prepare(`
    INSERT INTO booking_blocks (id, tenant_id, starts_at, ends_at, reason)
    VALUES (@id, @tenant_id, @starts_at, @ends_at, @reason)
  `),
  delete: db.prepare(`DELETE FROM booking_blocks WHERE id = ? AND tenant_id = ?`),
};

export const appointmentQueries = {
  listRange: db.prepare(`
    SELECT a.*, s.name AS service_name, s.duration_minutes, s.price_cents
    FROM appointments a
    JOIN booking_services s ON s.id = a.service_id
    WHERE a.tenant_id = @tenant_id
      AND a.starts_at < @to
      AND a.ends_at > @from
    ORDER BY a.starts_at ASC
  `),
  byId: db.prepare(`
    SELECT a.*, s.name AS service_name, s.duration_minutes, s.price_cents
    FROM appointments a
    JOIN booking_services s ON s.id = a.service_id
    WHERE a.id = ? AND a.tenant_id = ?
  `),
  findConflict: db.prepare(`
    SELECT id, customer_name, starts_at, ends_at
    FROM appointments
    WHERE tenant_id = @tenant_id
      AND status NOT IN ('cancelado', 'nao_compareceu')
      AND starts_at < @ends_at
      AND ends_at > @starts_at
      AND (@ignore_id IS NULL OR id <> @ignore_id)
    LIMIT 1
  `),
  insert: db.prepare(`
    INSERT INTO appointments
      (id, tenant_id, contact_id, service_id, customer_name, customer_phone,
       starts_at, ends_at, status, fee_status, fee_amount_cents, notes)
    VALUES
      (@id, @tenant_id, @contact_id, @service_id, @customer_name, @customer_phone,
       @starts_at, @ends_at, @status, @fee_status, @fee_amount_cents, @notes)
  `),
  updateStatus: db.prepare(`
    UPDATE appointments SET
      status = @status,
      confirmed_at = CASE WHEN @status = 'confirmado' THEN datetime('now') ELSE confirmed_at END,
      updated_at = datetime('now')
    WHERE id = @id AND tenant_id = @tenant_id
  `),
  attachSale: db.prepare(`
    UPDATE appointments SET sale_id = @sale_id, updated_at = datetime('now')
    WHERE id = @id AND tenant_id = @tenant_id
  `),
  bySaleId: db.prepare(`
    SELECT a.*, s.name AS service_name
    FROM appointments a
    JOIN booking_services s ON s.id = a.service_id
    WHERE a.sale_id = ?
  `),
  markFeePaid: db.prepare(`
    UPDATE appointments SET
      fee_status = 'paga',
      status = CASE WHEN status = 'aguardando_pagamento' THEN 'aguardando_confirmacao' ELSE status END,
      updated_at = datetime('now')
    WHERE sale_id = ?
  `),
  markNotified: db.prepare(`
    UPDATE appointments SET notified_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `),
};

// --- Sales / orders ---
export const saleQueries = {
  create: db.prepare(`
    INSERT INTO sales (id, tenant_id, contact_id, status, items_json, total_cents, checkout_url, payment_provider, external_payment_id, notes)
    VALUES (@id, @tenant_id, @contact_id, @status, @items_json, @total_cents, @checkout_url, @payment_provider, @external_payment_id, @notes)
  `),
  latestOpenByContact: db.prepare(`
    SELECT * FROM sales
    WHERE contact_id = ? AND status IN ('rascunho', 'checkout_enviado', 'aguardando_pagamento', 'pending')
    ORDER BY created_at DESC, id DESC LIMIT 1
  `),
  markLatestOpenPaid: db.prepare(`
    UPDATE sales SET status = 'pago', paid_at = COALESCE(paid_at, datetime('now')), updated_at = datetime('now')
    WHERE id = (
      SELECT id FROM sales WHERE contact_id = ? AND status IN ('rascunho', 'checkout_enviado', 'aguardando_pagamento', 'pending') ORDER BY created_at DESC, id DESC LIMIT 1
    )
  `),
  byTenantRecent: db.prepare(`
    SELECT s.*, c.wa_phone, c.name, c.summary
    FROM sales s
    JOIN contacts c ON c.id = s.contact_id
    WHERE s.tenant_id = ?
    ORDER BY s.updated_at DESC, s.created_at DESC
    LIMIT 100
  `),
  // Paginação por cursor (updated_at DESC, id DESC). Filtro opcional por
  // status. `@status IS NULL` deixa passar tudo — clamp já foi feito na rota.
  byTenantPage: db.prepare(`
    SELECT s.*, c.wa_phone, c.name, c.summary
      FROM sales s
      JOIN contacts c ON c.id = s.contact_id
     WHERE s.tenant_id = @tenant_id
       AND (@status IS NULL OR s.status = @status)
       AND (@from_dt IS NULL OR s.updated_at >= @from_dt)
       AND (@to_dt IS NULL OR s.updated_at <= @to_dt)
       AND (
         @since_t IS NULL OR
         s.updated_at < @since_t OR
         (s.updated_at = @since_t AND s.id < @since_id)
       )
     ORDER BY s.updated_at DESC, s.id DESC
     LIMIT @limit_plus_one
  `),
  // Refresh incremental de vendas.
  listChangedSince: db.prepare(`
    SELECT s.*, c.wa_phone, c.name
      FROM sales s
      JOIN contacts c ON c.id = s.contact_id
     WHERE s.tenant_id = @tenant_id
       AND s.updated_at > @since
     ORDER BY s.updated_at DESC, s.id DESC
     LIMIT @limit
  `),
  statsByTenant: db.prepare(`
    SELECT
      COUNT(*) AS total_sales,
      SUM(CASE WHEN status IN ('checkout_enviado', 'aguardando_pagamento', 'pending') THEN 1 ELSE 0 END) AS checkout_enviado,
      SUM(CASE WHEN status IN ('pago', 'paid') THEN 1 ELSE 0 END) AS pagos,
      SUM(CASE WHEN status IN ('perdido', 'rejected', 'cancelled') THEN 1 ELSE 0 END) AS perdidos,
      SUM(CASE WHEN status IN ('pago', 'paid') THEN COALESCE(total_cents, CAST(amount * 100 AS INTEGER)) ELSE 0 END) AS receita_paga_cents,
      SUM(CASE WHEN status IN ('checkout_enviado', 'aguardando_pagamento', 'pending') THEN COALESCE(total_cents, CAST(amount * 100 AS INTEGER)) ELSE 0 END) AS receita_em_aberto_cents
    FROM sales WHERE tenant_id = ?
  `),
  updateStatus: db.prepare(`
    UPDATE sales SET
      status = @status,
      paid_at = CASE WHEN @status IN ('pago', 'paid') THEN COALESCE(paid_at, datetime('now')) ELSE paid_at END,
      updated_at = datetime('now')
    WHERE id = @id AND tenant_id = @tenant_id
  `),
  updateCheckoutDetails: db.prepare(`
    UPDATE sales SET
      status = @status,
      checkout_url = @checkout_url,
      payment_provider = @payment_provider,
      mp_preference_id = @mp_preference_id,
      total_cents = @total_cents,
      amount = @amount,
      updated_at = datetime('now')
    WHERE id = @id AND tenant_id = @tenant_id
  `),
  // Controle de estoque: marca se esta venda já teve estoque descontado, pra
  // devolver certo (e só uma vez) se ela for cancelada depois (src/stock.js).
  setStockAdjusted: db.prepare(`UPDATE sales SET stock_adjusted = ? WHERE id = ?`),

  // LTV por contato: total já pago e nº de compras, agregado sobre vendas
  // pagas. Uma query por tenant (agrupada) — usada nas listagens de contatos
  // e no Painel de Vendas sem N+1.
  ltvByTenant: db.prepare(`
    SELECT contact_id,
           COUNT(*) AS compras,
           SUM(COALESCE(total_cents, CAST(amount * 100 AS INTEGER), 0)) AS total_gasto_cents,
           MAX(COALESCE(paid_at, updated_at, created_at)) AS ultima_compra_at
    FROM sales
    WHERE tenant_id = ? AND contact_id IS NOT NULL AND status IN ('pago', 'paid')
    GROUP BY contact_id
  `),
  
  // Positional and MP specific queries from second schema
  insert: db.prepare(`
    INSERT INTO sales (id, tenant_id, contact_id, status, amount, items, mp_preference_id, total_cents, items_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateStatusMp: db.prepare(`
    UPDATE sales SET status = ?, mp_payment_id = ?, updated_at = datetime('now') WHERE id = ?
  `),
  byId: db.prepare(`SELECT * FROM sales WHERE id = ?`),
  byPreferenceId: db.prepare(`SELECT * FROM sales WHERE mp_preference_id = ?`),
  byTenant: db.prepare(`SELECT * FROM sales WHERE tenant_id = ? ORDER BY created_at DESC`),
  byContact: db.prepare(`SELECT * FROM sales WHERE contact_id = ? ORDER BY created_at DESC`),

  // Bling: marca o pedido como enviado com sucesso (idempotência — pushOrderToBling
  // pula vendas que já têm bling_pedido_id) ou registra o erro pra o lojista ver.
  setBlingPushSuccess: db.prepare(`UPDATE sales SET bling_pedido_id = ?, bling_push_status = 'enviado', bling_push_error = NULL WHERE id = ?`),
  setBlingPushError: db.prepare(`UPDATE sales SET bling_push_status = 'erro', bling_push_error = ? WHERE id = ?`),

  // Melhor Envio — sucesso/falha na geração da etiqueta. setMelhorEnvioLabel
  // limpa erro anterior para permitir retentativa. setMelhorEnvioError guarda
  // motivo pra UI mostrar (saldo insuficiente, endereço inválido, etc).
  setMelhorEnvioLabel: db.prepare(`UPDATE sales SET me_order_id = @me_order_id, me_tracking_code = @me_tracking_code, me_label_url = @me_label_url, me_label_status = 'gerada', me_label_error = NULL WHERE id = @id`),
  setMelhorEnvioError: db.prepare(`UPDATE sales SET me_label_status = 'erro', me_label_error = ? WHERE id = ?`),
  setMelhorEnvioTrackingSent: db.prepare(`UPDATE sales SET me_tracking_sent_at = COALESCE(me_tracking_sent_at, datetime('now')) WHERE id = ?`),

  // Food service: campos de delivery/mesa gravados na criação do pedido.
  setFoodServiceFields: db.prepare(`
    UPDATE sales SET
      order_type       = @order_type,
      delivery_address = @delivery_address,
      table_number     = @table_number,
      estimated_minutes = @estimated_minutes,
      delivery_fee     = @delivery_fee
    WHERE id = @id
  `),

  // Food service: número sequencial da comanda (gerado na impressão).
  setComandaNumber: db.prepare(`UPDATE sales SET comanda_number = ? WHERE id = ?`),
  nextComandaNumber: db.prepare(`
    SELECT COALESCE(MAX(comanda_number), 0) + 1 AS next_n
    FROM sales WHERE tenant_id = ? AND DATE(created_at) = DATE('now')
  `),

  // Fiscal export — vendas de um período (para balancete mensal).
  byTenantPeriod: db.prepare(`
    SELECT s.*, c.wa_phone, c.name AS contact_name
    FROM sales s
    LEFT JOIN contacts c ON c.id = s.contact_id
    WHERE s.tenant_id = ?
      AND s.created_at >= ?
      AND s.created_at < ?
    ORDER BY s.created_at ASC
  `),
};

// --- Message media (fotos, PDFs, vídeos trocados na conversa) ---
export const mediaQueries = {
  insert: db.prepare(`INSERT INTO message_media (id, tenant_id, mime, filename, content) VALUES (?, ?, ?, ?, ?)`),
  get: db.prepare(`SELECT * FROM message_media WHERE id = ?`),
  deleteById: db.prepare(`DELETE FROM message_media WHERE id = ?`),
};



// --- Inbound events ---
// --- Eventos de conversão (medição first-party da landing/cadastro) ---
export const conversionEventQueries = {
  insert: db.prepare(`
    INSERT INTO conversion_events
      (name, session_id, path, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, props_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  countByName: db.prepare(`SELECT name, COUNT(*) AS n FROM conversion_events GROUP BY name`),
  cleanupOld: db.prepare(`DELETE FROM conversion_events WHERE created_at < datetime('now', '-180 day')`),
};

export const inboundEventQueries = {
  insert: db.prepare(`
    INSERT INTO inbound_events (provider, external_event_id, tenant_id, payload_json)
    VALUES (?, ?, ?, ?)
  `),
  claimPending: db.prepare(`
    UPDATE inbound_events SET locked_at = datetime('now'), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM inbound_events
      WHERE status = 'pending'
        AND next_attempt_at <= datetime('now')
        AND (locked_at IS NULL OR locked_at < datetime('now', '-5 minutes'))
      ORDER BY created_at ASC LIMIT 1
    )
    RETURNING *
  `),
  markDone: db.prepare(`UPDATE inbound_events SET status = 'processed', processed_at = datetime('now'), locked_at = NULL WHERE id = ?`),
  markFailed: db.prepare(`
    UPDATE inbound_events SET
      status = CASE WHEN attempts >= 3 THEN 'dead_letter' ELSE 'pending' END,
      next_attempt_at = datetime('now', '+' || (attempts * 5) || ' minutes'),
      last_error = ?,
      locked_at = NULL
    WHERE id = ?
  `),
};

/** Busca ou cria um contato para um tenant. */
/**
 * @param {object} [referral] objeto `referral` do webhook do WhatsApp (Meta), presente
 *   quando o cliente clicou num anúncio "Click to WhatsApp" — sinal gratuito de origem
 *   do lead, sem precisar de integração extra. Só é usado na criação do contato.
 */
export function getOrCreateContact(tenantId, phone, name, referral) {
  let contact = contactQueries.byPhone.get(tenantId, phone);
  const wasCreated = !contact;
  if (!contact) {
    contactQueries.insert.run(tenantId, phone, name || null);
    contact = contactQueries.byPhone.get(tenantId, phone);
    contactTagQueries.add.run(tenantId, contact.id, 'cliente novo');
    if (referral) {
      const source = referral.source_type === 'ad' ? 'meta_ads' : 'instagram_facebook';
      contactQueries.setLeadSource.run(source, referral.headline || referral.source_url || null, contact.id);
      contact = contactQueries.byPhone.get(tenantId, phone);
    }
  }
  // Marca não-persistida (não é coluna do banco) pra quem chamou saber se deve
  // disparar o evento de webhook "contact.created" — só na criação de verdade.
  contact._wasCreated = wasCreated;
  return contact;
}

/** Historico recente no formato esperado pela API do Claude (ordem cronologica).
 * Filtra apenas mensagens com include_in_ai = 1 e limita a 12. */
export function getConversation(contactId) {
  const rows = messageQueries.recentByContactForAI.all(contactId);
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

/**
 * Status efetivo da assinatura de um tenant.
 * Sem billing configurado, todos sao tratados como ativos.
 */
export function subscriptionState(tenant) {
  // Se nenhum sistema de cobrança estiver configurado, todos têm acesso livre.
  if (!billingEnabled && !mpBillingEnabled) return { status: 'ativo', canUseBot: true };
  if (tenant.subscription_status === 'active') {
    return { status: 'ativo', canUseBot: true };
  }
  if (tenant.subscription_status === 'trialing') {
    const ok = tenant.trial_ends_at && new Date(tenant.trial_ends_at) > new Date();
    return { status: ok ? 'trial' : 'trial_expirado', canUseBot: ok };
  }
  return { status: tenant.subscription_status || 'inativo', canUseBot: false };
}

/**
 * Retorna o plano do tenant ('essencial', 'pro', 'elite').
 */
export function tenantPlan(tenant) {
  return tenant?.plan || 'essencial';
}

// --- Entry tokens (landing page session tokens) ---
const entryTokenQueries = {
  create:  db.prepare(`INSERT OR REPLACE INTO entry_tokens (token, tenant_id, expires_at) VALUES (?, ?, ?)`),
  get:     db.prepare(`SELECT tenant_id FROM entry_tokens WHERE token = ? AND expires_at > ?`),
  delete:  db.prepare(`DELETE FROM entry_tokens WHERE token = ?`),
  cleanup: db.prepare(`DELETE FROM entry_tokens WHERE expires_at < ?`),
};

/**
 * Gera um token único de 6 dígitos hexadecimais (uppercase) associado a um tenant.
 * TTL de 4 horas — cobre o caso de o usuário clicar no link e enviar depois.
 * Retorna o token gerado (ex: "A1B2C3").
 */
export function createEntryToken(tenantId) {
  const token = randomBytes(3).toString('hex').toUpperCase();
  const expiresAt = Date.now() + 4 * 60 * 60 * 1000;
  entryTokenQueries.create.run(token, tenantId, expiresAt);
  return token;
}

/**
 * Resolve um token de sessão → tenant_id (ou null se expirado/inválido).
 * Consome o token após uso para evitar replay.
 */
export function resolveEntryToken(token) {
  const row = entryTokenQueries.get.get(token, Date.now());
  if (row) entryTokenQueries.delete.run(token);
  return row?.tenant_id ?? null;
}

// --- Idempotência de webhooks: dedup por message.id ---
// A Meta reenvia webhooks (ex.: se não recebeu o 200 a tempo). Sem dedup, o
// mesmo message.id seria processado 2x e o cliente receberia resposta duplicada.
db.exec(`
  CREATE TABLE IF NOT EXISTS processed_messages (
    message_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
const stmtMarkProcessed = db.prepare(`INSERT OR IGNORE INTO processed_messages (message_id) VALUES (?)`);
const stmtCleanupProcessed = db.prepare(`DELETE FROM processed_messages WHERE created_at < datetime('now', '-3 days')`);

/**
 * Registra um message_id como processado. Retorna true se É DUPLICADO (já foi
 * processado antes) e deve ser ignorado; false se é novo (deve processar).
 * Sem message_id, nunca trata como duplicado (processa).
 */
export function isDuplicateInboundMessage(messageId) {
  if (!messageId) return false;
  const info = stmtMarkProcessed.run(String(messageId));
  return info.changes === 0; // 0 = já existia = duplicado
}

// --- Expurgo de mídia antiga (protege o disco do Render) ---
// Fotos/áudios/vídeos/PDFs trocados no chat são BLOBs no banco. Sem expurgo,
// crescem indefinidamente até esgotar o disco. O prazo de retenção é POR
// PLANO (7/15/30/60 dias) — cada plano paga por mais ou menos histórico.
const stmtActiveTenants = db.prepare(`SELECT id, plan, subscription_status, trial_ends_at FROM tenants WHERE active = 1`);
const stmtDeleteOldMediaForTenant = db.prepare(
  `DELETE FROM message_media WHERE tenant_id = ? AND created_at < datetime('now', ?)`
);

function cleanupMediaByPlan() {
  let totalDeleted = 0;
  for (const t of stmtActiveTenants.all()) {
    const sub = subscriptionState(t);
    const limits = getPlanLimits(t.plan, sub.status);
    const info = stmtDeleteOldMediaForTenant.run(t.id, `-${limits.mediaRetentionDays} days`);
    totalDeleted += info.changes;
  }
  return totalDeleted;
}

// --- Expurgo de mensagens de texto de contatos inativos (LGPD: minimização de
// retenção) ---
// Diferente da mídia, o texto da conversa não pesa no disco — mas ficava
// guardado para sempre, mesmo depois que o contato parava de responder, sem
// nenhuma finalidade de negócio pra isso. Um contato que não troca mensagem há
// 12 meses não tem mais atendimento em andamento: apaga o histórico de
// mensagens, mas mantém o contato e as vendas (histórico financeiro/fiscal).
const MESSAGE_RETENTION_INACTIVE_DAYS = 365;
const stmtDeleteOldMessagesForInactiveContacts = db.prepare(
  `DELETE FROM messages WHERE contact_id IN (
     SELECT id FROM contacts WHERE last_message_at < datetime('now', ?)
   )`
);
export function cleanupInactiveMessages() {
  const info = stmtDeleteOldMessagesForInactiveContacts.run(`-${MESSAGE_RETENTION_INACTIVE_DAYS} days`);
  return info.changes;
}

// --- Migração idempotente: product_id em business_json.produtos ---------
// Percorre todos os tenants uma vez no boot; para cada produto sem
// product_id, gera um novo. Se nenhum produto precisou mudar, o
// business_json não é reescrito. Rodar de novo é seguro (sem efeitos).
//
// Também faz backfill do product_id em blingProductMap/nuvemshopProductMap
// por SKU (inequívoco) ou nome exato (fallback), quando aplicável. Se
// houver ambiguidade, deixa em branco: sincronização continua funcionando
// pelo nome até o vínculo ficar claro.
import { ensureProductIds, backfillProductIdForMapping } from './products.js';

function migrateProductIds() {
  const tenants = db.prepare(`SELECT id, business_json FROM tenants`).all();
  let tenantsUpdated = 0;
  let productsIded = 0;
  let mapsBackfilled = 0;
  const updateBiz = db.prepare(`UPDATE tenants SET business_json = ? WHERE id = ?`);
  const updateBlingMap = db.prepare(`UPDATE bling_product_map SET product_id = ? WHERE id = ? AND (product_id IS NULL OR product_id = '')`);
  const updateNuvemshopMap = db.prepare(`UPDATE nuvemshop_product_map SET product_id = ? WHERE id = ? AND (product_id IS NULL OR product_id = '')`);
  for (const t of tenants) {
    let biz;
    try { biz = JSON.parse(t.business_json || '{}'); } catch { continue; }
    if (!biz || typeof biz !== 'object') continue;
    if (!Array.isArray(biz.produtos)) continue;
    const before = biz.produtos.filter((p) => p && p.product_id).length;
    const { produtos, changed } = ensureProductIds(biz.produtos);
    if (changed) {
      biz.produtos = produtos;
      updateBiz.run(JSON.stringify(biz), t.id);
      tenantsUpdated++;
      productsIded += produtos.length - before;
    }
    // Backfill dos mapas externos sem escrever contas comerciais em log.
    const blingRows = db.prepare(`SELECT id, produto_nome, produto_codigo, bling_sku, product_id FROM bling_product_map WHERE tenant_id = ?`).all(t.id);
    for (const row of blingRows) {
      if (row.product_id) continue;
      const pid = backfillProductIdForMapping(produtos, {
        produto_nome: row.produto_nome,
        external_sku: row.bling_sku || row.produto_codigo,
      });
      if (pid) { updateBlingMap.run(pid, row.id); mapsBackfilled++; }
    }
    const nsRows = db.prepare(`SELECT id, produto_nome, nuvemshop_sku, product_id FROM nuvemshop_product_map WHERE tenant_id = ?`).all(t.id);
    for (const row of nsRows) {
      if (row.product_id) continue;
      const pid = backfillProductIdForMapping(produtos, {
        produto_nome: row.produto_nome,
        external_sku: row.nuvemshop_sku,
      });
      if (pid) { updateNuvemshopMap.run(pid, row.id); mapsBackfilled++; }
    }
  }
  if (tenantsUpdated || mapsBackfilled) {
    console.log(`[migração] product_id: ${productsIded} produto(s) em ${tenantsUpdated} tenant(s), ${mapsBackfilled} mapeamento(s) externo(s) atualizado(s).`);
  }
}
migrateProductIds();

// Run session cleanup on startup
sessionQueries.cleanup.run();
entryTokenQueries.cleanup.run(Date.now());
// Schedule periodic cleanup every hour. unref() para não impedir o encerramento
// limpo do processo (ex.: em testes e no shutdown do servidor).
setInterval(() => {
  try {
    sessionQueries.cleanup.run();
    entryTokenQueries.cleanup.run(Date.now());
    stmtCleanupProcessed.run();
    const deleted = cleanupMediaByPlan();
    if (deleted > 0) console.log(`[cleanup] ${deleted} mídia(s) antiga(s) removida(s) (retenção por plano)`);
    const deletedMsgs = cleanupInactiveMessages();
    if (deletedMsgs > 0) console.log(`[cleanup] ${deletedMsgs} mensagem(ns) de contato(s) inativo(s) há +${MESSAGE_RETENTION_INACTIVE_DAYS} dias removida(s)`);
  } catch (e) { console.error('Cleanup error:', e); }
}, 60 * 60 * 1000).unref();

// --- Marketing, Attribution & Conversion event queries ---
export const marketingLinkQueries = {
  insert: db.prepare(`
    INSERT INTO marketing_links (id, tenant_id, name, slug, source, medium, campaign, content, term, meta_campaign_id, meta_adset_id, meta_ad_id, notes, active)
    VALUES (@id, @tenant_id, @name, @slug, @source, @medium, @campaign, @content, @term, @meta_campaign_id, @meta_adset_id, @meta_ad_id, @notes, @active)
  `),
  update: db.prepare(`
    UPDATE marketing_links
       SET name = @name, source = @source, medium = @medium, campaign = @campaign, content = @content, term = @term,
           meta_campaign_id = @meta_campaign_id, meta_adset_id = @meta_adset_id, meta_ad_id = @meta_ad_id, notes = @notes, active = @active, updated_at = datetime('now')
     WHERE id = @id AND tenant_id = @tenant_id
  `),
  delete: db.prepare(`DELETE FROM marketing_links WHERE id = ? AND tenant_id = ?`),
  byId: db.prepare(`SELECT * FROM marketing_links WHERE id = ? AND tenant_id = ?`),
  bySlug: db.prepare(`SELECT * FROM marketing_links WHERE slug = ?`),
  byTenantSlug: db.prepare(`SELECT * FROM marketing_links WHERE tenant_id = ? AND slug = ?`),
  listByTenant: db.prepare(`
    SELECT * FROM marketing_links
     WHERE tenant_id = ?
     ORDER BY created_at DESC
  `),
  countByTenant: db.prepare(`SELECT COUNT(*) as count FROM marketing_links WHERE tenant_id = ?`),
  toggleActive: db.prepare(`UPDATE marketing_links SET active = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`),
};

export const attributionClickQueries = {
  insert: db.prepare(`
    INSERT INTO attribution_clicks (id, tenant_id, marketing_link_id, entry_token_hash, anonymous_session_id, fbclid, gclid, ttclid, msclkid, referrer, user_agent_summary, expires_at)
    VALUES (@id, @tenant_id, @marketing_link_id, @entry_token_hash, @anonymous_session_id, @fbclid, @gclid, @ttclid, @msclkid, @referrer, @user_agent_summary, @expires_at)
  `),
  byTokenHash: db.prepare(`
    SELECT * FROM attribution_clicks
     WHERE entry_token_hash = ? AND expires_at > datetime('now')
  `),
  linkContact: db.prepare(`
    UPDATE attribution_clicks
       SET matched_contact_id = ?, matched_at = datetime('now')
     WHERE id = ?
  `),
  byId: db.prepare(`SELECT * FROM attribution_clicks WHERE id = ?`),
};

export const contactAttributionQueries = {
  get: db.prepare(`SELECT * FROM contact_attributions WHERE contact_id = ? AND tenant_id = ?`),
  insert: db.prepare(`
    INSERT INTO contact_attributions (id, tenant_id, contact_id, first_touch_click_id, last_touch_click_id, first_touch_at, last_touch_at)
    VALUES (@id, @tenant_id, @contact_id, @first_touch_click_id, @last_touch_click_id, @first_touch_at, @last_touch_at)
  `),
  updateLastTouch: db.prepare(`
    UPDATE contact_attributions
       SET last_touch_click_id = ?, last_touch_at = ?, updated_at = datetime('now')
     WHERE contact_id = ? AND tenant_id = ?
  `),
  deleteByContact: db.prepare(`DELETE FROM contact_attributions WHERE contact_id = ? AND tenant_id = ?`),
};

export const marketingConversionQueries = {
  insert: db.prepare(`
    INSERT OR IGNORE INTO marketing_conversions (id, tenant_id, contact_id, sale_id, event_name, event_id, event_time, attribution_model, marketing_link_id, value_cents, currency, payload_json)
    VALUES (@id, @tenant_id, @contact_id, @sale_id, @event_name, @event_id, @event_time, @attribution_model, @marketing_link_id, @value_cents, @currency, @payload_json)
  `),
  byId: db.prepare(`SELECT * FROM marketing_conversions WHERE id = ? AND tenant_id = ?`),
  byEventId: db.prepare(`SELECT * FROM marketing_conversions WHERE event_id = ? AND tenant_id = ?`),
  listRecentByTenant: db.prepare(`
    SELECT ce.*, c.name as contact_name, c.wa_phone as contact_phone
      FROM marketing_conversions ce
      JOIN contacts c ON c.id = ce.contact_id
     WHERE ce.tenant_id = ?
     ORDER BY ce.created_at DESC
     LIMIT ? OFFSET ?
  `),
  countByTenant: db.prepare(`SELECT COUNT(*) as count FROM marketing_conversions WHERE tenant_id = ?`),
};

export const conversionJobQueries = {
  insert: db.prepare(`
    INSERT INTO conversion_delivery_jobs (id, tenant_id, conversion_event_id, provider)
    VALUES (?, ?, ?, ?)
  `),
  nextByTenant: db.prepare(`
    SELECT j.*, e.event_name, e.event_id, e.event_time, e.value_cents, e.currency, e.payload_json, e.contact_id
      FROM conversion_delivery_jobs j
      JOIN marketing_conversions e ON e.id = j.conversion_event_id
     WHERE j.tenant_id = ?
       AND j.status IN ('pending', 'retry')
       AND j.next_attempt_at <= datetime('now')
     ORDER BY j.created_at ASC
     LIMIT 1
  `),
  distinctTenantsPending: db.prepare(`
    SELECT DISTINCT tenant_id
      FROM conversion_delivery_jobs
     WHERE status IN ('pending', 'retry')
       AND next_attempt_at <= datetime('now')
  `),
  reserveById: db.prepare(`
    UPDATE conversion_delivery_jobs
       SET status = 'processing', locked_at = datetime('now'), lock_token = ?
     WHERE id = ? AND status IN ('pending', 'retry')
     RETURNING *
  `),
  markCompleted: db.prepare(`
    UPDATE conversion_delivery_jobs
       SET status = 'completed', completed_at = datetime('now')
     WHERE id = ?
  `),
  markRetry: db.prepare(`
    UPDATE conversion_delivery_jobs
       SET status = 'retry', attempts = attempts + 1, next_attempt_at = ?, locked_at = NULL, lock_token = NULL, last_error_code = ?, last_error_summary = ?
     WHERE id = ?
  `),
  markFailed: db.prepare(`
    UPDATE conversion_delivery_jobs
       SET status = 'failed', locked_at = NULL, lock_token = NULL, last_error_code = ?, last_error_summary = ?
     WHERE id = ?
  `),
  reclaimStale: db.prepare(`
    UPDATE conversion_delivery_jobs
       SET status = 'retry', locked_at = NULL, lock_token = NULL
     WHERE status = 'processing' AND locked_at < datetime('now', ?)
  `),
  countRecentSuccess24h: db.prepare(`
    SELECT COUNT(*) as count FROM conversion_delivery_jobs
     WHERE tenant_id = ? AND status = 'completed' AND completed_at >= datetime('now', '-24 hours')
  `),
  countPending: db.prepare(`
    SELECT COUNT(*) as count FROM conversion_delivery_jobs
     WHERE tenant_id = ? AND status IN ('pending', 'retry')
  `),
  lastError: db.prepare(`
    SELECT last_error_code, last_error_summary, created_at FROM conversion_delivery_jobs
     WHERE tenant_id = ? AND status = 'failed'
     ORDER BY created_at DESC
     LIMIT 1
  `),
  lastCompleted: db.prepare(`
    SELECT completed_at, conversion_event_id FROM conversion_delivery_jobs
     WHERE tenant_id = ? AND status = 'completed'
     ORDER BY completed_at DESC
     LIMIT 1
  `),
};

export const userQueries = {
  create: db.prepare(`
    INSERT INTO users (id, tenant_id, email, password_hash, name, role, active, available)
    VALUES (@id, @tenant_id, @email, @password_hash, @name, @role, @active, @available)
  `),
  byId: db.prepare(`SELECT * FROM users WHERE id = ?`),
  byEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  listByTenant: db.prepare(`SELECT id, email, name, role, active, available, created_at FROM users WHERE tenant_id = ? ORDER BY name ASC`),
  delete: db.prepare(`DELETE FROM users WHERE id = ? AND tenant_id = ?`),
  updateRole: db.prepare(`UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`),
  toggleActive: db.prepare(`UPDATE users SET active = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`),
  updateAvailable: db.prepare(`UPDATE users SET available = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`),
  getAvailableRoundRobin: db.prepare(`
    SELECT u.* FROM users u
     WHERE u.tenant_id = ? AND u.active = 1 AND u.available = 1
     ORDER BY (SELECT COUNT(*) FROM contacts c WHERE c.assigned_user_id = u.id) ASC, u.id ASC
     LIMIT 1
  `),
  getAvailableRoundRobinForTeam: db.prepare(`
    SELECT u.* FROM users u
      JOIN team_users tu ON tu.user_id = u.id
     WHERE tu.team_id = ? AND u.active = 1 AND u.available = 1
     ORDER BY (SELECT COUNT(*) FROM contacts c WHERE c.assigned_user_id = u.id) ASC, u.id ASC
     LIMIT 1
  `),
};

export const teamQueries = {
  create: db.prepare(`
    INSERT INTO teams (id, tenant_id, name, description)
    VALUES (@id, @tenant_id, @name, @description)
  `),
  byId: db.prepare(`SELECT * FROM teams WHERE id = ? AND tenant_id = ?`),
  listByTenant: db.prepare(`SELECT * FROM teams WHERE tenant_id = ? ORDER BY name ASC`),
  update: db.prepare(`UPDATE teams SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`),
  delete: db.prepare(`DELETE FROM teams WHERE id = ? AND tenant_id = ?`),
};

export const teamUserQueries = {
  add: db.prepare(`INSERT OR IGNORE INTO team_users (team_id, user_id) VALUES (?, ?)`),
  remove: db.prepare(`DELETE FROM team_users WHERE team_id = ? AND user_id = ?`),
  listMembers: db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.active, u.available
      FROM team_users tu
      JOIN users u ON u.id = tu.user_id
     WHERE tu.team_id = ?
     ORDER BY u.name ASC
  `),
  listUserTeams: db.prepare(`
    SELECT t.* FROM team_users tu
      JOIN teams t ON t.id = tu.team_id
     WHERE tu.user_id = ?
     ORDER BY t.name ASC
  `),
  clearTeam: db.prepare(`DELETE FROM team_users WHERE team_id = ?`),
};

export const userInvitationQueries = {
  create: db.prepare(`
    INSERT INTO user_invitations (id, tenant_id, email, role, token, expires_at)
    VALUES (@id, @tenant_id, @email, @role, @token, @expires_at)
  `),
  byToken: db.prepare(`SELECT * FROM user_invitations WHERE token = ? AND expires_at > datetime('now')`),
  delete: db.prepare(`DELETE FROM user_invitations WHERE id = ?`),
  deleteByToken: db.prepare(`DELETE FROM user_invitations WHERE token = ?`),
  listByTenant: db.prepare(`SELECT * FROM user_invitations WHERE tenant_id = ? ORDER BY created_at DESC`),
};
