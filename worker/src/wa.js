/**
 * Conexão com o WhatsApp via Baileys (dispositivo vinculado / multi-device).
 *
 * - Persiste a sessão em disco (useMultiFileAuthState) → reconecta sozinho
 *   após reboot, sem parear de novo.
 * - Pareamento por QR (padrão) ou por CÓDIGO de 8 dígitos (WA_PAIR_PHONE) —
 *   o código é ideal para um Pi sem tela: você digita no celular em
 *   "Aparelhos conectados › Conectar com número de telefone".
 * - Reconecta automaticamente, exceto quando desconectado por logout
 *   (aí precisa parear de novo).
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
import { config } from "./config.js";

const logger = pino({ level: process.env.WA_LOG_LEVEL || "silent" });

const state = {
  sock: null,
  status: "starting", // starting | qr | connecting | open | close | logged_out
  qr: null, // string do QR atual (para exibir no painel), null quando conectado
  me: null, // jid do próprio número, quando conectado
  lastError: null,
};

export function getWaState() {
  return {
    status: state.status,
    connected: state.status === "open",
    qr: state.qr,
    me: state.me,
    lastError: state.lastError,
  };
}

let pairingRequested = false;

export async function startWhatsApp() {
  fs.mkdirSync(config.authDir, { recursive: true });
  const { state: authState, saveCreds } = await useMultiFileAuthState(
    config.authDir
  );
  const { version } = await fetchLatestBaileysVersion();

  const usePairingCode = Boolean(config.pairPhone);

  const sock = makeWASocket({
    version,
    logger,
    auth: authState,
    // printQRInTerminal foi removido no Baileys 7 — tratamos o QR nós mesmos.
    browser: ["Robo Comercial", "Chrome", "1.0.0"],
    markOnlineOnConnect: false, // não marca o número como "online" o tempo todo
  });
  state.sock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Pareamento por código: só quando ainda não registrado e há telefone.
    if (
      qr &&
      usePairingCode &&
      !pairingRequested &&
      !sock.authState.creds.registered
    ) {
      pairingRequested = true;
      try {
        const code = await sock.requestPairingCode(config.pairPhone);
        state.status = "qr";
        state.qr = `PAIR:${code}`;
        console.log(
          `\n  Código de pareamento: ${code}\n` +
            `  No celular do número: WhatsApp › Aparelhos conectados ›\n` +
            `  Conectar um aparelho › Conectar com número de telefone.\n`
        );
      } catch (e) {
        state.lastError = `Falha ao gerar código de pareamento: ${e.message}`;
        console.error(state.lastError);
      }
      return;
    }

    if (qr && !usePairingCode) {
      state.status = "qr";
      state.qr = qr;
      console.log("\n  Escaneie o QR abaixo no WhatsApp do número:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "connecting") state.status = "connecting";

    if (connection === "open") {
      state.status = "open";
      state.qr = null;
      state.lastError = null;
      state.me = sock.user?.id || null;
      const tail = (state.me || "").replace(/[^0-9]/g, "").slice(-4);
      console.log(`  WhatsApp conectado (número final ...${tail}).`);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      state.status = loggedOut ? "logged_out" : "close";
      state.me = null;
      if (loggedOut) {
        state.lastError =
          "Sessão encerrada (logout). Apague a pasta de auth e pareie de novo.";
        console.error("  " + state.lastError);
        return; // não reconecta sozinho
      }
      console.warn(
        `  Conexão caiu (code ${statusCode ?? "?"}). Reconectando em 3s...`
      );
      pairingRequested = false;
      setTimeout(() => startWhatsApp().catch(() => {}), 3000);
    }
  });

  return sock;
}

/**
 * Verifica se um número tem WhatsApp. Retorna { exists, jid } — usa o jid
 * canônico devolvido pelo WhatsApp (evita erro de formatação).
 */
export async function checkOnWhatsApp(number) {
  if (!state.sock) return { exists: false, jid: null };
  try {
    const results = await state.sock.onWhatsApp(number);
    const hit = results?.[0];
    return { exists: Boolean(hit?.exists), jid: hit?.jid || null };
  } catch (e) {
    state.lastError = `onWhatsApp: ${e.message}`;
    return { exists: false, jid: null };
  }
}

/** Envia texto com presença "digitando" para parecer mais humano. */
export async function sendText(jid, text) {
  if (!state.sock || state.status !== "open") {
    throw new Error("WhatsApp não conectado");
  }
  try {
    await state.sock.sendPresenceUpdate("composing", jid);
  } catch {
    /* presença é best-effort */
  }
  // Pequena pausa proporcional ao tamanho do texto (máx. ~3s).
  const typingMs = Math.min(3000, 400 + text.length * 25);
  await new Promise((r) => setTimeout(r, typingMs));
  const res = await state.sock.sendMessage(jid, { text });
  try {
    await state.sock.sendPresenceUpdate("paused", jid);
  } catch {
    /* idem */
  }
  return res;
}
