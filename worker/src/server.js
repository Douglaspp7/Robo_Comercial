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
} from "./db.js";
import { getWaState, checkOnWhatsApp, sendText, sendImage } from "./wa.js";
import {
  isPaused,
  setPaused,
  effectiveDailyLimit,
} from "./sender.js";
import { numberToJid, normalizeNumber, renderMessage } from "./phone.js";

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
  if (!config.apiToken) return true; // token desligado
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
      if (!getWaState().connected) {
        return send(res, 400, { error: "WhatsApp não conectado" });
      }
      const message = String(body.message || "").trim();
      if (!message) return send(res, 400, { error: "mensagem obrigatória" });
      const { exists, jid: canonicalJid } = await checkOnWhatsApp(number);
      if (!exists) return send(res, 400, { error: "número não tem WhatsApp" });
      const jid = canonicalJid || numberToJid(number);
      const text = renderMessage(message, body.name || "", body.app_url || "");
      try {
        const img = body.image ? decodeImage(body.image) : null;
        if (img) await sendImage(jid, img.buffer, text);
        else await sendText(jid, text);
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
