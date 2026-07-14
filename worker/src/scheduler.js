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
import {
  getSetting,
  setSetting,
  todayStr,
  createCampaign,
} from "./db.js";
import {
  planQueries,
  addLeads,
  pendingWhatsappLeads,
  markLeadsContacted,
} from "./leads.js";

let timer = null;

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
    ? data.results.map((r) => ({ ...r, source: line.source }))
    : [];
}

export async function runPlanOnce() {
  const plan = planQueries.list.all();
  const collected = [];
  for (const line of plan) {
    try {
      collected.push(...(await searchLine(line)));
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
          name: l.name,
          phone: l.phone,
          jid: l.jid,
        }));
        const { id } = createCampaign(
          { name: `Agendada ${todayStr()}`, message, app_url: getSetting("dispatch_app_url", "") || "" },
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
