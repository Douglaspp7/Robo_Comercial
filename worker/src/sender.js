/**
 * Disparo com MÚLTIPLOS números: um loop independente por chip. Cada loop
 * respeita a cota e o aquecimento DAQUELE número e puxa da fila compartilhada
 * com reserva atômica (dois chips nunca pegam o mesmo lead).
 *
 * Reinício do Pi não perde nada: o estado vive no SQLite; itens travados em
 * 'sending' voltam para 'pending' no boot (ver db.js).
 */
import fs from "node:fs";
import { config, randomDelaySec } from "./config.js";
import {
  db,
  queries,
  getTodayCount,
  incTodayCount,
  usedDays,
  getHourCount,
  incHourCount,
  isSuppressed,
} from "./db.js";
import { getSessionState, checkOnWhatsApp, sendText, sendImage } from "./wa.js";
import { numberToJid, normalizeNumber, renderMessage } from "./phone.js";
import { recordDeliveryFailure, resetDeliveryFailures } from './chip-protection.js';

let paused = false;
let stopped = false;
const timers = new Map(); // numberId -> timeout
let activeNumbers = [];

export function isPaused() {
  return paused;
}
export function setPaused(v) {
  paused = Boolean(v);
  if (!paused) for (const id of activeNumbers) schedule(id, 0); // retoma já
}

/** Limite efetivo de hoje para UM número, considerando o aquecimento. */
export function effectiveDailyLimit(numberId) {
  const ramp = config.warmupRamp;
  if (ramp.length === 0) return config.dailyLimit;
  const dayIndex = getTodayCount(numberId) > 0 ? usedDays(numberId) : usedDays(numberId) + 1;
  return dayIndex <= ramp.length ? ramp[dayIndex - 1] : config.dailyLimit;
}

function msUntilNextDay() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 30, 0);
  return next.getTime() - now.getTime();
}

// Janela de horário (cadência humana): só envia dentro de [start, end).
function withinWindow() {
  const w = config.sendWindow;
  if (!w) return true;
  const h = new Date().getHours();
  return h >= w.start && h < w.end;
}
function msUntilWindowOpen() {
  const w = config.sendWindow;
  const now = new Date();
  const target = new Date(now);
  target.setHours(w.start, 0, 5, 0);
  if (now.getHours() >= w.start) target.setDate(target.getDate() + 1); // fora = já passou de end
  return Math.max(1000, target.getTime() - now.getTime());
}
function msUntilNextHour() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 5, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

function schedule(numberId, ms) {
  if (stopped) return;
  clearTimeout(timers.get(numberId));
  timers.set(numberId, setTimeout(() => tick(numberId), ms));
}

const stmtCampaign = db.prepare(`SELECT * FROM campaigns WHERE id=?`);

async function tick(numberId) {
  if (stopped) return;

  if (!getSessionState(numberId).connected) return schedule(numberId, 5000);
  if (paused) return schedule(numberId, 3000);

  // Cota diária deste número.
  if (getTodayCount(numberId) >= effectiveDailyLimit(numberId)) {
    return schedule(numberId, msUntilNextDay());
  }
  // Janela de horário (não enviar de madrugada).
  if (!withinWindow()) return schedule(numberId, msUntilWindowOpen());
  // Teto por hora deste número (suaviza picos).
  if (config.maxPerHour > 0 && getHourCount(numberId) >= config.maxPerHour) {
    return schedule(numberId, msUntilNextHour());
  }

  // Reserva atômica do próximo pendente (marca 'sending' + este número).
  const item = queries.claimNext.get({ number_id: numberId });
  if (!item) {
    queries.closeFinished.run();
    return schedule(numberId, 15000); // ocioso
  }

  const number = normalizeNumber(item.phone);
  if (!number) {
    queries.markInvalid.run({ id: item.id, error: "telefone inválido" });
    return schedule(numberId, 500);
  }

  // Valida no WhatsApp usando ESTA sessão (não gasta cota se não existe).
  const { exists, jid: canonicalJid } = await checkOnWhatsApp(numberId, number);
  if (!exists) {
    queries.markInvalid.run({ id: item.id, error: "sem WhatsApp" });
    return schedule(numberId, 1500);
  }
  const jid = canonicalJid || item.jid || numberToJid(item.phone);
  if (jid !== item.jid) queries.setJid.run({ id: item.id, jid });

  // Supressão: opt-out (SAIR) ou "não recontatar" → não envia.
  if (isSuppressed(jid)) {
    queries.markInvalid.run({ id: item.id, error: "opt-out/supressão" });
    return schedule(numberId, 300);
  }

  // Não recontatar: já recebeu (em qualquer campanha) nos últimos N dias?
  if (config.recontactDays > 0) {
    const since = Date.now() - config.recontactDays * 86_400_000;
    if (queries.recentlyContacted.get({ jid, since })) {
      queries.markInvalid.run({ id: item.id, error: `já contatado (${config.recontactDays}d)` });
      return schedule(numberId, 300);
    }
  }

  const camp = stmtCampaign.get(item.campaign_id);
  let text = renderMessage(camp.message, item.name, camp.app_url, item);
  if (config.optoutFooter) text += `\n\n${config.optoutFooter}`;
  const tail = number.slice(-4);
  try {
    if (camp.image_path && fs.existsSync(camp.image_path)) {
      await sendImage(numberId, jid, fs.readFileSync(camp.image_path), text);
    } else {
      await sendText(numberId, jid, text);
    }
    queries.markSent.run({ id: item.id, ts: Date.now() });
    incTodayCount(numberId);
    incHourCount(numberId);
    resetDeliveryFailures();
    console.log(
      `  [${numberId}] enviado ...${tail} ` +
        `(${getTodayCount(numberId)}/${effectiveDailyLimit(numberId)} hoje).`
    );
  } catch (e) {
    const attempts = item.attempts + 1;
    if (attempts >= config.maxAttempts) {
      queries.markFailed.run({ id: item.id, error: e.message, ts: Date.now() });
      recordDeliveryFailure();
      console.warn(`  [${numberId}] falha definitiva ...${tail}: ${e.message}`);
    } else {
      queries.requeue.run({ id: item.id, error: e.message });
      console.warn(`  [${numberId}] erro ...${tail} (tentativa ${attempts}): ${e.message}`);
    }
  }

  schedule(numberId, randomDelaySec() * 1000);
}

export function startSender(numbers) {
  stopped = false;
  activeNumbers = numbers.map((n) => n.id);
  for (const id of activeNumbers) schedule(id, 1000);
  console.log(`  Loop de disparo iniciado (${activeNumbers.length} número(s)).`);
}
export function stopSender() {
  stopped = true;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
