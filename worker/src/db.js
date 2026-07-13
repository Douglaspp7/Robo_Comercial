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

  -- Cota diária global (todos os envios contam contra o mesmo teto do número).
  CREATE TABLE IF NOT EXISTS daily_counter (
    day   TEXT PRIMARY KEY,           -- YYYY-MM-DD
    count INTEGER NOT NULL DEFAULT 0
  );

  -- Marca o 1º dia em que o número foi usado (para o aquecimento/warmup).
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

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
  nextPending: db.prepare(
    `SELECT i.* FROM campaign_items i
     JOIN campaigns c ON c.id = i.campaign_id
     WHERE i.status = 'pending' AND c.status = 'active'
     ORDER BY i.id ASC LIMIT 1`
  ),
  markSent: db.prepare(
    `UPDATE campaign_items SET status='sent', sent_at=@ts, error=NULL WHERE id=@id`
  ),
  markInvalid: db.prepare(
    `UPDATE campaign_items SET status='invalid', error=@error WHERE id=@id`
  ),
  bumpAttempt: db.prepare(
    `UPDATE campaign_items SET attempts=attempts+1, error=@error WHERE id=@id`
  ),
  markFailed: db.prepare(
    `UPDATE campaign_items SET status='failed', error=@error WHERE id=@id`
  ),
  setJid: db.prepare(`UPDATE campaign_items SET jid=@jid WHERE id=@id`),
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

const stmtGetCount = db.prepare(`SELECT count FROM daily_counter WHERE day=?`);
const stmtBumpCount = db.prepare(
  `INSERT INTO daily_counter (day, count) VALUES (@day, 1)
   ON CONFLICT(day) DO UPDATE SET count = count + 1`
);

export function getTodayCount() {
  const row = stmtGetCount.get(todayStr());
  return row ? row.count : 0;
}
export function incTodayCount() {
  stmtBumpCount.run({ day: todayStr() });
}

/** Nº de dias distintos em que já houve envio (para calcular o warmup). */
const stmtUsedDays = db.prepare(`SELECT COUNT(*) AS d FROM daily_counter`);
export function usedDays() {
  return stmtUsedDays.get().d;
}
