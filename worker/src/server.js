/**
 * API HTTP mínima do worker (Node http puro, sem framework).
 * O painel Next chama estas rotas para: parear (QR/código), criar campanha,
 * ver progresso e pausar/retomar. Protegida por um token simples opcional.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import {
  createCampaign,
  queries,
  getTodayCount,
  todayTotal,
  suppressionCount,
  addSuppression,
  listSuppressions,
  removeSuppression,
  getSetting,
  setSetting,
} from "./db.js";
import { runPlanOnce } from "./scheduler.js";
import { sendDailySummary } from "./daily-summary.js";
import {
  getAllStates,
  firstConnectedId,
  checkOnWhatsApp,
  sendText,
  sendImage,
} from "./wa.js";
import {
  isPaused,
  setPaused,
  effectiveDailyLimit,
} from "./sender.js";
import { numberToJid, normalizeNumber, renderMessage } from "./phone.js";
import {
  planQueries,
  addPlanLine,
  seedPlan,
  addLeads,
  leadStats,
  pendingWhatsappLeads,
  markLeadsContacted,
  planPerformance,
  recordPlanRun,
  funnelStats,
} from "./leads.js";

// Estado por número (chip): conexão + cota do dia.
function numbersStatus() {
  return getAllStates().map((s) => ({
    ...s,
    today: getTodayCount(s.id),
    limit: effectiveDailyLimit(s.id),
  }));
}
// Teto agregado do dia (soma dos números).
function aggregateLimit() {
  return getAllStates().reduce((sum, s) => sum + effectiveDailyLimit(s.id), 0);
}

function send(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-worker-token",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      // Maior que o padrão para caber uma imagem em base64 (~inflada ~33%).
      if (buf.length > 12_000_000) reject(new Error("payload grande demais"));
    });
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

function authorized(req) {
  // Desenvolvimento local pode operar sem token. Em produção, falha fechado.
  if (!config.apiToken) return process.env.NODE_ENV !== "production";
  return req.headers["x-worker-token"] === config.apiToken;
}

// Decodifica uma imagem (data URL base64) em { buffer, ext }, validando tipo/tamanho.
const MEDIA_DIR = path.join(config.dataDir, "media");
const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MB
function decodeImage(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl || "");
  if (!m) return null;
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null;
  return { buffer, ext };
}

// Salva a imagem de uma campanha no disco e devolve o caminho.
function saveCampaignImage(id, dataUrl) {
  const img = decodeImage(dataUrl);
  if (!img) return null;
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const file = path.join(MEDIA_DIR, `camp_${id}.${img.ext}`);
  fs.writeFileSync(file, img.buffer);
  return file;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  try {
    // Saúde/estado — sempre liberado (sem dado sensível).
    if (req.method === "GET" && path === "/health") {
      const numbers = numbersStatus();
      return send(res, 200, {
        ok: true,
        connected: numbers.some((n) => n.connected),
      });
    }

    if (!authorized(req)) return send(res, 401, { error: "não autorizado" });

    // QR / código de pareamento de cada número, para o painel exibir.
    if (req.method === "GET" && path === "/qr") {
      return send(res, 200, { numbers: getAllStates() });
    }

    // Estado dos números + campanhas + progresso.
    if (req.method === "GET" && path === "/status") {
      return send(res, 200, {
        numbers: numbersStatus(),
        paused: isPaused(),
        auto_pause_reason: getSetting('auto_pause_reason', '') || '',
        today: todayTotal(),
        limit: aggregateLimit(),
        suppressed: suppressionCount(),
        campaigns: queries.campaignStats.all(),
      });
    }

    // Adiciona telefones à lista de supressão (não recontatar).
    if (req.method === "POST" && path === "/suppression") {
      const body = await readJson(req);
      const phones = Array.isArray(body.phones) ? body.phones : [];
      let added = 0;
      for (const p of phones) {
        const jid = numberToJid(p);
        if (jid) {
          addSuppression(jid, normalizeNumber(p), body.reason || "manual");
          added++;
        }
      }
      return send(res, 200, { added, total: suppressionCount() });
    }
    if (req.method === "GET" && path === "/suppression") {
      return send(res, 200, { items: listSuppressions(), total: suppressionCount() });
    }
    if (req.method === "DELETE" && path === "/suppression") {
      const jid = new URL(req.url, 'http://localhost').searchParams.get('jid');
      if (!jid) return send(res, 400, { error: 'jid obrigatório' });
      return send(res, 200, { removed: removeSuppression(jid), total: suppressionCount() });
    }
    if (req.method === "GET" && path === "/funnel") {
      return send(res, 200, funnelStats());
    }

    // Cria campanha a partir dos contatos selecionados no painel.
    if (req.method === "POST" && path === "/campaigns") {
      const body = await readJson(req);
      const message = String(body.message || "").trim();
      if (!message) return send(res, 400, { error: "mensagem obrigatória" });
      const contacts = Array.isArray(body.contacts) ? body.contacts : [];
      const items = contacts
        .filter((c) => c && c.phone)
        .map((c) => ({
          lead_id: c.id != null ? String(c.id) : null,
          name: c.name || "",
          phone: String(c.phone),
          jid: numberToJid(c.phone),
        }))
        .filter((c) => c.jid); // descarta telefone claramente inválido
      if (items.length === 0) {
        return send(res, 400, { error: "nenhum contato com telefone válido" });
      }
      const { id, added } = createCampaign(
        {
          name: body.name || "Campanha",
          message,
          app_url: body.app_url || "",
        },
        items
      );
      // Imagem opcional da campanha (enviada como imagem + legenda).
      let image = false;
      if (body.image) {
        const savedPath = saveCampaignImage(id, body.image);
        if (savedPath) {
          queries.setImage.run({ id, path: savedPath });
          image = true;
        }
      }
      return send(res, 201, {
        id,
        added,
        ignored: items.length - added, // duplicados já existentes
        image,
      });
    }

    // Teste de disparo para um número avulso — envio imediato, sem fila e
    // sem contar na cota diária (é só um teste).
    if (req.method === "POST" && path === "/test-send") {
      const body = await readJson(req);
      const number = normalizeNumber(body.phone);
      if (!number) return send(res, 400, { error: "telefone inválido" });
      const senderId = firstConnectedId();
      if (!senderId) return send(res, 400, { error: "WhatsApp não conectado" });
      const message = String(body.message || "").trim();
      if (!message) return send(res, 400, { error: "mensagem obrigatória" });
      const { exists, jid: canonicalJid } = await checkOnWhatsApp(senderId, number);
      if (!exists) return send(res, 400, { error: "número não tem WhatsApp" });
      const jid = canonicalJid || numberToJid(number);
      const text = renderMessage(message, body.name || "", body.app_url || "");
      try {
        const img = body.image ? decodeImage(body.image) : null;
        if (img) await sendImage(senderId, jid, img.buffer, text);
        else await sendText(senderId, jid, text);
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    // Pausa/retoma o worker inteiro.
    if (req.method === "POST" && path === "/control") {
      const body = await readJson(req);
      if (body.action === "pause") setPaused(true);
      else if (body.action === "resume") setPaused(false);
      else return send(res, 400, { error: "action deve ser pause|resume" });
      return send(res, 200, { paused: isPaused() });
    }

    if (req.method === "GET" && path === "/daily-summary") {
      return send(res, 200, { phone: getSetting('admin_summary_phone', config.adminSummaryPhone) || '', time: getSetting('admin_summary_time', config.adminSummaryTime) || config.adminSummaryTime, last_sent: getSetting('admin_summary_last_day', '') || '' });
    }
    if (req.method === "POST" && path === "/daily-summary") {
      const body = await readJson(req);
      const phone = normalizeNumber(body.phone || '');
      const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.time || '')) ? String(body.time) : null;
      if (body.phone && !phone) return send(res, 400, { error: 'telefone inválido' });
      if (!time) return send(res, 400, { error: 'horário inválido' });
      setSetting('admin_summary_phone', phone || ''); setSetting('admin_summary_time', time);
      return send(res, 200, { ok: true, phone: phone || '', time });
    }
    if (req.method === "POST" && path === "/daily-summary/test") {
      const result = await sendDailySummary();
      return send(res, result.sent ? 200 : 503, result);
    }
    if (req.method === "GET" && path === "/lead-alerts") {
      return send(res, 200, { enabled: getSetting('lead_alerts_enabled', '1') === '1', quiet_start: Number(getSetting('lead_alerts_quiet_start', '22')), quiet_end: Number(getSetting('lead_alerts_quiet_end', '8')) });
    }
    if (req.method === "POST" && path === "/lead-alerts") {
      const body = await readJson(req);
      const start = Math.max(0, Math.min(23, Number(body.quiet_start)));
      const end = Math.max(0, Math.min(23, Number(body.quiet_end)));
      if (!Number.isFinite(start) || !Number.isFinite(end)) return send(res, 400, { error: 'horário silencioso inválido' });
      setSetting('lead_alerts_enabled', body.enabled ? '1' : '0'); setSetting('lead_alerts_quiet_start', String(start)); setSetting('lead_alerts_quiet_end', String(end));
      return send(res, 200, { ok: true, enabled: Boolean(body.enabled), quiet_start: start, quiet_end: end });
    }

    // Pausa/retoma/cancela uma campanha específica.
    const m = path.match(/^\/campaigns\/(\d+)\/status$/);
    if (req.method === "POST" && m) {
      const id = Number(m[1]);
      const body = await readJson(req);
      const map = { pause: "paused", resume: "active", cancel: "done" };
      const status = map[body.action];
      if (!status) {
        return send(res, 400, { error: "action deve ser pause|resume|cancel" });
      }
      queries.setCampaignStatus.run({ id, status });
      return send(res, 200, { id, status });
    }

    // ── Plano de busca ──────────────────────────────────────────────────────
    if (req.method === "GET" && path === "/plan") {
      return send(res, 200, { plan: planPerformance() });
    }
    if (req.method === "POST" && path === "/plan") {
      const body = await readJson(req);
      const id = addPlanLine(body);
      if (!id) return send(res, 400, { error: "consulta inválida" });
      return send(res, 201, { id });
    }
    if (req.method === "POST" && path === "/plan/seed") {
      return send(res, 200, { seeded: seedPlan() });
    }
    const pm = path.match(/^\/plan\/(\d+)$/);
    if (req.method === "DELETE" && pm) {
      planQueries.del.run(Number(pm[1]));
      return send(res, 200, { ok: true });
    }

    // ── Pool de leads ───────────────────────────────────────────────────────
    if (req.method === "POST" && path === "/leads") {
      const body = await readJson(req);
      const leads = Array.isArray(body.leads) ? body.leads : [];
      for (const run of Array.isArray(body.plan_runs) ? body.plan_runs : []) {
        recordPlanRun(run.id, run.found);
      }
      const { added, ignored } = addLeads(leads);
      return send(res, 200, { added, ignored, stats: leadStats() });
    }
    if (req.method === "GET" && path === "/leads/stats") {
      return send(res, 200, leadStats());
    }

    // ── Agendamento ─────────────────────────────────────────────────────────
    if (req.method === "GET" && path === "/schedule") {
      return send(res, 200, {
        enabled: getSetting("schedule_enabled") === "1",
        time: getSetting("schedule_time", "") || "",
        auto_dispatch: getSetting("schedule_auto_dispatch") === "1",
        message: getSetting("dispatch_message", "") || "",
        app_url: getSetting("dispatch_app_url", "") || "",
        last_run: getSetting("schedule_last_run", "") || "",
      });
    }
    if (req.method === "POST" && path === "/schedule") {
      const body = await readJson(req);
      setSetting("schedule_enabled", body.enabled ? "1" : "0");
      if (typeof body.time === "string") setSetting("schedule_time", body.time.trim());
      setSetting("schedule_auto_dispatch", body.auto_dispatch ? "1" : "0");
      if (typeof body.message === "string") setSetting("dispatch_message", body.message);
      if (typeof body.app_url === "string") setSetting("dispatch_app_url", body.app_url);
      return send(res, 200, { ok: true });
    }
    // Roda o plano agora (busca imediata pelo worker).
    if (req.method === "POST" && path === "/plan/run") {
      const out = await runPlanOnce();
      return send(res, 200, { ...out, stats: leadStats() });
    }

    // Cria campanha a partir dos leads pendentes (WhatsApp, não contatados).
    if (req.method === "POST" && path === "/campaigns/from-pending") {
      const body = await readJson(req);
      const message = String(body.message || "").trim();
      if (!message) return send(res, 400, { error: "mensagem obrigatória" });
      const limit = Math.max(1, Math.min(5000, Number(body.limit) || 1000));
      const pending = pendingWhatsappLeads(limit);
      if (pending.length === 0) {
        return send(res, 400, { error: "nenhum lead pendente" });
      }
      const items = pending.map((l) => ({
        lead_id: l.dedup_key,
        name: l.name,
        phone: l.phone,
        jid: l.jid,
      }));
      const { id, added } = createCampaign(
        { name: body.name || "Campanha", message, app_url: body.app_url || "" },
        items
      );
      let image = false;
      if (body.image) {
        const savedPath = saveCampaignImage(id, body.image);
        if (savedPath) {
          queries.setImage.run({ id, path: savedPath });
          image = true;
        }
      }
      // Marca os leads como contatados (não voltam para "pendentes").
      markLeadsContacted(pending.map((l) => l.dedup_key));
      return send(res, 201, { id, added, count: pending.length, image });
    }

    // ── Gateway de envio para o ATENDENTE ────────────────────────────────
    // A cópia do Zapien chama isto para responder o lead pelo MESMO chip em que
    // ele está conversando. `number_id` é o chip que recebeu a resposta (vem no
    // payload de /inbound). Sem number_id (ou desconectado): usa o 1º conectado
    // — suficiente para setup de 1 chip. Protegido pelo WORKER_API_TOKEN.
    if (req.method === "POST" && path === "/send") {
      const body = await readJson(req);
      const number = normalizeNumber(body.phone);
      if (!number) return send(res, 400, { error: "telefone inválido" });
      const text = String(body.text || "").trim();
      if (!text) return send(res, 400, { error: "texto obrigatório" });
      const wanted = body.number_id != null ? String(body.number_id) : null;
      const senderId =
        (wanted && getAllStates().some((s) => s.id === wanted && s.connected)
          ? wanted
          : null) || firstConnectedId();
      if (!senderId) return send(res, 503, { error: "WhatsApp não conectado" });
      const jid = numberToJid(number);
      if (!jid) return send(res, 400, { error: "telefone inválido" });
      try {
        await sendText(senderId, jid, text);
        return send(res, 200, { ok: true, number_id: senderId });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    return send(res, 404, { error: "rota não encontrada" });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});

export function startServer() {
  server.listen(config.port, () => {
    console.log(`  API do worker em http://localhost:${config.port}`);
  });
  return server;
}
