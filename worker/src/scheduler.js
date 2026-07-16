/**
 * Agendador: roda o plano de busca automaticamente 1x por dia no horário
 * configurado (e, opcionalmente, já dispara os pendentes). Como a busca usa as
 * chaves Google/Instagram do painel, o worker chama as rotas do painel
 * (PANEL_URL) para cada linha do plano e guarda no pool (deduplicado).
 *
 * Configuração vem do settings (setado pelo painel):
 *   schedule_enabled       "1" | "0"
 *   schedule_time          "HH:MM" (hora local)
 *   schedule_auto_dispatch "1" | "0"
 *   dispatch_message       mensagem do disparo automático
 *   dispatch_app_url       URL anexada
 *   schedule_last_run      "YYYY-MM-DD" (controle interno anti-duplicação)
 */
import { config } from "./config.js";
import fs from "node:fs";
import {
  getSetting,
  setSetting,
  todayStr,
  createCampaign,
  db,
  queries,
} from "./db.js";
import { getAllStates, firstConnectedId, sendText } from "./wa.js";
import { numberToJid } from "./phone.js";
import {
  planQueries,
  addLeads,
  pendingWhatsappLeads,
  markLeadsContacted,
  recordPlanRun,
} from "./leads.js";

let timer = null;
let scheduledCheckRunning = false;

export function campaignReadiness({ connected = 0, attendantConfigured = false, items = 0, imageRequired = false, imageAvailable = true } = {}) {
  if (connected < 1) return { ready: false, reason: 'nenhum chip conectado' };
  if (!attendantConfigured) return { ready: false, reason: 'atendente Zapien não configurado' };
  if (items < 1) return { ready: false, reason: 'campanha sem contatos' };
  if (imageRequired && !imageAvailable) return { ready: false, reason: 'criativo da campanha não encontrado' };
  return { ready: true, reason: '' };
}

async function notifySchedule(text) {
  if (!config.adminSummaryPhone) return;
  const numberId = firstConnectedId();
  const jid = numberToJid(config.adminSummaryPhone);
  if (numberId && jid) await sendText(numberId, jid, text).catch(() => {});
}

export async function checkScheduledCampaigns(now = Date.now()) {
  const campaigns = queries.scheduledDue.all({ until: now + 5 * 60_000 });
  for (const campaign of campaigns) {
    const connected = getAllStates().filter((number) => number.connected).length;
    const itemCount = db.prepare(`SELECT COUNT(*) count FROM campaign_items WHERE campaign_id=? AND status='pending'`).get(campaign.id).count;
    const readiness = campaignReadiness({
      connected,
      attendantConfigured: Boolean(config.attendantUrl),
      items: itemCount,
      imageRequired: Boolean(campaign.image_path),
      imageAvailable: !campaign.image_path || fs.existsSync(campaign.image_path),
    });
    if (!readiness.ready) {
      queries.preflightFail.run({ id: campaign.id, ts: now, reason: readiness.reason });
      await notifySchedule(`⚠️ Campanha "${campaign.name}" não iniciada: ${readiness.reason}.`);
      continue;
    }
    queries.preflightOk.run({ id: campaign.id, ts: now });
    if (campaign.scheduled_for <= now) {
      queries.activateScheduled.run({ id: campaign.id, ts: now });
      await notifySchedule(`🚀 Campanha "${campaign.name}" iniciada com ${itemCount} contatos e ${connected} chip(s).`);
    }
  }
}

async function searchLine(line) {
  const url =
    line.source === "google"
      ? `${config.panelUrl}/api/search`
      : `${config.panelUrl}/api/instagram`;
  const body =
    line.source === "google"
      ? { query: `${line.query} in ${line.location || ""}`, deep: Boolean(line.deep) }
      : { mode: line.mode || "hashtag", query: line.query };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return Array.isArray(data.results)
    ? data.results.map((r) => ({ ...r, source: line.source, segment: line.query }))
    : [];
}

export async function runPlanOnce() {
  const plan = planQueries.list.all();
  const collected = [];
  for (const line of plan) {
    try {
      const found = await searchLine(line);
      recordPlanRun(line.id, found.length);
      collected.push(...found.map((lead) => ({ ...lead, plan_id: line.id })));
    } catch (e) {
      console.warn(`  [agendador] linha falhou (${line.query}):`, e.message);
    }
  }
  const { added, ignored } = addLeads(collected);
  console.log(`  [agendador] busca concluída: ${added} novos, ${ignored} ignorados.`);

  if (getSetting("schedule_auto_dispatch") === "1") {
    const message = getSetting("dispatch_message", "");
    if (message) {
      const pending = pendingWhatsappLeads(1000);
      if (pending.length > 0) {
        const items = pending.map((l) => ({
          lead_id: l.dedup_key,
          name: l.name_confidence >= 85 ? l.contact_name : "",
          company_name: l.company_name,
          opening_question: l.opening_question,
          phone: l.phone,
          jid: l.jid,
        }));
        const { id } = createCampaign(
          { name: `Agendada ${todayStr()}`, message, app_url: getSetting("dispatch_app_url", "") || "", approach: getSetting("dispatch_approach", "permission"),
            followup_enabled: getSetting("followup_enabled", "0") === "1",
            followup_delay_hours: Number(getSetting("followup_delay_hours", "24")),
            followup_message: getSetting("followup_message", "") },
          items
        );
        markLeadsContacted(pending.map((l) => l.dedup_key));
        console.log(`  [agendador] disparo automático: campanha ${id} com ${pending.length} leads.`);
      }
    }
  }
  return { added, ignored };
}

function tick() {
  try {
    if (!scheduledCheckRunning) {
      scheduledCheckRunning = true;
      checkScheduledCampaigns().catch((e) => console.error('  [campanha agendada]', e.message)).finally(() => { scheduledCheckRunning = false; });
    }
    if (getSetting("schedule_enabled") !== "1") return;
    const time = getSetting("schedule_time", "");
    if (!time) return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    // Roda quando passa do horário e ainda não rodou hoje (pega atraso no boot).
    if (hhmm >= time && getSetting("schedule_last_run") !== todayStr()) {
      setSetting("schedule_last_run", todayStr());
      runPlanOnce().catch((e) => console.error("  [agendador]", e.message));
    }
  } catch (e) {
    console.error("  [agendador tick]", e.message);
  }
}

export function startScheduler() {
  timer = setInterval(tick, 60_000);
  tick();
  console.log("  Agendador iniciado.");
}
export function stopScheduler() {
  clearInterval(timer);
}
