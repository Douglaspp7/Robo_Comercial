/**
 * Conexão com o WhatsApp via Baileys — suporta MÚLTIPLOS números (chips) ao
 * mesmo tempo, cada um numa sessão própria (dispositivo vinculado).
 *
 * - Cada número tem sua pasta de auth (<authDir>/<id>) e reconecta sozinho.
 * - Pareamento por QR (padrão) ou por CÓDIGO de 8 dígitos (quando o número tem
 *   pairPhone) — ideal para Pi sem tela.
 * - Reconecta automaticamente, exceto em logout (aí precisa parear de novo).
 *
 * Nunca logamos o conteúdo das mensagens — só telefone abreviado.
 */
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { addSuppression } from "./db.js";
import { classifyInbound, classifyInterest, classifyLeadHeat, forwardToAttendant } from "./bridge.js";
import { recordLeadResponse } from "./leads.js";
import { enqueueLeadAlert, flushLeadAlert } from './lead-alerts.js';
import { getSetting } from './db.js';
import { evaluateOptoutProtection } from './chip-protection.js';

const logger = pino({ level: process.env.WA_LOG_LEVEL || "silent" });

// Uma sessão por número. Chave = id do número (o próprio telefone ou "default").
const sessions = new Map();

function ensureSession(id, pairPhone) {
  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      pairPhone: pairPhone || "",
      sock: null,
      status: "starting", // starting | qr | connecting | open | close | logged_out
      qr: null,
      me: null,
      lastError: null,
      pairingRequested: false,
    };
    sessions.set(id, s);
  }
  return s;
}

function publicState(s) {
  return {
    id: s.id,
    status: s.status,
    connected: s.status === "open",
    qr: s.qr,
    me: s.me,
    lastError: s.lastError,
  };
}

export function getSessionState(id) {
  const s = sessions.get(id);
  return s ? publicState(s) : { id, status: "starting", connected: false, qr: null, me: null, lastError: null };
}

export function getAllStates() {
  return [...sessions.values()].map(publicState);
}

/** Id de um número conectado (para envios avulsos/teste). */
export function firstConnectedId() {
  for (const s of sessions.values()) if (s.status === "open") return s.id;
  return null;
}

