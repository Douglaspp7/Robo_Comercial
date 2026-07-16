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

// Migrações aditivas para instalações existentes no Raspberry Pi.
const planCols = new Set(db.prepare(`PRAGMA table_info(search_plan)`).all().map((c) => c.name));
if (!planCols.has('runs')) db.exec(`ALTER TABLE search_plan ADD COLUMN runs INTEGER NOT NULL DEFAULT 0`);
if (!planCols.has('results_found')) db.exec(`ALTER TABLE search_plan ADD COLUMN results_found INTEGER NOT NULL DEFAULT 0`);
if (!planCols.has('last_run_at')) db.exec(`ALTER TABLE search_plan ADD COLUMN last_run_at INTEGER`);
const leadCols = new Set(db.prepare(`PRAGMA table_info(leads)`).all().map((c) => c.name));
if (!leadCols.has('plan_id')) db.exec(`ALTER TABLE leads ADD COLUMN plan_id INTEGER`);
if (!leadCols.has('replied_at')) db.exec(`ALTER TABLE leads ADD COLUMN replied_at INTEGER`);
if (!leadCols.has('interested_at')) db.exec(`ALTER TABLE leads ADD COLUMN interested_at INTEGER`);
if (!leadCols.has('opted_out_at')) db.exec(`ALTER TABLE leads ADD COLUMN opted_out_at INTEGER`);
if (!leadCols.has('demo_at')) db.exec(`ALTER TABLE leads ADD COLUMN demo_at INTEGER`);
for (const [column, definition] of Object.entries({
  company_name: "TEXT",
  contact_name: "TEXT",
  contact_role: "TEXT",
  segment: "TEXT",
  name_confidence: "INTEGER NOT NULL DEFAULT 0",
  context_confidence: "INTEGER NOT NULL DEFAULT 0",
  overall_confidence: "INTEGER NOT NULL DEFAULT 0",
  evidence: "TEXT",
  source_url: "TEXT",
  opening_question: "TEXT",
  review_status: "TEXT NOT NULL DEFAULT 'review'",
  review_reason: "TEXT",
  approved_at: "INTEGER",
  approved_by: "TEXT",
  lead_score: "INTEGER NOT NULL DEFAULT 0",
  score_reasons: "TEXT",
  available_channels: "TEXT",
  recommended_channel: "TEXT NOT NULL DEFAULT 'review'",
})) {
  if (!leadCols.has(column)) db.exec(`ALTER TABLE leads ADD COLUMN ${column} ${definition}`);
}

db.exec(`CREATE TABLE IF NOT EXISTS lead_alerts (
  jid TEXT PRIMARY KEY, phone TEXT, name TEXT, level TEXT NOT NULL, reason TEXT,
  source TEXT, search_query TEXT, created_at INTEGER NOT NULL, sent_at INTEGER
)`);

export const leadAlertQueries = {
  context: db.prepare(`SELECT l.name,l.phone,l.source,p.query FROM leads l LEFT JOIN search_plan p ON p.id=l.plan_id WHERE l.jid=?`),
  enqueue: db.prepare(`INSERT INTO lead_alerts (jid,phone,name,level,reason,source,search_query,created_at,sent_at)
    VALUES (@jid,@phone,@name,@level,@reason,@source,@search_query,@created_at,NULL)
    ON CONFLICT(jid) DO UPDATE SET
      level=CASE WHEN excluded.level='hot' AND lead_alerts.level<>'hot' THEN 'hot' ELSE lead_alerts.level END,
      reason=CASE WHEN excluded.level='hot' THEN excluded.reason ELSE lead_alerts.reason END,
      sent_at=CASE WHEN excluded.level='hot' AND lead_alerts.level<>'hot' THEN NULL ELSE lead_alerts.sent_at END`),
  pending: db.prepare(`SELECT * FROM lead_alerts WHERE sent_at IS NULL ORDER BY CASE level WHEN 'hot' THEN 0 ELSE 1 END, created_at ASC LIMIT 1`),
  markSent: db.prepare(`UPDATE lead_alerts SET sent_at=@sent_at WHERE jid=@jid`),
};

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

const stmtPlanRun = db.prepare(`UPDATE search_plan SET runs=runs+1, results_found=results_found+@found, last_run_at=@ts WHERE id=@id`);

export function recordPlanRun(id, found) {
  if (!Number.isInteger(Number(id))) return;
  stmtPlanRun.run({ id: Number(id), found: Math.max(0, Number(found) || 0), ts: Date.now() });
}

