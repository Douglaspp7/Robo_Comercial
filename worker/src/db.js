/**
 * Estado persistente do worker em SQLite (better-sqlite3, WAL).
 * Substitui o localStorage do navegador: campanhas, itens (contatos), cota
 * diária e histórico de enviados sobrevivem a reboot do Pi.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL DEFAULT 'Campanha',
    message    TEXT NOT NULL,
    app_url    TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'active', -- active | paused | done
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaign_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    lead_id     TEXT,
    name        TEXT NOT NULL DEFAULT '',
    phone       TEXT NOT NULL,
    jid         TEXT,
    status      TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | invalid
    attempts    INTEGER NOT NULL DEFAULT 0,
    error       TEXT,
    sent_at     INTEGER,
    -- Unicidade pelo JID (número normalizado), não pelo telefone bruto:
    -- evita disparo duplicado quando o mesmo número vem em formatos diferentes.
    UNIQUE(campaign_id, jid)
  );
  CREATE INDEX IF NOT EXISTS idx_items_pending
    ON campaign_items(status, campaign_id);

  -- Cota diária POR NÚMERO (cada chip tem seu próprio teto/dia).
  CREATE TABLE IF NOT EXISTS number_counter (
    number_id TEXT NOT NULL,
    day       TEXT NOT NULL,          -- YYYY-MM-DD
    count     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (number_id, day)
  );

  -- Envios por HORA, por número (teto/hora anti-pico).
  CREATE TABLE IF NOT EXISTS hour_counter (
    number_id TEXT NOT NULL,
    hour_key  TEXT NOT NULL,          -- YYYY-MM-DDTHH (local)
    count     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (number_id, hour_key)
  );

  -- Lista de supressão: quem deu opt-out (SAIR) ou não deve ser recontatado.
  CREATE TABLE IF NOT EXISTS suppression (
    jid        TEXT PRIMARY KEY,
    phone      TEXT,
    reason     TEXT,                  -- optout | manual | ...
    created_at INTEGER NOT NULL
  );

  -- Marca o 1º dia em que o número foi usado (para o aquecimento/warmup).
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Migração idempotente: imagem opcional por campanha (caminho no disco).
const campaignCols = db.prepare(`PRAGMA table_info(campaigns)`).all().map((c) => c.name);
if (!campaignCols.includes("image_path")) {
  db.exec(`ALTER TABLE campaigns ADD COLUMN image_path TEXT`);
}

// Migração idempotente: qual número (chip) enviou cada item (atribuição).
const itemCols = db.prepare(`PRAGMA table_info(campaign_items)`).all().map((c) => c.name);
if (!itemCols.includes("number_id")) {
  db.exec(`ALTER TABLE campaign_items ADD COLUMN number_id TEXT`);
}
if (!itemCols.includes("failed_at")) {
  db.exec(`ALTER TABLE campaign_items ADD COLUMN failed_at INTEGER`);
}

// Recuperação de crash: itens que ficaram travados em 'sending' (reserva sem
// conclusão) voltam para 'pending' no boot.
db.exec(`UPDATE campaign_items SET status='pending' WHERE status='sending'`);

// ── Campanhas ────────────────────────────────────────────────────────────────
const stmtInsertCampaign = db.prepare(
  `INSERT INTO campaigns (name, message, app_url, status, created_at)
   VALUES (@name, @message, @app_url, 'active', @created_at)`
);
const stmtInsertItem = db.prepare(
  `INSERT OR IGNORE INTO campaign_items (campaign_id, lead_id, name, phone, jid)
   VALUES (@campaign_id, @lead_id, @name, @phone, @jid)`
);

/** Cria uma campanha + itens numa transação. Retorna { id, added }. */
export const createCampaign = db.transaction((camp, items) => {
  const info = stmtInsertCampaign.run({
    name: camp.name || "Campanha",
    message: camp.message,
    app_url: camp.app_url || "",
    created_at: Date.now(),
  });
  const campaignId = info.lastInsertRowid;
  let added = 0;
  for (const it of items) {
    const res = stmtInsertItem.run({
      campaign_id: campaignId,
      lead_id: it.lead_id ?? null,
      name: it.name || "",
      phone: it.phone,
      jid: it.jid ?? null,
    });
    added += res.changes;
  }
  return { id: campaignId, added };
});

