/**
 * Web Push (notificações no celular/desktop via PWA).
 *
 * Complemento — o painel funciona 100% sem VAPID configurado: todas as
 * funções aqui degradam para no-op silencioso quando desativado.
 *
 * Segurança/privacidade:
 *  - o payload de um push NUNCA carrega telefone completo, CPF/CNPJ, endereço
 *    ou conteúdo de conversa (aparece em tela bloqueada!) — só título/texto
 *    genéricos e uma URL interna do painel;
 *  - assinaturas com endpoint morto (404/410) são desativadas na hora;
 *  - deduplicação por (tenant, chave semântica) + cooldown evita spam.
 */
import webpush from 'web-push';
import {
  tenantQueries,
  pushSubscriptionQueries,
  pushDedupeQueries,
  db,
} from './db.js';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contato@zapien.app';

// Derivado das chaves, com override explícito (WEB_PUSH_ENABLED=false desliga
// mesmo com chaves presentes; =true sem chaves continua desligado — sem chave
// não há como assinar).
export const webPushEnabled =
  process.env.WEB_PUSH_ENABLED === 'false'
    ? false
    : Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (webPushEnabled) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (e) {
    console.error('[push] chaves VAPID inválidas — push desativado:', e.message);
  }
}

export function getVapidPublicKey() { return webPushEnabled ? VAPID_PUBLIC_KEY : null; }

// ── Categorias e preferências ────────────────────────────────────────────────
// Categoria por tipo de evento. Toda categoria pode ser desligada pelo usuário
// (inclusive 'meta', que vem ligada por padrão por ser crítica).
export const PUSH_CATEGORIES = ['vendas', 'atendimento', 'meta', 'campanhas', 'documentos', 'automacoes'];
export const EVENT_CATEGORY = {
  sale_paid: 'vendas',
  handoff_requested: 'atendimento',
  meta_connection_critical: 'meta',
  campaign_finished: 'campanhas',
  document_processed: 'documentos',
  automation_notification: 'automacoes',
  conversao_falhando: 'meta',
  novo_lead_campanha: 'campanhas',
  meta_vendas_atingida: 'vendas',
};
const DEFAULT_PREFERENCES = {
  vendas: true,
  atendimento: true,
  meta: true,
  campanhas: true,
  documentos: true,
  automacoes: true,
};

export function getPushPreferences(tenantRow) {
  let stored = {};
  try { stored = JSON.parse(tenantRow?.push_preferences_json || '{}'); } catch { /* JSON inválido = padrão */ }
  const prefs = { ...DEFAULT_PREFERENCES };
  for (const key of PUSH_CATEGORIES) {
    if (typeof stored[key] === 'boolean') prefs[key] = stored[key];
  }
  return prefs;
}

export function setPushPreferences(tenantId, input) {
  const prefs = {};
  for (const key of PUSH_CATEGORIES) {
    if (typeof input?.[key] === 'boolean') prefs[key] = input[key];
  }
  tenantQueries.setPushPreferences.run({ id: tenantId, prefs: JSON.stringify(prefs) });
  return getPushPreferences({ push_preferences_json: JSON.stringify(prefs) });
}

// ── Assinaturas ──────────────────────────────────────────────────────────────
const MAX_ENDPOINT_LEN = 1000;
const MAX_KEY_LEN = 300;

/** Valida e salva uma assinatura. Lança Error com mensagem em pt-BR se inválida. */
export function saveSubscription(tenantId, body, userAgent) {
  const endpoint = String(body?.endpoint || '');
  const p256dh = String(body?.keys?.p256dh || '');
  const auth = String(body?.keys?.auth || '');
  let url;
  try { url = new URL(endpoint); } catch { url = null; }
  if (!url || url.protocol !== 'https:' || endpoint.length > MAX_ENDPOINT_LEN) {
    throw new Error('Assinatura de notificação inválida.');
  }
  if (!p256dh || !auth || p256dh.length > MAX_KEY_LEN || auth.length > MAX_KEY_LEN ||
      !/^[A-Za-z0-9_+/=-]+$/.test(p256dh) || !/^[A-Za-z0-9_+/=-]+$/.test(auth)) {
    throw new Error('Assinatura de notificação inválida.');
  }
  pushSubscriptionQueries.upsert.run({
    tenant_id: tenantId,
    endpoint,
    p256dh,
    auth,
    user_agent: String(userAgent || '').slice(0, 200) || null,
  });
  return { ok: true };
}

export function removeSubscription(tenantId, endpoint) {
  const info = pushSubscriptionQueries.deleteByEndpoint.run(String(endpoint || ''), tenantId);
  return { removed: info.changes > 0 };
}

