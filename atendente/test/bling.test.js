import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, saleQueries, notificationQueries, blingProductMapQueries } from '../src/db.js';
import { encryptSecret } from '../src/crypto.js';
import { getValidBlingToken, pushOrderToBling, buildBlingPedidoPayload } from '../src/bling.js';

const origFetch = globalThis.fetch;

function makeTenant({ expiresInMs = 60 * 60 * 1000 } = {}) {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(id, `${id}@test.com`);
  db.prepare(`UPDATE tenants SET bling_access_token = ?, bling_refresh_token = ?, bling_token_expires_at = ? WHERE id = ?`)
    .run(
      encryptSecret('access-token-atual'),
      encryptSecret('refresh-token-atual'),
      new Date(Date.now() + expiresInMs).toISOString(),
      id
    );
  const raw = tenantQueries.byId.get(id);
  return { ...raw, bling_access_token: 'access-token-atual', bling_refresh_token: 'refresh-token-atual' };
}

function makeSale(tenantId, { paid = true, items = [{ titulo: 'Produto A', quantidade: 2, valor_unitario: 50 }] } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO sales (id, tenant_id, status, items_json, total_cents)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, tenantId, paid ? 'pago' : 'rascunho', JSON.stringify(items), 10000);
  return saleQueries.byId.get(id);
}

test('getValidBlingToken retorna o token existente sem renovar quando ainda está longe de expirar', async () => {
  const t = makeTenant({ expiresInMs: 60 * 60 * 1000 }); // 1h no futuro
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };
  try {
    const token = await getValidBlingToken(t);
    assert.equal(token, 'access-token-atual');
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('getValidBlingToken renova quando o token está perto de expirar e persiste o novo par', async () => {
  const t = makeTenant({ expiresInMs: 60 * 1000 }); // 1 min — dentro da margem de 5 min
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ access_token: 'novo-access', refresh_token: 'novo-refresh', expires_in: 21600 }),
  });
  try {
    const token = await getValidBlingToken(t);
    assert.equal(token, 'novo-access');

    const raw = tenantQueries.byId.get(t.id);
    const { decryptSecret } = await import('../src/crypto.js');
    assert.equal(decryptSecret(raw.bling_access_token), 'novo-access');
    assert.equal(decryptSecret(raw.bling_refresh_token), 'novo-refresh');
    assert.ok(new Date(raw.bling_token_expires_at).getTime() > Date.now());
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('getValidBlingToken limpa credenciais e notifica o lojista se o refresh for rejeitado', async () => {
  const t = makeTenant({ expiresInMs: -1000 }); // já expirado
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: 'invalid_grant', error_description: 'refresh token expirado' }),
  });
  try {
    await assert.rejects(getValidBlingToken(t));

    const raw = tenantQueries.byId.get(t.id);
    assert.equal(raw.bling_access_token, null);
    assert.equal(raw.bling_refresh_token, null);

    const notifs = notificationQueries.listByTenant.all(t.id).filter((n) => n.type === 'bling_desconectado');
    assert.equal(notifs.length, 1);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('pushOrderToBling é idempotente — não envia de novo se bling_pedido_id já estiver setado', async () => {
  const t = makeTenant();
  const sale = makeSale(t.id);
  db.prepare(`UPDATE sales SET bling_pedido_id = 'ja-enviado-123' WHERE id = ?`).run(sale.id);
  const saleWithId = saleQueries.byId.get(sale.id);

  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };
  try {
    await pushOrderToBling(t, saleWithId);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('pushOrderToBling envia o pedido com codigo e marca bling_pedido_id no sucesso', async () => {
  const t = makeTenant();
  const sale = makeSale(t.id, { items: [{ titulo: 'Produto A', codigo: 'SKU-123', quantidade: 2, valor_unitario: 50 }] });
  let posted;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/pedidos/vendas')) {
      posted = JSON.parse(options.body);
      return { ok: true, json: async () => ({ data: { id: 999 } }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  try {
    await pushOrderToBling(t, sale);
    assert.equal(posted.itens[0].codigo, 'SKU-123');
    assert.equal(posted.itens[0].descricao, 'Produto A');
    assert.equal(posted.itens[0].quantidade, 2);

    const updated = saleQueries.byId.get(sale.id);
    assert.equal(updated.bling_pedido_id, '999');
    assert.equal(updated.bling_push_status, 'enviado');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('pushOrderToBling nunca lança — registra o erro em bling_push_error na falha', async () => {
  const t = makeTenant();
  const sale = makeSale(t.id);
  globalThis.fetch = async () => ({ ok: false, status: 422, json: async () => ({ error: { description: 'item inválido' } }) });
  try {
    await assert.doesNotReject(pushOrderToBling(t, sale));
    const updated = saleQueries.byId.get(sale.id);
    assert.equal(updated.bling_push_status, 'erro');
    assert.ok(updated.bling_push_error.includes('item inválido'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('buildBlingPedidoPayload usa o codigo do próprio item quando disponível', () => {
  const sale = {
    id: 'sale-1',
    items_json: JSON.stringify([{ titulo: 'Perfume Alfa', quantidade: 1, valor_unitario: 100, codigo: 'ALFA-001' }]),
  };
  const payload = buildBlingPedidoPayload(sale);
  assert.equal(payload.itens.length, 1);
  assert.equal(payload.itens[0].codigo, 'ALFA-001');
  assert.equal(payload.itens[0].descricao, 'Perfume Alfa');
});

test('buildBlingPedidoPayload usa o mapa bling_product_map quando o item não tem codigo', () => {
  const t = makeTenant();
  // Sync anterior populou o mapa: "Perfume Beta" ↔ ALFA-BETA-002.
  blingProductMapQueries.upsert.run({
    tenant_id: t.id,
    produto_nome: 'Perfume Beta',
    produto_codigo: 'BETA-002',
    bling_produto_id: '9001',
    bling_sku: 'BETA-002',
    product_id: null,
  });

  const sale = {
    id: 'sale-2',
    // Item vendido sem codigo — só titulo (fluxo comum, item vem do catálogo).
    items_json: JSON.stringify([{ titulo: 'Perfume Beta', quantidade: 2, valor_unitario: 80 }]),
  };
  const payload = buildBlingPedidoPayload(sale, t.id);
  assert.equal(payload.itens[0].codigo, 'BETA-002', 'preenche codigo do mapa');
  assert.equal(payload.itens[0].quantidade, 2);
});

test('buildBlingPedidoPayload sem codigo e sem entrada no mapa: envia sem codigo (fallback)', () => {
  const t = makeTenant();
  // Nenhuma entrada no mapa para "Perfume Gamma".
  const sale = {
    id: 'sale-3',
    items_json: JSON.stringify([{ titulo: 'Perfume Gamma', quantidade: 1, valor_unitario: 50 }]),
  };
  const payload = buildBlingPedidoPayload(sale, t.id);
  assert.equal(payload.itens[0].codigo, undefined, 'não inventa codigo');
  assert.equal(payload.itens[0].descricao, 'Perfume Gamma');
});
