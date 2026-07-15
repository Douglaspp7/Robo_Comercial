/**
 * Saúde da conexão Meta (WhatsApp Cloud API) — verificação + telemetria.
 *
 * O Zapien roda com um número compartilhado da plataforma (config.whatsapp) e,
 * opcionalmente, credenciais próprias por tenant (wa_phone_number_id/wa_token
 * via Embedded Signup). A verificação de credencial é feita POR CONJUNTO DE
 * CREDENCIAL (a plataforma é checada uma vez, não uma vez por tenant); a
 * telemetria (último inbound/outbound/erro) é sempre POR TENANT.
 *
 * Regras importantes:
 *  - ausência de tráfego NUNCA vira "desconectado" — só erro real de API/token;
 *  - uma falha aqui nunca derruba o atendimento: tudo é best-effort;
 *  - nenhum token aparece em retorno, log ou tabela;
 *  - campos da Graph API variam por versão/permissão → degrade gracioso.
 */
import { config } from './config.js';
import { fetchWithTimeout } from './http.js';
import {
  db,
  metaHealthQueries,
  tenantQueries,
  notificationQueries,
  decryptTenant,
} from './db.js';
import { sendPushEvent, clearPushDedupe } from './push.js';

export const PLATFORM_KEY = '_platform';

export const metaHealthConfig = {
  enabled: process.env.META_HEALTH_ENABLED !== 'false',
  intervalMs: Math.max(60_000, Number(process.env.META_HEALTH_INTERVAL_MS) || 900_000),
  concurrency: Math.max(1, Number(process.env.META_HEALTH_CONCURRENCY) || 2),
  timeoutMs: Math.max(2_000, Number(process.env.META_HEALTH_TIMEOUT_MS) || 10_000),
  // Cooldown do push de conexão crítica (novo push antes disso só se o código
  // do erro mudar ou se o problema resolver e voltar).
  criticalPushCooldownMin: Math.max(15, Number(process.env.META_CRITICAL_PUSH_COOLDOWN_MIN) || 360),
};

// fetch injetável para testes (nunca usar fetch cru — sempre com timeout).
let fetchImpl = (url, options) => fetchWithTimeout(url, options, metaHealthConfig.timeoutMs);
export function _setFetchForTesting(fn) { fetchImpl = fn; }
export function _resetFetchForTesting() {
  fetchImpl = (url, options) => fetchWithTimeout(url, options, metaHealthConfig.timeoutMs);
}

function graphBase() {
  return `https://graph.facebook.com/${config.whatsapp.apiVersion}`;
}

/**
 * Resolve qual credencial Meta vale para um tenant.
 * @returns {{source:'tenant'|'platform', phoneNumberId:string, token:string}|null}
 */
export function resolveMetaCredentials(tenant) {
  if (tenant?.wa_phone_number_id && tenant?.wa_token) {
    return { source: 'tenant', phoneNumberId: tenant.wa_phone_number_id, token: tenant.wa_token };
  }
  if (config.whatsapp.phoneNumberId && config.whatsapp.token) {
    return { source: 'platform', phoneNumberId: config.whatsapp.phoneNumberId, token: config.whatsapp.token };
  }
  return null;
}

