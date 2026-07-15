import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { db, tenantQueries, webhookLogQueries, notificationQueries } from '../src/db.js';
import { dispatchWebhookEvent } from '../src/webhook-dispatch.js';

const origFetch = globalThis.fetch;

function makeTenant({ webhook_url = 'https://hooks.example.com/catch/1', webhook_secret = 'segredo-teste', webhook_enabled = 1 } = {}) {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(id, `${id}@test.com`);
  db.prepare(`UPDATE tenants SET webhook_url = ?, webhook_secret = ?, webhook_enabled = ? WHERE id = ?`)
    .run(webhook_url, webhook_secret, webhook_enabled, id);
  return tenantQueries.byId.get(id);
}

test('dispatchWebhookEvent não faz nada se webhook_url não configurada', async () => {
  const t = makeTenant({ webhook_url: '' });
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, status: 200 }; };
  try {
    await dispatchWebhookEvent(t, 'test.ping', { a: 1 });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('dispatchWebhookEvent não faz nada se webhook_enabled=0', async () => {
  const t = makeTenant({ webhook_enabled: 0 });
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, status: 200 }; };
  try {
    await dispatchWebhookEvent(t, 'test.ping', { a: 1 });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('dispatchWebhookEvent assina o payload com HMAC-SHA256 do webhook_secret e registra sucesso', async () => {
  const t = makeTenant();
  let receivedHeaders, receivedBody;
  globalThis.fetch = async (url, options) => {
    receivedHeaders = options.headers;
    receivedBody = options.body;
    return { ok: true, status: 200 };
  };
  try {
    await dispatchWebhookEvent(t, 'sale.paid', { sale_id: 'abc' });

    const expectedSig = createHmac('sha256', 'segredo-teste').update(receivedBody).digest('hex');
    assert.equal(receivedHeaders['X-Zapien-Signature'], `sha256=${expectedSig}`);
    assert.equal(receivedHeaders['X-Zapien-Event'], 'sale.paid');
    assert.ok(receivedHeaders['X-Zapien-Timestamp']);

    const payload = JSON.parse(receivedBody);
    assert.equal(payload.event, 'sale.paid');
    assert.equal(payload.tenant_id, t.id);
    assert.equal(payload.data.sale_id, 'abc');

    const log = webhookLogQueries.recentByTenant.all(t.id)[0];
    assert.equal(log.status, 'sucesso');
    assert.equal(log.http_status, 200);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('dispatchWebhookEvent registra falha quando o destino responde erro', async () => {
  const t = makeTenant();
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  try {
    await dispatchWebhookEvent(t, 'sale.paid', { sale_id: 'xyz' });
    const log = webhookLogQueries.recentByTenant.all(t.id)[0];
    assert.equal(log.status, 'falha');
    assert.equal(log.http_status, 500);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('dispatchWebhookEvent registra falha em erro de rede (sem exceção pro chamador)', async () => {
  const t = makeTenant();
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    await assert.doesNotReject(dispatchWebhookEvent(t, 'sale.paid', {}));
    const log = webhookLogQueries.recentByTenant.all(t.id)[0];
    assert.equal(log.status, 'falha');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('dispatchWebhookEvent avisa o lojista (Central de Avisos) só ao cruzar 5 falhas consecutivas', async () => {
  const t = makeTenant();
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  try {
    for (let i = 0; i < 4; i++) {
      await dispatchWebhookEvent(t, 'sale.paid', {});
    }
    let notifs = notificationQueries.listByTenant.all(t.id).filter((n) => n.type === 'webhook_falhando');
    assert.equal(notifs.length, 0, 'não deve avisar antes de 5 falhas seguidas');

    await dispatchWebhookEvent(t, 'sale.paid', {}); // 5ª falha consecutiva
    notifs = notificationQueries.listByTenant.all(t.id).filter((n) => n.type === 'webhook_falhando');
    assert.equal(notifs.length, 1);

    await dispatchWebhookEvent(t, 'sale.paid', {}); // 6ª falha — não deve duplicar o aviso
    notifs = notificationQueries.listByTenant.all(t.id).filter((n) => n.type === 'webhook_falhando');
    assert.equal(notifs.length, 1);
  } finally {
    globalThis.fetch = origFetch;
  }
});
