/**
 * Loop de disparo. Um único worker processa a fila em série, respeitando:
 *  - cota diária (com aquecimento/warmup para número novo);
 *  - intervalo aleatório entre envios (cadência humana);
 *  - resume: quem já foi enviado nunca é reenviado (garantido pelo status);
 *  - validação: número sem WhatsApp é marcado 'invalid' e não gasta cota.
 *
 * Reinício do Pi não perde nada: o estado vive no SQLite.
 */
import { config, randomDelaySec } from "./config.js";
import {
  queries,
  getTodayCount,
  incTodayCount,
  usedDays,
} from "./db.js";
import { getWaState, checkOnWhatsApp, sendText } from "./wa.js";
import { numberToJid, normalizeNumber, renderMessage } from "./phone.js";

let paused = false;
let timer = null;
let stopped = false;

export function isPaused() {
  return paused;
}
export function setPaused(v) {
  paused = Boolean(v);
  if (!paused) schedule(0); // retoma imediatamente
}

/** Limite efetivo de hoje considerando o aquecimento (warmup). */
export function effectiveDailyLimit() {
  const ramp = config.warmupRamp;
  if (ramp.length === 0) return config.dailyLimit;
  // Qual "dia de uso" é hoje? Se já houve envio hoje, hoje já está contado.
  const dayIndex = getTodayCount() > 0 ? usedDays() : usedDays() + 1;
  return dayIndex <= ramp.length ? ramp[dayIndex - 1] : config.dailyLimit;
}

function msUntilNextDay() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 30, 0); // 00:00:30 do dia seguinte
  return next.getTime() - now.getTime();
}

function schedule(ms) {
  if (stopped) return;
  clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

async function tick() {
  if (stopped) return;

  // WhatsApp precisa estar conectado.
  if (!getWaState().connected) return schedule(5000);
  if (paused) return schedule(3000);

  // Cota diária.
  if (getTodayCount() >= effectiveDailyLimit()) {
    console.log(
      `  Cota diária atingida (${getTodayCount()}/${effectiveDailyLimit()}). ` +
        "Pausando até o próximo dia."
    );
    return schedule(msUntilNextDay());
  }

  // Próximo contato pendente de campanha ativa.
  const item = queries.nextPending.get();
  if (!item) {
    queries.closeFinished.run();
    return schedule(15000); // ocioso: aguarda novas campanhas
  }

  const number = normalizeNumber(item.phone);
  if (!number) {
    queries.markInvalid.run({ id: item.id, error: "telefone inválido" });
    return schedule(500);
  }

  // Confirma que o número tem WhatsApp (não gasta cota se não tiver).
  const { exists, jid: canonicalJid } = await checkOnWhatsApp(number);
  if (!exists) {
    queries.markInvalid.run({ id: item.id, error: "sem WhatsApp" });
    return schedule(1500);
  }
  const jid = canonicalJid || item.jid || numberToJid(item.phone);
  if (jid !== item.jid) queries.setJid.run({ id: item.id, jid });

  // Monta e envia.
  const camp = campaignFor(item.campaign_id);
  const text = renderMessage(camp.message, item.name, camp.app_url);
  const tail = number.slice(-4);
  try {
    await sendText(jid, text);
    queries.markSent.run({ id: item.id, ts: Date.now() });
    incTodayCount();
    console.log(
      `  Enviado ...${tail} (${getTodayCount()}/${effectiveDailyLimit()} hoje).`
    );
  } catch (e) {
    const attempts = item.attempts + 1;
    queries.bumpAttempt.run({ id: item.id, error: e.message });
    if (attempts >= config.maxAttempts) {
      queries.markFailed.run({ id: item.id, error: e.message });
      console.warn(`  Falha definitiva ...${tail}: ${e.message}`);
    } else {
      console.warn(`  Erro ...${tail} (tentativa ${attempts}): ${e.message}`);
    }
  }

  schedule(randomDelaySec() * 1000);
}

// Cache leve de campanhas (mensagem/app_url mudam raramente).
import { db } from "./db.js";
const stmtCampaign = db.prepare(`SELECT * FROM campaigns WHERE id=?`);
function campaignFor(id) {
  return stmtCampaign.get(id);
}

export function startSender() {
  stopped = false;
  schedule(1000);
  console.log("  Loop de disparo iniciado.");
}
export function stopSender() {
  stopped = true;
  clearTimeout(timer);
}