/** Phone Number ID parcialmente mascarado (nunca expor inteiro na UI). */
export function maskPhoneNumberId(id) {
  const s = String(id || '');
  if (s.length <= 8) return s ? s.slice(0, 2) + '…' : '';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * Extrai um resumo SEGURO de um corpo de erro da Meta: só código + mensagem
 * curta, nunca o corpo inteiro (pode ecoar payload) e nunca tokens.
 */
export function summarizeMetaError(httpStatus, bodyText) {
  let code = httpStatus ? String(httpStatus) : null;
  let summary = '';
  try {
    const parsed = JSON.parse(bodyText || '{}');
    const err = parsed.error || {};
    if (err.code != null) code = String(err.code);
    summary = String(err.message || err.error_user_msg || '').slice(0, 160);
  } catch {
    summary = String(bodyText || '').slice(0, 120);
  }
  // Defesa extra: nunca deixar passar um bearer token por engano.
  summary = summary.replace(/Bearer\s+\S+/gi, 'Bearer [oculto]');
  return { code, summary };
}

// ── Telemetria leve (chamada pelos fluxos reais de webhook/envio) ────────────
export function recordInbound(tenantId) {
  if (!tenantId) return;
  try { metaHealthQueries.recordInbound.run(tenantId); } catch { /* nunca travar o atendimento */ }
}
export function recordProcessed(tenantId) {
  if (!tenantId) return;
  try { metaHealthQueries.recordProcessed.run(tenantId); } catch { /* noop */ }
}
export function recordOutboundSuccess(tenantId) {
  if (!tenantId) return;
  try { metaHealthQueries.recordOutboundSuccess.run(tenantId); } catch { /* noop */ }
}
export function recordOutboundError(tenantId, httpStatus, bodyText) {
  if (!tenantId) return;
  try {
    const { code, summary } = summarizeMetaError(httpStatus, bodyText);
    metaHealthQueries.recordOutboundError.run({ tenant_id: tenantId, code, summary });
  } catch { /* noop */ }
}

// ── Verificação na Graph API ─────────────────────────────────────────────────
const PHONE_FIELDS_FULL = 'display_phone_number,verified_name,quality_rating,messaging_limit_tier';
const PHONE_FIELDS_MINIMAL = 'display_phone_number,verified_name,quality_rating';
const PHONE_FIELDS_BARE = 'display_phone_number,verified_name';

async function graphGet(path, token) {
  const res = await fetchImpl(`${graphBase()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text().catch(() => '');
  return { status: res.status, ok: res.ok, text, retryAfter: res.headers?.get?.('retry-after') || null };
}

/**
 * Consulta o nó do número com fallback progressivo de campos — versões/contas
 * diferentes suportam conjuntos diferentes; erro #100 (campo inexistente)
 * não pode virar "com problema".
 */
async function fetchPhoneInfo(phoneNumberId, token) {
  const fieldSets = [PHONE_FIELDS_FULL, PHONE_FIELDS_MINIMAL, PHONE_FIELDS_BARE];
  let last = null;
  for (const fields of fieldSets) {
    last = await graphGet(`/${phoneNumberId}?fields=${fields}`, token);
    if (last.ok) return last;
    // 400 com code 100 = campo não suportado → tenta o conjunto menor.
    const { code } = summarizeMetaError(last.status, last.text);
    if (last.status === 400 && code === '100') continue;
    return last; // qualquer outro erro é definitivo para esta rodada
  }
  return last;
}

/** Tenta descobrir o WABA ID a partir do número (nem toda conta expõe). */
async function fetchWabaId(phoneNumberId, token) {
  if (process.env.META_WABA_ID) return process.env.META_WABA_ID;
  try {
    const res = await graphGet(`/${phoneNumberId}?fields=whatsapp_business_account{id}`, token);
    if (!res.ok) return null;
    const data = JSON.parse(res.text || '{}');
    return data.whatsapp_business_account?.id || null;
  } catch {
    return null;
  }
}

async function fetchTemplateCounts(wabaId, token) {
  const empty = { approved: null, pending: null, rejected: null, unknown: null };
  if (!wabaId) return empty;
  try {
    const res = await graphGet(`/${wabaId}/message_templates?fields=status&limit=200`, token);
    if (!res.ok) return empty;
    const data = JSON.parse(res.text || '{}');
    const counts = { approved: 0, pending: 0, rejected: 0, unknown: 0 };
    for (const t of data.data || []) {
      const s = String(t.status || '').toUpperCase();
      if (s === 'APPROVED') counts.approved++;
      else if (s === 'PENDING' || s === 'IN_APPEAL') counts.pending++;
      else if (s === 'REJECTED' || s === 'DISABLED' || s === 'PAUSED') counts.rejected++;
      else counts.unknown++;
    }
    return counts;
  } catch {
    return empty;
  }
}

/**
 * Verifica um conjunto de credenciais na Graph API e devolve o resultado
 * interpretado em estados internos estáveis. Nunca lança.
 */
export async function checkCredentials({ phoneNumberId, token }) {
  const result = {
    status: 'unknown',
    token: { valid: null, error_code: null },
    phone: { display_phone_number: null, verified_name: null, quality_rating: null, messaging_limit: null },
    templates: { approved: null, pending: null, rejected: null, unknown: null },
    issues: [],
    retry_after_ms: null,
  };
  if (!phoneNumberId || !token) {
    result.status = 'not_configured';
    result.issues.push({ code: 'not_configured', message: 'WhatsApp ainda não configurado.' });
    return result;
  }

  let res;
  try {
    res = await fetchPhoneInfo(phoneNumberId, token);
  } catch (err) {
    result.status = 'unknown';
    result.issues.push({
      code: err?.code === 'ETIMEDOUT' ? 'timeout' : 'network',
      message: 'Não foi possível falar com a Meta agora. Isso não significa que o atendimento parou.',
    });
    return result;
  }

  if (res.ok) {
    let data = {};
    try { data = JSON.parse(res.text || '{}'); } catch { /* corpo inesperado */ }
    result.token.valid = true;
    result.phone.display_phone_number = data.display_phone_number || null;
    result.phone.verified_name = data.verified_name || null;
    result.phone.quality_rating = data.quality_rating || null;
    result.phone.messaging_limit = data.messaging_limit_tier || null;

    const quality = String(data.quality_rating || '').toUpperCase();
    if (quality === 'RED') {
      result.status = 'critical';
      result.issues.push({ code: 'quality_red', message: 'A Meta classificou a qualidade do número como baixa. Envios podem ser limitados.' });
    } else if (quality === 'YELLOW') {
      result.status = 'warning';
      result.issues.push({ code: 'quality_yellow', message: 'A qualidade do número está em atenção na Meta.' });
    } else {
      result.status = 'healthy';
    }

    // Templates: best-effort, nunca muda o status geral se falhar.
    const wabaId = await fetchWabaId(phoneNumberId, token);
    result.templates = await fetchTemplateCounts(wabaId, token);
    return result;
  }

  const { code, summary } = summarizeMetaError(res.status, res.text);
  result.token.error_code = code;

  if (res.status === 401 || res.status === 403 || code === '190') {
    result.token.valid = false;
    result.status = 'critical';
    result.issues.push({ code: 'token_invalid', message: 'O acesso ao WhatsApp expirou ou foi revogado. É preciso reconectar.' });
  } else if (res.status === 429 || code === '4' || code === '80007') {
    result.status = 'unknown';
    result.retry_after_ms = res.retryAfter ? Number(res.retryAfter) * 1000 : 60_000;
    result.issues.push({ code: 'rate_limited', message: 'A Meta pediu para aguardar antes de verificar de novo. O atendimento continua normal.' });
  } else if (res.status >= 500) {
    result.status = 'unknown';
    result.issues.push({ code: 'meta_unavailable', message: 'A Meta está instável no momento. Verificaremos novamente em breve.' });
  } else {
    // 400 e outros 4xx não-token: problema de configuração/permissão.
    result.status = 'critical';
    result.issues.push({ code: 'api_error', message: `A Meta recusou a verificação${summary ? `: ${summary}` : '.'}` });
  }
  return result;
}

// ── Persistência + transições ────────────────────────────────────────────────
function persistCheck(key, check) {
  metaHealthQueries.upsertCheck.run({
    tenant_id: key,
    status: check.status,
    token_valid: check.token.valid == null ? null : (check.token.valid ? 1 : 0),
    display_phone_number: check.phone.display_phone_number,
    verified_name: check.phone.verified_name,
    quality_rating: check.phone.quality_rating,
    messaging_limit: check.phone.messaging_limit,
    templates_approved: check.templates.approved,
    templates_pending: check.templates.pending,
    templates_rejected: check.templates.rejected,
    templates_unknown: check.templates.unknown,
  });
}

/**
 * Registra transições de estado (sem repetir evento idêntico) e dispara o
 * push de conexão crítica para os tenants afetados.
 */
function handleTransition(key, previousStatus, check, affectedTenantIds) {
  const newStatus = check.status;
  // 'unknown' não é transição de verdade (falha da própria verificação).
  if (newStatus === 'unknown' || newStatus === previousStatus) return;

  const issueCode = check.issues[0]?.code || newStatus;
  metaHealthQueries.insertEvent.run(key, `status_${newStatus}`, issueCode);

  if (newStatus === 'critical') {
    for (const tenantId of affectedTenantIds) {
      notificationQueries.create.run({
        tenant_id: tenantId,
        type: 'meta_conexao',
        title: 'Problema na conexão do WhatsApp',
        message: check.issues[0]?.message || 'O Zapien encontrou um problema na conexão com o WhatsApp.',
        contact_id: null,
      });
      sendPushEvent({
        tenantId,
        event: 'meta_connection_critical',
        title: 'Problema na conexão do WhatsApp',
        body: 'O Zapien encontrou um problema que precisa de atenção.',
        url: '/integrations.html#meta-health',
        dedupeKey: `meta_critical:${issueCode}`,
        cooldownMinutes: metaHealthConfig.criticalPushCooldownMin,
      }).catch(() => {});
    }
  } else if (previousStatus === 'critical') {
    // Resolveu: limpa o dedupe para um novo problema disparar push na hora.
    for (const tenantId of affectedTenantIds) {
      clearPushDedupe(tenantId, 'meta_critical:');
    }
  }
}

// Cache/in-flight da verificação da plataforma (compartilhada entre tenants).
let platformInFlight = null;

/**
 * Verifica a saúde da conexão de um tenant (credencial própria ou da
 * plataforma), persiste o snapshot e devolve a visão completa. Nunca lança.
 */
export async function checkTenantMetaHealth(tenant) {
  const creds = resolveMetaCredentials(tenant);
  if (!creds) {
    const check = await checkCredentials({});
    persistCheck(tenant.id, check);
    return getTenantMetaHealthView(tenant);
  }

  let check;
  if (creds.source === 'platform') {
    // Compartilha uma única chamada em andamento entre tenants concorrentes.
    if (!platformInFlight) {
      platformInFlight = checkCredentials(creds).finally(() => { platformInFlight = null; });
    }
    check = await platformInFlight;
    const prevPlatform = metaHealthQueries.get.get(PLATFORM_KEY)?.status || null;
    persistCheck(PLATFORM_KEY, check);
    const prevTenant = metaHealthQueries.get.get(tenant.id)?.status || null;
    persistCheck(tenant.id, check);
    // Transição avaliada no nível do tenant (cada um recebe seu aviso/push).
    handleTransition(tenant.id, prevTenant ?? prevPlatform, check, [tenant.id]);
  } else {
    check = await checkCredentials(creds);
    const prev = metaHealthQueries.get.get(tenant.id)?.status || null;
    persistCheck(tenant.id, check);
    handleTransition(tenant.id, prev, check, [tenant.id]);
  }
  return getTenantMetaHealthView(tenant);
}

/**
 * Visão completa (leitura) da saúde para o painel do lojista — mistura o
 * snapshot verificado com a telemetria por tenant. Nunca inclui token.
 */
export function getTenantMetaHealthView(tenant) {
  const creds = resolveMetaCredentials(tenant);
  const row = metaHealthQueries.get.get(tenant.id) || {};
  const issues = [];

  let status = row.status || 'unknown';
  if (!creds) status = 'not_configured';
  else if (!row.last_checked_at) status = 'unknown';

  if (status === 'not_configured') {
    issues.push({ code: 'not_configured', message: 'WhatsApp ainda não configurado para esta conta.' });
  }
  if (row.token_valid === 0) {
    issues.push({ code: 'token_invalid', message: 'O acesso ao WhatsApp expirou ou foi revogado. É preciso reconectar.' });
  }
  const quality = String(row.quality_rating || '').toUpperCase();
  if (quality === 'RED') issues.push({ code: 'quality_red', message: 'A Meta classificou a qualidade do número como baixa.' });
  else if (quality === 'YELLOW') issues.push({ code: 'quality_yellow', message: 'A qualidade do número está em atenção na Meta.' });
  if (row.last_error_code && row.last_outbound_error_at &&
      (!row.last_outbound_success_at || row.last_outbound_error_at > row.last_outbound_success_at)) {
    issues.push({
      code: 'recent_send_error',
      message: `O último envio falhou (código ${row.last_error_code}). Novas mensagens podem estar sendo retentadas.`,
    });
  }

  return {
    status,
    source: creds?.source || null,
    checked_at: row.last_checked_at || null,
    token: { valid: row.token_valid == null ? null : Boolean(row.token_valid), error_code: null },
    phone: {
      display_phone_number: row.display_phone_number || null,
      verified_name: row.verified_name || null,
      quality_rating: row.quality_rating || null,
      messaging_limit: row.messaging_limit || null,
      phone_number_id_masked: creds ? maskPhoneNumberId(creds.phoneNumberId) : null,
    },
    webhook: {
      last_inbound_at: row.last_inbound_at || null,
      last_processed_at: row.last_processed_at || null,
    },
    outbound: {
      last_success_at: row.last_outbound_success_at || null,
      last_error_at: row.last_outbound_error_at || null,
      last_error_code: row.last_error_code || null,
      last_error_summary: row.last_error_summary || null,
    },
    templates: {
      approved: row.templates_approved ?? null,
      pending: row.templates_pending ?? null,
      rejected: row.templates_rejected ?? null,
      unknown: row.templates_unknown ?? null,
    },
    issues,
  };
}

/** Métricas agregadas para o /health — nunca IDs nem dados de tenant. */
let lastCheckErrors = 0;
export function metaHealthAggregates() {
  let counts = {};
  try {
    counts = Object.fromEntries(metaHealthQueries.statusCounts.all().map((r) => [r.status, r.n]));
  } catch { /* noop */ }
  return {
    healthy_tenants: counts.healthy || 0,
    warning_tenants: counts.warning || 0,
    critical_tenants: counts.critical || 0,
    last_check_errors: lastCheckErrors,
  };
}

// ── Scheduler ────────────────────────────────────────────────────────────────
let schedulerTimer = null;
let sweepRunning = false;
const backoffUntil = new Map(); // tenantId -> ms (429/5xx)

async function runHealthSweep() {
  if (sweepRunning) return; // nunca duplicar verificações
  sweepRunning = true;
  let errors = 0;
  try {
    // Só tenants ativos com WhatsApp resolvível (própria credencial ou plataforma).
    const tenants = tenantQueries.listAll.all()
      .filter((t) => t.active)
      .map(decryptTenant)
      .filter((t) => resolveMetaCredentials(t));

    // Justiça simples: ordena por última verificação (mais antiga primeiro).
    tenants.sort((a, b) => {
      const la = metaHealthQueries.get.get(a.id)?.last_checked_at || '';
      const lb = metaHealthQueries.get.get(b.id)?.last_checked_at || '';
      return la.localeCompare(lb);
    });

    const queue = tenants.filter((t) => (backoffUntil.get(t.id) || 0) <= Date.now());
    const workers = Array.from({ length: metaHealthConfig.concurrency }, async () => {
      while (queue.length) {
        const tenant = queue.shift();
        if (!tenant) return;
        try {
          const view = await checkTenantMetaHealth(tenant);
          if (view.status === 'unknown') {
            errors++;
            // backoff: 429/5xx/timeout esperam 2 ciclos antes de tentar de novo
            backoffUntil.set(tenant.id, Date.now() + metaHealthConfig.intervalMs);
          } else {
            backoffUntil.delete(tenant.id);
          }
        } catch (e) {
          errors++;
          console.error('[meta-health] verificação falhou:', e.message);
        }
      }
    });
    await Promise.all(workers);

    // Retenção: eventos > 30 dias e dedupes velhos.
    try { metaHealthQueries.cleanupEvents.run(); } catch { /* noop */ }
    try { db.prepare(`DELETE FROM push_dedupe WHERE sent_at < datetime('now', '-7 days')`).run(); } catch { /* noop */ }
  } finally {
    lastCheckErrors = errors;
    sweepRunning = false;
  }
}

export function startMetaHealthScheduler() {
  if (!metaHealthConfig.enabled) {
    console.log('[meta-health] verificação periódica desativada (META_HEALTH_ENABLED=false).');
    return;
  }
  if (schedulerTimer) return;
  // Primeira varredura 90s após o boot (não competir com o startup).
  setTimeout(() => {
    runHealthSweep().catch((e) => console.error('[meta-health] sweep:', e.message));
    schedulerTimer = setInterval(() => {
      runHealthSweep().catch((e) => console.error('[meta-health] sweep:', e.message));
    }, metaHealthConfig.intervalMs);
    schedulerTimer.unref?.();
  }, 90_000).unref?.();
  console.log(`[meta-health] verificação periódica iniciada (a cada ${Math.round(metaHealthConfig.intervalMs / 60000)} min).`);
}

export function stopMetaHealthScheduler() {
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
}

// Exposto para testes.
export { runHealthSweep as _runHealthSweepForTesting };
