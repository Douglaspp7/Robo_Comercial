/**
 * Webhook genérico (compatível com Zapier "Catch Hook", Make, etc.) — o
 * lojista cola sua própria URL em Configurações e recebe eventos (venda
 * paga, novo contato, pedido de humano) assinados por HMAC.
 *
 * Sem fila/backoff completo: 1 retry (mesma filosofia de src/http.js —
 * fetchWithRetry é seguro aqui porque o Zapier "Catch Hook" tolera reentrega).
 * Falhas ficam em webhook_log para o lojista ver; um único aviso na Central
 * de Avisos é disparado ao cruzar 5 falhas consecutivas (circuit breaker),
 * não a cada evento — evita spam por um endpoint de terceiro instável.
 */
import { createHmac } from 'node:crypto';
import { fetchWithRetry } from './http.js';
import { webhookLogQueries, notificationQueries } from './db.js';

const FAILURE_NOTIFY_THRESHOLD = 5;

function sign(secret, body) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Conta falhas consecutivas mais recentes (para até na primeira entrega OK). */
function countConsecutiveFailures(tenantId) {
  const rows = webhookLogQueries.recentStatuses.all(tenantId, 20);
  let n = 0;
  for (const row of rows) {
    if (row.status !== 'falha') break;
    n++;
  }
  return n;
}

function maybeNotifyFailure(tenant) {
  if (countConsecutiveFailures(tenant.id) !== FAILURE_NOTIFY_THRESHOLD) return;
  notificationQueries.create.run({
    tenant_id: tenant.id,
    type: 'webhook_falhando',
    title: 'Seu webhook está falhando',
    message: `As últimas ${FAILURE_NOTIFY_THRESHOLD} tentativas de envio para ${tenant.webhook_url} falharam. Verifique a URL configurada em Configurações.`,
    contact_id: null,
  });
}

/**
 * Dispara um evento para o webhook configurado pelo tenant. Fire-and-forget
 * do ponto de vista de quem chama (sempre encadear com `.catch(() => {})`) —
 * nunca lança. No-op se webhook_url não estiver configurada ou webhook_enabled=0.
 * @param {object} tenant  tenant já decifrado (decryptTenant) — precisa de webhook_secret em claro.
 * @param {string} eventType  ex: 'sale.paid', 'contact.created', 'handoff.requested', 'test.ping'
 * @param {object} data  corpo específico do evento
 */
export async function dispatchWebhookEvent(tenant, eventType, data) {
  if (!tenant?.webhook_url || !tenant.webhook_enabled) return;

  const payload = {
    event: eventType,
    tenant_id: tenant.id,
    timestamp: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(payload);
  const { lastInsertRowid: logId } = webhookLogQueries.insert.run({
    tenant_id: tenant.id,
    event_type: eventType,
    payload_json: body,
  });

  const signature = tenant.webhook_secret ? sign(tenant.webhook_secret, body) : '';
  const headers = {
    'Content-Type': 'application/json',
    'X-Zapien-Event': eventType,
    'X-Zapien-Timestamp': payload.timestamp,
  };
  if (signature) headers['X-Zapien-Signature'] = `sha256=${signature}`;

  try {
    const res = await fetchWithRetry(tenant.webhook_url, { method: 'POST', headers, body }, {
      timeoutMs: 8000,
      retries: 1,
      baseDelayMs: 1000,
    });

    if (res.ok) {
      webhookLogQueries.markDelivered.run(res.status, logId);
    } else {
      webhookLogQueries.markFailed.run(res.status, `HTTP ${res.status}`, logId);
      maybeNotifyFailure(tenant);
    }
  } catch (err) {
    webhookLogQueries.markFailed.run(null, err.message, logId);
    maybeNotifyFailure(tenant);
  }
}