export async function startSession({ id, pairPhone }) {
  const s = ensureSession(id, pairPhone);
  const authDir = path.join(config.authDir, String(id));
  fs.mkdirSync(authDir, { recursive: true });
  const { state: authState, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const usePairingCode = Boolean(s.pairPhone);
  const sock = makeWASocket({
    version,
    logger,
    auth: authState,
    browser: ["Robo Comercial", "Chrome", "1.0.0"],
    markOnlineOnConnect: false,
  });
  s.sock = sock;
  sock.ev.on("creds.update", saveCreds);

  // Inbound: opt-out E encaminhamento ao atendente.
  //  - palavra de opt-out (SAIR/PARAR...) → supressão, nunca mais contatado.
  //  - qualquer outra resposta → encaminha ao atendente (a cópia do Zapien que
  //    vende Zapien), se ATTENDANT_URL estiver configurado. É o que faz
  //    "qualquer palavra ativar o robô". Sem atendente: só o opt-out roda.
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages || []) {
      if (msg.key?.fromMe) continue;
      const jid = msg.key?.remoteJid;
      if (!jid || jid.endsWith("@g.us")) continue; // ignora grupos
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";
      const kind = classifyInbound(text);
      if (kind === "ignore") continue;
      const phone = jid.split("@")[0];
      if (phone === String(getSetting('admin_summary_phone', '')).replace(/\D/g, '')) continue;
      if (kind === "optout") {
        recordLeadResponse(jid, { optout: true });
        addSuppression(jid, phone, "optout");
        evaluateOptoutProtection();
        console.log(`  [${id}] opt-out recebido de ...${phone.slice(-4)} → supressão.`);
        continue;
      }
      const heat = classifyLeadHeat(text);
      recordLeadResponse(jid, { interested: classifyInterest(text), demo: heat?.reason === 'pediu demonstração' });
      if (heat) {
        enqueueLeadAlert({ jid, phone, name: msg.pushName || '', heat });
        flushLeadAlert({ firstConnectedId, sendText }).catch(() => {});
      }
      // kind === "forward": a resposta do lead vai para o atendente, que
      // responde pelo MESMO chip (number_id) via POST /send do worker.
      forwardToAttendant({
        number_id: id,
        jid,
        phone,
        text: text.trim(),
        name: msg.pushName || "",
      })
        .then((ok) => {
          if (ok) console.log(`  [${id}] resposta de ...${phone.slice(-4)} → atendente.`);
        })
        .catch(() => {});
    }
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && usePairingCode && !s.pairingRequested && !sock.authState.creds.registered) {
      s.pairingRequested = true;
      try {
        const code = await sock.requestPairingCode(s.pairPhone);
        s.status = "qr";
        s.qr = `PAIR:${code}`;
        console.log(`\n  [${id}] Código de pareamento: ${code}\n`);
      } catch (e) {
        s.lastError = `Falha ao gerar código de pareamento: ${e.message}`;
        console.error(`  [${id}] ${s.lastError}`);
      }
      return;
    }

    if (qr && !usePairingCode) {
      s.status = "qr";
      s.qr = qr;
      console.log(`\n  [${id}] Escaneie o QR no WhatsApp do número:\n`);
      qrcode.generate(qr, { small: true });
    }

    if (connection === "connecting") s.status = "connecting";

    if (connection === "open") {
      s.status = "open";
      s.qr = null;
      s.lastError = null;
      s.me = sock.user?.id || null;
      const tail = (s.me || "").replace(/[^0-9]/g, "").slice(-4);
      console.log(`  [${id}] WhatsApp conectado (final ...${tail}).`);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      s.status = loggedOut ? "logged_out" : "close";
      s.me = null;
      if (loggedOut) {
        s.lastError = "Sessão encerrada (logout). Apague a pasta de auth e pareie de novo.";
        console.error(`  [${id}] ${s.lastError}`);
        return;
      }
      console.warn(`  [${id}] Conexão caiu (code ${statusCode ?? "?"}). Reconectando em 3s...`);
      s.pairingRequested = false;
      setTimeout(() => startSession({ id, pairPhone: s.pairPhone }).catch(() => {}), 3000);
    }
  });

  return sock;
}

/** Sobe todas as sessões configuradas. */
export async function startAll(numbers) {
  for (const n of numbers) {
    await startSession(n).catch((e) =>
      console.error(`  [${n.id}] Falha ao iniciar:`, e.message)
    );
  }
}

/** Verifica se um número tem WhatsApp, usando a sessão informada. */
export async function checkOnWhatsApp(sessionId, number) {
  const s = sessions.get(sessionId);
  if (!s?.sock) return { exists: false, jid: null };
  try {
    const results = await s.sock.onWhatsApp(number);
    const hit = results?.[0];
    return { exists: Boolean(hit?.exists), jid: hit?.jid || null };
  } catch (e) {
    s.lastError = `onWhatsApp: ${e.message}`;
    return { exists: false, jid: null };
  }
}

/** Envia texto com presença "digitando", a partir da sessão informada. */
export async function sendText(sessionId, jid, text) {
  const s = sessions.get(sessionId);
  if (!s?.sock || s.status !== "open") throw new Error("WhatsApp não conectado");
  try {
    await s.sock.sendPresenceUpdate("composing", jid);
  } catch {
    /* best-effort */
  }
  const typingMs = Math.min(3000, 400 + text.length * 25);
  await new Promise((r) => setTimeout(r, typingMs));
  const res = await s.sock.sendMessage(jid, { text });
  try {
    await s.sock.sendPresenceUpdate("paused", jid);
  } catch {
    /* idem */
  }
  return res;
}

/** Envia imagem (buffer) com legenda, a partir da sessão informada. */
export async function sendImage(sessionId, jid, buffer, caption) {
  const s = sessions.get(sessionId);
  if (!s?.sock || s.status !== "open") throw new Error("WhatsApp não conectado");
  return s.sock.sendMessage(jid, { image: buffer, caption: caption || "" });
}
