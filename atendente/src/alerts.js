/**
 * Alertas operacionais da plataforma — avisam o dono ANTES do atendimento parar.
 *
 * Canais:
 *  - WhatsApp para ALERT_PHONE (ou SUPPORT_PHONE) — chega no seu celular.
 *  - console.error com prefixo [ALERT] — sempre (aparece nos logs do Render,
 *    e não depende de nenhum provedor externo estar funcionando).
 *  - /health expõe os alertas recentes (para um monitor externo tipo UptimeRobot).
 *
 * Throttle por tipo (cooldown) para não repetir o mesmo alerta sem parar.
 *
 * O envio de WhatsApp é injetado por registerAlertSender() (evita ciclo de
 * import com whatsapp.js). Sem sender registrado (ex.: testes), só loga.
 */
import { config } from './config.js';

const ALERT_PHONE = (process.env.ALERT_PHONE || config.supportPhone || '').replace(/\D/g, '');
const COOLDOWN_MS = (Number(process.env.ALERT_COOLDOWN_MIN) || 30) * 60 * 1000;

const LABELS = {
  queue: 'Fila de atendimento sobrecarregada',
  anthropic: 'Créditos da IA (Anthropic) esgotando ou esgotados',
  openai: 'Créditos da IA (OpenAI) esgotando ou esgotados',
  meta: 'WhatsApp (Meta) com problema de pagamento ou limite de envio',
  email: 'Falha no envio de e-mail transacional (recuperação de senha)',
};

const lastSentAt = new Map();       // type -> ms do último alerta enviado
const recentAlerts = [];            // histórico curto, exposto no /health

let sender = null;                  // fn(phone, text) => Promise, injetado no boot

export function registerAlertSender(fn) { sender = fn; }

/** Últimos alertas (para o /health). */
export function getRecentAlerts() { return recentAlerts.slice(-20); }

/**
 * Dispara um alerta. Idempotente por tipo dentro do cooldown (não spamma).
 * @param {'queue'|'anthropic'|'openai'|'meta'} type
 * @param {string} [detail]  detalhe curto (ex.: "fila=63" ou trecho do erro)
 */
export async function sendAlert(type, detail = '') {
  const now = Date.now();
  const last = lastSentAt.get(type) || 0;
  if (now - last < COOLDOWN_MS) return; // throttle
  lastSentAt.set(type, now);

  const label = LABELS[type] || type;
  console.error(`[ALERT][${type}] ${label}${detail ? ' — ' + detail : ''}`);
  recentAlerts.push({ type, label, detail: String(detail).slice(0, 200), at: new Date().toISOString() });
  if (recentAlerts.length > 50) recentAlerts.shift();

  if (!ALERT_PHONE || !sender) return;
  const msg = `🚨 Zapien — alerta operacional\n\n${label}.${detail ? '\n\n' + String(detail).slice(0, 300) : ''}\n\nVerifique para o atendimento não parar. ⚠️`;
  try {
    await sender(ALERT_PHONE, msg);
  } catch (e) {
    console.error('[ALERT] falha ao enviar WhatsApp do alerta:', e.message);
  }
}

/**
 * Classifica um erro da Anthropic e dispara alerta de crédito se for o caso.
 * Retorna true se era erro de crédito (para o chamador decidir o que fazer).
 */
export function checkAnthropicCreditError(err) {
  const status = err?.status ?? err?.statusCode;
  const msg = (err?.error?.error?.message || err?.error?.message || err?.message || '').toLowerCase();
  // Saldo baixo na Anthropic: HTTP 400 com "credit balance is too low"; também
  // cobrimos "billing"/"payment"/"insufficient" e HTTP 402.
  const isCredit = status === 402 || /credit balance|billing|insufficient|payment required/.test(msg);
  if (isCredit) sendAlert('anthropic', msg.slice(0, 180));
  return isCredit;
}

/** Classifica uma resposta da OpenAI (transcrição) e alerta se for falta de quota. */
export function checkOpenAiQuota(status, bodyText) {
  const body = (bodyText || '').toLowerCase();
  if (status === 429 && /insufficient_quota|exceeded your current quota|billing/.test(body)) {
    sendAlert('openai', body.slice(0, 180));
    return true;
  }
  return false;
}

/** Classifica uma resposta de erro do WhatsApp (Meta) e alerta se for pagamento/limite. */
export function checkMetaBillingError(status, bodyText) {
  const body = (bodyText || '').toLowerCase();
  // 131042 = problema de elegibilidade/pagamento da conta de negócio.
  // Também cobrimos menções a pagamento/limite de gasto/conta restrita.
  const isBilling = /"code"\s*:\s*131042|payment|spending limit|spend limit|account.*restrict|billing/.test(body);
  if (isBilling) {
    sendAlert('meta', body.slice(0, 180));
    return true;
  }
  return false;
}