export function recommendPlan(stats) {
  if ((stats.contacted || 0) < 10) return { action: 'observe', label: 'Coletar mais dados', reason: 'Menos de 10 contatos enviados.' };
  const replyRate = stats.replied / stats.contacted;
  const interestRate = stats.interested / stats.contacted;
  const optoutRate = stats.opted_out / stats.contacted;
  if (optoutRate >= 0.15 || (stats.contacted >= 20 && replyRate < 0.05)) return { action: 'pause', label: 'Revisar ou pausar', reason: 'Baixa resposta ou rejeição elevada.' };
  if (interestRate >= 0.08 || replyRate >= 0.2) return { action: 'repeat', label: 'Repetir e expandir', reason: 'Resposta ou interesse acima do mínimo inicial.' };
  return { action: 'observe', label: 'Continuar testando', reason: 'Ainda sem sinal forte para repetir ou pausar.' };
}

const stmtPlanPerformance = db.prepare(`
  SELECT p.*,
    COUNT(l.dedup_key) AS leads,
    SUM(l.contacted_at IS NOT NULL) AS contacted,
    SUM(l.replied_at IS NOT NULL) AS replied,
    SUM(l.interested_at IS NOT NULL) AS interested,
    SUM(l.demo_at IS NOT NULL) AS demos,
    SUM(l.opted_out_at IS NOT NULL) AS opted_out
  FROM search_plan p LEFT JOIN leads l ON l.plan_id=p.id
  GROUP BY p.id ORDER BY p.id ASC
`);

