/**
 * API HTTP mínima do worker (Node http puro, sem framework).
 * O painel Next chama estas rotas para: parear (QR/código), criar campanha,
 * ver progresso e pausar/retomar. Protegida por um token simples opcional.
 */
import http from "node:http";
import { config } from "./config.js";
import {
  createCampaign,
  queries,
  getTodayCount,
} from "./db.js";
import { getWaState } from "./wa.js";
import {
  isPaused,
  setPaused,
  effectiveDailyLimit,
} from "./sender.js";
import { numberToJid } from "./phone.js";

function send(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-worker-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > 5_000_000) reject(new Error("payload grande demais"));
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
  if (!config.apiToken) return true; // token desligado
  return req.headers["x-worker-token"] === config.apiToken;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  try {
    // Saúde/estado — sempre liberado (sem dado sensível).
    if (req.method === "GET" && path === "/health") {
      return send(res, 200, {
        ok: true,
        wa: getWaState(),
        paused: isPaused(),
        today: getTodayCount(),
        limit: effectiveDailyLimit(),
      });
    }

    if (!authorized(req)) return send(res, 401, { error: "não autorizado" });

    // QR / código de pareamento para o painel exibir.
    if (req.method === "GET" && path === "/qr") {
      const { qr, status } = getWaState();
      return send(res, 200, { status, qr });
    }

    // Lista de campanhas + estatísticas.
    if (req.method === "GET" && path === "/status") {
      return send(res, 200, {
        wa: getWaState(),
        paused: isPaused(),
        today: getTodayCount(),
        limit: effectiveDailyLimit(),
        campaigns: queries.campaignStats.all(),
      });
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
      return send(res, 201, {
        id,
        added,
        ignored: items.length - added, // duplicados já existentes
      });
    }

    // Pausa/retoma o worker inteiro.
    if (req.method === "POST" && path === "/control") {
      const body = await readJson(req);
      if (body.action === "pause") setPaused(true);
      else if (body.action === "resume") setPaused(false);
      else return send(res, 400, { error: "action deve ser pause|resume" });
      return send(res, 200, { paused: isPaused() });
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