// ── Deduplicação/cooldown ────────────────────────────────────────────────────
// Claim atômico: devolve true se este processo pode enviar (não houve envio da
// mesma chave dentro do cooldown), já registrando o claim.
const claimTx = db.transaction((tenantId, dedupeKey, cooldownMinutes) => {
  const row = pushDedupeQueries.get.get(tenantId, dedupeKey);
  if (row) {
    const sentMs = Date.parse(row.sent_at.replace(' ', 'T') + 'Z');
    if (Number.isFinite(sentMs) && Date.now() - sentMs < cooldownMinutes * 60_000) return false;
  }
  pushDedupeQueries.upsert.run(tenantId, dedupeKey);
  return true;
});

export function claimPushDedupe(tenantId, dedupeKey, cooldownMinutes) {
  try { return claimTx(tenantId, dedupeKey, cooldownMinutes); } catch { return false; }
}

/** Limpa dedupes por prefixo — usado quando um problema resolve (permite novo alerta). */
export function clearPushDedupe(tenantId, prefix) {
  try { pushDedupeQueries.deleteByPrefix.run(tenantId, `${prefix}%`); } catch { /* noop */ }
}

// ── Envio ────────────────────────────────────────────────────────────────────
const MAX_FAILURES_BEFORE_DISABLE = 5;

// sender injetável para testes. Default: web-push real com TTL de 1h.
let sender = (subscription, payload) =>
  webpush.sendNotification(subscription, payload, { TTL: 3600 });
export function _setSenderForTesting(fn) { sender = fn; }
export function _resetSenderForTesting() {
  sender = (subscription, payload) => webpush.sendNotification(subscription, payload, { TTL: 3600 });
}

/**
 * Envia um push de evento para todos os aparelhos ativos do tenant.
 * Respeita preferências, dedupe e cooldown. Nunca lança.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.event      chave de EVENT_CATEGORY (ex: 'sale_paid')
 * @param {string} opts.title      título curto SEM dados pessoais
 * @param {string} opts.body       texto curto SEM dados pessoais
 * @param {string} opts.url        rota interna do painel (ex: '/vendas.html?filter=pago')
 * @param {string} [opts.dedupeKey]        chave semântica p/ dedupe (default: event)
 * @param {number} [opts.cooldownMinutes]  janela do dedupe (default: 1 min p/ eventos, maior p/ alertas)
 * @returns {Promise<{sent:number, skipped?:string}>}
 */
export async function sendPushEvent({ tenantId, event, title, body, url, dedupeKey, cooldownMinutes = 1 }) {
  try {
    if (!webPushEnabled) return { sent: 0, skipped: 'disabled' };
    if (!tenantId || !event || !title) return { sent: 0, skipped: 'invalid' };

    const category = EVENT_CATEGORY[event];
    if (!category) return { sent: 0, skipped: 'unknown_event' };

    const tenantRow = tenantQueries.byId.get(tenantId);
    if (!tenantRow) return { sent: 0, skipped: 'tenant_not_found' };
    const prefs = getPushPreferences(tenantRow);
    if (!prefs[category]) return { sent: 0, skipped: 'preference_off' };

    const key = dedupeKey || event;
    if (!claimPushDedupe(tenantId, key, cooldownMinutes)) return { sent: 0, skipped: 'deduped' };

    const subs = pushSubscriptionQueries.listActiveByTenant.all(tenantId);
    if (!subs.length) return { sent: 0, skipped: 'no_subscriptions' };

    const payload = JSON.stringify({
      title: String(title).slice(0, 80),
      body: String(body || '').slice(0, 160),
      url: String(url || '/dashboard.html'),
      tag: key,
    });

    let sent = 0;
    for (const sub of subs) {
      const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      try {
        await sender(subscription, payload);
        pushSubscriptionQueries.markSuccess.run(sub.id);
        sent++;
      } catch (err) {
        const status = err?.statusCode || err?.status || null;
        if (status === 404 || status === 410) {
          // Endpoint morto (aparelho desinstalou/limpou) — desativa na hora.
          pushSubscriptionQueries.disableById.run(sub.id);
        } else {
          pushSubscriptionQueries.markFailure.run(sub.id);
          if ((sub.failure_count || 0) + 1 >= MAX_FAILURES_BEFORE_DISABLE) {
            pushSubscriptionQueries.disableById.run(sub.id);
          }
        }
      }
    }
    return { sent };
  } catch (e) {
    console.error('[push] envio falhou:', e.message);
    return { sent: 0, skipped: 'error' };
  }
}