export function planPerformance() {
  return stmtPlanPerformance.all().map((row) => ({
    ...row,
    leads: row.leads || 0,
    contacted: row.contacted || 0,
    replied: row.replied || 0,
    interested: row.interested || 0,
    demos: row.demos || 0,
    opted_out: row.opted_out || 0,
    recommendation: recommendPlan(row),
  }));
}

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
     (dedup_key, jid, phone, name, channel, source, website, email, address, collected_at, plan_id,
      company_name, contact_name, contact_role, segment, name_confidence, context_confidence,
      overall_confidence, evidence, source_url, opening_question, review_status, review_reason,
      lead_score, score_reasons, available_channels, recommended_channel)
   VALUES (@dedup_key, @jid, @phone, @name, @channel, @source, @website, @email, @address, @collected_at, @plan_id,
      @company_name, @contact_name, @contact_role, @segment, @name_confidence, @context_confidence,
      @overall_confidence, @evidence, @source_url, @opening_question, @review_status, @review_reason,
      @lead_score, @score_reasons, @available_channels, @recommended_channel)`
);

export function questionFor(segment) {
  const clean = String(segment || '').toLocaleLowerCase('pt-BR');
  if (/imobili|corretor/.test(clean)) return 'Quando alguém pergunta por um imóvel, vocês conseguem responder na hora ou alguns contatos acabam esfriando?';
  if (/cl[ií]nica|est[eé]tica|dent|sa[uú]de/.test(clean)) return 'Hoje vocês conseguem responder rapidamente todos os pedidos de informação e agendamento ou alguns acabam esperando?';
  if (/loja|moda|roupa|semijoia|varejo/.test(clean)) return 'Quando chegam dúvidas sobre produtos pelo WhatsApp, vocês conseguem acompanhar todas ou algumas oportunidades se perdem?';
  if (/oficina|assist[eê]ncia|t[eé]cnica/.test(clean)) return 'Quando chegam pedidos de orçamento pelo WhatsApp, vocês conseguem acompanhar todos ou alguns acabam se perdendo?';
  return 'Hoje vocês conseguem responder rapidamente todos os contatos pelo WhatsApp ou alguns acabam esperando?';
}

export function enrichmentFor(lead) {
  const source = String(lead.source || '').toLowerCase();
  const companyName = String(lead.company_name || lead.name || '').trim();
  const contactName = String(lead.contact_name || '').trim();
  const contactRole = String(lead.contact_role || '').trim();
  const segment = String(lead.segment || lead.search_query || lead.query || '').trim();
  const sourceUrl = String(lead.source_url || lead.website || '').trim();
  const explicitNameEvidence = Boolean(contactName && lead.contact_name_source);
  const nameConfidence = explicitNameEvidence ? Math.min(100, Math.max(0, Number(lead.name_confidence) || 90)) : 0;
  const contextConfidence = source === 'google' || source === 'instagram' ? (sourceUrl ? 85 : 70) : (sourceUrl ? 70 : 45);
  const overallConfidence = Math.round((contextConfidence * 0.7) + (explicitNameEvidence ? nameConfidence * 0.3 : 15));
  const channels = [];
  if (lead.phone) channels.push('whatsapp');
  if (String(lead.email || '').trim()) channels.push('email');
  if (/instagram\.com/i.test(sourceUrl) || source === 'instagram') channels.push('instagram');
  if (String(lead.website || '').trim()) channels.push('site');
  const reasons = [];
  let score = 0;
  if (['google', 'instagram', 'directory', 'referral', 'excel'].includes(source)) { score += 15; reasons.push('origem identificada +15'); }
  if (lead.phone) { score += 25; reasons.push('telefone comercial +25'); }
  if (String(lead.website || '').trim()) { score += 15; reasons.push('site público +15'); }
  if (String(lead.email || '').trim()) { score += 10; reasons.push('e-mail público +10'); }
  if (String(lead.address || '').trim()) { score += 10; reasons.push('localização identificada +10'); }
  if (segment) { score += 10; reasons.push('segmento definido +10'); }
  if (Number(lead.rating) >= 4) { score += 10; reasons.push('boa presença pública +10'); }
  if (sourceUrl) { score += 5; reasons.push('evidência verificável +5'); }
  score = Math.min(100, score);
  const recommendedChannel = score < 40 ? 'review' : lead.phone ? 'whatsapp' : lead.email ? 'email' : 'review';
  const evidence = String(lead.evidence || (source === 'google'
    ? `Empresa encontrada no Google Maps${sourceUrl ? ' e site comercial informado' : ''}.`
    : source === 'instagram' ? 'Perfil comercial encontrado na busca do Instagram.' : 'Contato importado; origem deve ser revisada.'));
  return {
    company_name: companyName,
    contact_name: explicitNameEvidence ? contactName : '',
    contact_role: explicitNameEvidence ? contactRole : '',
    segment,
    name_confidence: nameConfidence,
    context_confidence: contextConfidence,
    overall_confidence: overallConfidence,
    lead_score: score,
    score_reasons: reasons.join(' · '),
    available_channels: JSON.stringify([...new Set(channels)]),
    recommended_channel: recommendedChannel,
    evidence,
    source_url: sourceUrl || null,
    opening_question: String(lead.opening_question || questionFor(segment)),
    review_status: score < 40 ? 'blocked' : 'review',
    review_reason: explicitNameEvidence
      ? 'Confirmar evidência, nome e pergunta antes do primeiro disparo.'
      : score < 40
        ? 'Pontuação insuficiente ou contato comercial sem evidência; bloqueado preventivamente.'
        : 'Sem nome pessoal comprovado; abordagem usará somente empresa e contexto.',
  };
}

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
    plan_id: Number.isInteger(Number(lead.plan_id)) ? Number(lead.plan_id) : null,
    ...enrichmentFor(lead),
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
       SUM(channel='whatsapp' AND contacted_at IS NULL AND review_status='approved') AS pending_wa,
       SUM(channel='email' AND contacted_at IS NULL AND review_status='approved') AS pending_email,
       SUM(channel='whatsapp' AND contacted_at IS NULL AND review_status='review') AS needs_review,
       SUM(review_status='blocked')                               AS blocked,
       SUM(lead_score>=70 AND contacted_at IS NULL)               AS qualified,
       SUM(contacted_at IS NOT NULL)                              AS contacted
     FROM leads`
  ),
  pendingWhatsapp: db.prepare(
    `SELECT dedup_key, jid, phone, name, company_name, contact_name, name_confidence,
            opening_question, evidence, source_url, overall_confidence
     FROM leads
     WHERE channel='whatsapp' AND contacted_at IS NULL AND review_status='approved'
     ORDER BY collected_at ASC LIMIT @limit`
  ),
  pendingEmail: db.prepare(
    `SELECT dedup_key, email, name, company_name, source, source_url, lead_score
     FROM leads
     WHERE channel='email' AND contacted_at IS NULL AND review_status='approved' AND opted_out_at IS NULL
     ORDER BY lead_score DESC, collected_at ASC LIMIT @limit`
  ),
  reviewList: db.prepare(
    `SELECT dedup_key, phone, company_name, contact_name, contact_role, segment,
            name_confidence, context_confidence, overall_confidence, evidence,
            source_url, opening_question, review_status, review_reason, collected_at,
            lead_score, score_reasons, available_channels, recommended_channel, source, email, website
     FROM leads WHERE contacted_at IS NULL
     ORDER BY CASE review_status WHEN 'review' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
              overall_confidence DESC, collected_at DESC LIMIT @limit`
  ),
  markContacted: db.prepare(
    `UPDATE leads SET contacted_at=@ts WHERE dedup_key=@dedup_key`
  ),
  bySource: db.prepare(`SELECT COALESCE(source,'não informada') source, COUNT(*) total FROM leads GROUP BY source ORDER BY total DESC`),
};