// ── Fila de envio ────────────────────────────────────────────────────────────
export const queries = {
  // Reserva atômica do próximo pendente para um número (evita que dois chips
  // peguem o mesmo lead). Marca 'sending' e grava o número; RETURNING devolve
  // o item reservado (ou undefined se não houver pendente).
  claimNext: db.prepare(
    `UPDATE campaign_items SET status='sending', number_id=@number_id
     WHERE id = (
       SELECT i.id FROM campaign_items i
       JOIN campaigns c ON c.id = i.campaign_id
       WHERE i.status='pending' AND c.status='active'
       ORDER BY i.id ASC LIMIT 1
     )
     RETURNING *`
  ),
  markSent: db.prepare(
    `UPDATE campaign_items SET status='sent', sent_at=@ts, error=NULL WHERE id=@id`
  ),
  markInvalid: db.prepare(
    `UPDATE campaign_items SET status='invalid', error=@error WHERE id=@id`
  ),
  // Devolve à fila (falha transitória): volta para 'pending' e conta a tentativa.
  requeue: db.prepare(
    `UPDATE campaign_items SET status='pending', attempts=attempts+1, error=@error WHERE id=@id`
  ),
  markFailed: db.prepare(
    `UPDATE campaign_items SET status='failed', error=@error, failed_at=@ts WHERE id=@id`
  ),
  setJid: db.prepare(`UPDATE campaign_items SET jid=@jid WHERE id=@id`),
  setImage: db.prepare(`UPDATE campaigns SET image_path=@path WHERE id=@id`),
  // Já foi enviado para este JID (qualquer campanha) desde @since? (não-recontato)
  recentlyContacted: db.prepare(
    `SELECT 1 FROM campaign_items
     WHERE jid=@jid AND status='sent' AND sent_at >= @since LIMIT 1`
  ),
  // Fecha campanhas sem itens pendentes.
  closeFinished: db.prepare(
    `UPDATE campaigns SET status='done'
     WHERE status='active'
       AND NOT EXISTS (
         SELECT 1 FROM campaign_items i
         WHERE i.campaign_id = campaigns.id AND i.status='pending'
       )`
  ),
  campaignStats: db.prepare(
    `SELECT c.id, c.name, c.status, c.created_at,
            COUNT(i.id)                                    AS total,
            SUM(i.status='sent')                           AS sent,
            SUM(i.status='pending')                        AS pending,
            SUM(i.status='failed')                         AS failed,
            SUM(i.status='invalid')                        AS invalid
     FROM campaigns c LEFT JOIN campaign_items i ON i.campaign_id = c.id
     GROUP BY c.id ORDER BY c.id DESC`
  ),
  setCampaignStatus: db.prepare(
    `UPDATE campaigns SET status=@status WHERE id=@id`
  ),
  setAllActive: db.prepare(
    `UPDATE campaigns SET status='active' WHERE status='paused'`
  ),
  setAllPaused: db.prepare(
    `UPDATE campaigns SET status='paused' WHERE status='active'`
  ),
};

// ── Cota diária ──────────────────────────────────────────────────────────────
export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const stmtGetCount = db.prepare(
  `SELECT count FROM number_counter WHERE number_id=? AND day=?`
);
const stmtBumpCount = db.prepare(
  `INSERT INTO number_counter (number_id, day, count) VALUES (@number_id, @day, 1)
   ON CONFLICT(number_id, day) DO UPDATE SET count = count + 1`
);

/** Enviados hoje por um número específico. */
export function getTodayCount(numberId) {
  const row = stmtGetCount.get(numberId, todayStr());
  return row ? row.count : 0;
}
export function incTodayCount(numberId) {
  stmtBumpCount.run({ number_id: numberId, day: todayStr() });
}

/** Nº de dias distintos em que ESSE número já enviou (para o warmup). */
const stmtUsedDays = db.prepare(
  `SELECT COUNT(*) AS d FROM number_counter WHERE number_id=?`
);
export function usedDays(numberId) {
  return stmtUsedDays.get(numberId).d;
}

/** Soma de envios de hoje somando todos os números (para exibir agregado). */
const stmtTodayTotal = db.prepare(
  `SELECT COALESCE(SUM(count), 0) AS t FROM number_counter WHERE day=?`
);
export function todayTotal() {
  return stmtTodayTotal.get(todayStr()).t;
}

// ── Teto por hora ────────────────────────────────────────────────────────────
function hourKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}`;
}
const stmtGetHour = db.prepare(
  `SELECT count FROM hour_counter WHERE number_id=? AND hour_key=?`
);
const stmtBumpHour = db.prepare(
  `INSERT INTO hour_counter (number_id, hour_key, count) VALUES (@number_id, @hour_key, 1)
   ON CONFLICT(number_id, hour_key) DO UPDATE SET count = count + 1`
);
export function getHourCount(numberId) {
  const row = stmtGetHour.get(numberId, hourKey());
  return row ? row.count : 0;
}
export function incHourCount(numberId) {
  stmtBumpHour.run({ number_id: numberId, hour_key: hourKey() });
}

// ── Supressão (opt-out / não recontatar) ─────────────────────────────────────
const stmtIsSuppressed = db.prepare(`SELECT 1 FROM suppression WHERE jid=? LIMIT 1`);
const stmtAddSuppression = db.prepare(
  `INSERT OR IGNORE INTO suppression (jid, phone, reason, created_at)
   VALUES (@jid, @phone, @reason, @created_at)`
);
const stmtSuppressionCount = db.prepare(`SELECT COUNT(*) AS c FROM suppression`);
export function isSuppressed(jid) {
  return Boolean(stmtIsSuppressed.get(jid));
}
export function addSuppression(jid, phone, reason) {
  stmtAddSuppression.run({
    jid,
    phone: phone || null,
    reason: reason || "manual",
    created_at: Date.now(),
  });
}
export function suppressionCount() {
  return stmtSuppressionCount.get().c;
}

export function listSuppressions(limit = 200) {
  return db.prepare(`SELECT jid,phone,reason,created_at FROM suppression ORDER BY created_at DESC LIMIT ?`).all(Math.max(1, Math.min(1000, Number(limit) || 200)));
}
export function removeSuppression(jid) {
  return db.prepare(`DELETE FROM suppression WHERE jid=?`).run(jid).changes;
}

// ── Settings (chave/valor) — usado pelo agendador ────────────────────────────
const stmtGetSetting = db.prepare(`SELECT value FROM settings WHERE key=?`);
const stmtSetSetting = db.prepare(
  `INSERT INTO settings (key, value) VALUES (@key, @value)
   ON CONFLICT(key) DO UPDATE SET value=@value`
);
export function getSetting(key, def = null) {
  const r = stmtGetSetting.get(key);
  return r ? r.value : def;
}
export function setSetting(key, value) {
  stmtSetSetting.run({ key, value: value == null ? null : String(value) });
}
