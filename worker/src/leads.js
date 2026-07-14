/**
 * Plano de busca (consultas salvas) + pool de leads persistente e deduplicado.
 *
 * Fluxo: o painel monta o PLANO (linhas de Google/Instagram), aciona a busca
 * (chamando as APIs com as chaves dele) e envia os leads para cá. O pool
 * deduplica globalmente (mesmo número nunca entra duas vezes) e alimenta o
 * disparo — "Disparar pendentes" cria campanha só com quem ainda não foi
 * contatado. Assim não precisa refazer lista todo dia.
 */
import { db } from "./db.js";
import { numberToJid, normalizeNumber } from "./phone.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS search_plan (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source     TEXT NOT NULL,            -- google | instagram
    mode       TEXT,                     -- instagram: hashtag | profiles
    query      TEXT NOT NULL,            -- nicho (google) ou hashtag/perfis (instagram)
    location   TEXT,                     -- google: cidade/bairros
    deep       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    dedup_key    TEXT PRIMARY KEY,       -- jid | e:<email> | l:<leadid>
    jid          TEXT,
    phone        TEXT,
    name         TEXT,
    channel      TEXT NOT NULL DEFAULT 'none', -- whatsapp | email | none
    source       TEXT,                   -- google | instagram | excel
    website      TEXT,
    email        TEXT,
    address      TEXT,
    collected_at INTEGER NOT NULL,
    contacted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_leads_pending ON leads(channel, contacted_at);
`);

// ── Plano de busca ───────────────────────────────────────────────────────────
const stmtAddPlan = db.prepare(
  `INSERT INTO search_plan (source, mode, query, location, deep, created_at)
   VALUES (@source, @mode, @query, @location, @deep, @created_at)`
);
export const planQueries = {
  list: db.prepare(`SELECT * FROM search_plan ORDER BY id ASC`),
  del: db.prepare(`DELETE FROM search_plan WHERE id=?`),
  count: db.prepare(`SELECT COUNT(*) AS c FROM search_plan`),
};

export function addPlanLine(line) {
  const source = line.source === "instagram" ? "instagram" : "google";
  const query = String(line.query || "").trim();
  if (!query) return null;
  return stmtAddPlan.run({
    source,
    mode: line.mode || null,
    query,
    location: line.location || null,
    deep: line.deep ? 1 : 0,
    created_at: Date.now(),
  }).lastInsertRowid;
}

/** Semeia o plano com sugestões do Zapien (idempotente: só se estiver vazio). */
export function seedPlan() {
  if (planQueries.count.get().c > 0) return 0;
  const cidades = "São Paulo, SP";
  const nichos = [
    "loja de roupas", "moda feminina", "salão de beleza", "barbearia",
    "pet shop", "semijoias", "suplementos", "confeitaria",
    "assistência técnica celular", "estética",
  ];
  const hashtags = [
    "modafemininasp", "pedidospelowhatsapp", "semijoiasatacado",
    "petshop", "confeitaria", "revendedora",
  ];
  let n = 0;
  for (const q of nichos) {
    addPlanLine({ source: "google", query: q, location: cidades, deep: 1 });
    n++;
  }
  for (const h of hashtags) {
    addPlanLine({ source: "instagram", mode: "hashtag", query: h });
    n++;
  }
  return n;
}

// ── Pool de leads ────────────────────────────────────────────────────────────
const stmtInsertLead = db.prepare(
  `INSERT OR IGNORE INTO leads
     (dedup_key, jid, phone, name, channel, source, website, email, address, collected_at)
   VALUES (@dedup_key, @jid, @phone, @name, @channel, @source, @website, @email, @address, @collected_at)`
);

function toLeadRow(lead) {
  const phone = lead.phone ? normalizeNumber(lead.phone) : null;
  const jid = phone ? numberToJid(phone) : null;
  const email = (lead.email || "").trim() || null;
  const channel = jid ? "whatsapp" : email ? "email" : "none";
  const dedup_key =
    jid || (email ? `e:${email.toLowerCase()}` : `l:${lead.id || lead.lead_id || Math.random()}`);
  return {
    dedup_key,
    jid,
    phone,
    name: lead.name || "",
    channel,
    source: lead.source || null,
    website: lead.website || null,
    email,
    address: lead.address || null,
    collected_at: Date.now(),
  };
}

/** Adiciona leads deduplicando globalmente. Retorna { added, ignored }. */
export const addLeads = db.transaction((leads) => {
  let added = 0;
  for (const lead of leads) {
    const row = toLeadRow(lead);
    if (row.channel === "none") continue; // sem WhatsApp nem e-mail: descarta
    added += stmtInsertLead.run(row).changes;
  }
  return { added, ignored: leads.length - added };
});

export const leadQueries = {
  stats: db.prepare(
    `SELECT
       COUNT(*)                                                   AS total,
       SUM(channel='whatsapp')                                    AS whatsapp,
       SUM(channel='email')                                       AS email,
       SUM(channel='whatsapp' AND contacted_at IS NULL)           AS pending_wa,
       SUM(contacted_at IS NOT NULL)                              AS contacted
     FROM leads`
  ),
  pendingWhatsapp: db.prepare(
    `SELECT dedup_key, jid, phone, name FROM leads
     WHERE channel='whatsapp' AND contacted_at IS NULL
     ORDER BY collected_at ASC LIMIT @limit`
  ),
  markContacted: db.prepare(
    `UPDATE leads SET contacted_at=@ts WHERE dedup_key=@dedup_key`
  ),
};

export function leadStats() {
  const s = leadQueries.stats.get();
  return {
    total: s.total || 0,
    whatsapp: s.whatsapp || 0,
    email: s.email || 0,
    pending_wa: s.pending_wa || 0,
    contacted: s.contacted || 0,
  };
}

/** Leads de WhatsApp ainda não contatados, para virar campanha. */
export function pendingWhatsappLeads(limit = 1000) {
  return leadQueries.pendingWhatsapp.all({ limit });
}

export const markLeadsContacted = db.transaction((keys) => {
  const ts = Date.now();
  for (const k of keys) leadQueries.markContacted.run({ dedup_key: k, ts });
});