export function leadStats() {
  const s = leadQueries.stats.get();
  return {
    total: s.total || 0,
    whatsapp: s.whatsapp || 0,
    email: s.email || 0,
    pending_wa: s.pending_wa || 0,
    pending_email: s.pending_email || 0,
    needs_review: s.needs_review || 0,
    blocked: s.blocked || 0,
    qualified: s.qualified || 0,
    contacted: s.contacted || 0,
    sources: Object.fromEntries(leadQueries.bySource.all().map((row) => [row.source, row.total])),
  };
}

const stmtReviewLead = db.prepare(`UPDATE leads SET
  contact_name=@contact_name, contact_role=@contact_role, name_confidence=@name_confidence,
  opening_question=@opening_question, evidence=@evidence, source_url=@source_url,
  review_status=@review_status, review_reason=@review_reason,
  approved_at=@approved_at, approved_by=@approved_by
  WHERE dedup_key=@dedup_key AND contacted_at IS NULL`);

export const reviewLeads = db.transaction((items, approvedBy = 'admin') => {
  let updated = 0;
  for (const item of items) {
    if (!item?.dedup_key) continue;
    let status = ['approved', 'review', 'blocked'].includes(item.review_status) ? item.review_status : 'review';
    const contactName = String(item.contact_name || '').trim();
    const nameConfidence = contactName ? Math.min(100, Math.max(0, Number(item.name_confidence) || 0)) : 0;
    if (status === 'approved' && (!String(item.opening_question || '').trim() || !String(item.evidence || '').trim())) status = 'review';
    updated += stmtReviewLead.run({
      dedup_key: String(item.dedup_key), contact_name: nameConfidence >= 85 ? contactName : '',
      contact_role: nameConfidence >= 85 ? String(item.contact_role || '').trim() : '', name_confidence: nameConfidence,
      opening_question: String(item.opening_question || '').trim(), evidence: String(item.evidence || '').trim(),
      source_url: String(item.source_url || '').trim() || null, review_status: status,
      review_reason: String(item.review_reason || (status === 'approved' ? 'Revisado pelo administrador.' : '')).trim(),
      approved_at: status === 'approved' ? Date.now() : null,
      approved_by: status === 'approved' ? approvedBy : null,
    }).changes;
  }
  return updated;
});
export function funnelStats() {
  const plan = db.prepare(`SELECT COALESCE(SUM(results_found),0) found FROM search_plan`).get();
  const leads = db.prepare(`SELECT COUNT(*) valid,
    SUM(contacted_at IS NOT NULL) contacted, SUM(replied_at IS NOT NULL) replied,
    SUM(interested_at IS NOT NULL) interested, SUM(demo_at IS NOT NULL) demos,
    SUM(opted_out_at IS NOT NULL) opted_out FROM leads`).get();
  return { found: plan.found || 0, valid: leads.valid || 0, contacted: leads.contacted || 0, replied: leads.replied || 0, interested: leads.interested || 0, demos: leads.demos || 0, sales: null, opted_out: leads.opted_out || 0 };
}

/** Leads de WhatsApp ainda não contatados, para virar campanha. */
export function pendingWhatsappLeads(limit = 1000) {
  return leadQueries.pendingWhatsapp.all({ limit });
}

export function pendingEmailLeads(limit = 50) {
  return leadQueries.pendingEmail.all({ limit });
}

export const markLeadsContacted = db.transaction((keys) => {
  const ts = Date.now();
  for (const k of keys) leadQueries.markContacted.run({ dedup_key: k, ts });
});

const stmtInbound = db.prepare(`UPDATE leads SET
  replied_at=COALESCE(replied_at, @ts),
  interested_at=CASE WHEN @interested=1 THEN COALESCE(interested_at, @ts) ELSE interested_at END,
  demo_at=CASE WHEN @demo=1 THEN COALESCE(demo_at, @ts) ELSE demo_at END,
  opted_out_at=CASE WHEN @optout=1 THEN COALESCE(opted_out_at, @ts) ELSE opted_out_at END
  WHERE jid=@jid`);

export function recordLeadResponse(jid, { interested = false, demo = false, optout = false } = {}) {
  if (!jid) return 0;
  return stmtInbound.run({ jid, interested: interested ? 1 : 0, demo: demo ? 1 : 0, optout: optout ? 1 : 0, ts: Date.now() }).changes;
}
