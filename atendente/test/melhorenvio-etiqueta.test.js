/**
 * Fluxo de geração de etiqueta do Melhor Envio (src/melhorenvio.js).
 *
 * O orquestrador encadeia cart → checkout → print. Cada passo pode
 * falhar de forma diferente (crédito insuficiente, endereço inválido,
 * escopo OAuth faltando). Estes testes cobrem caminho feliz + as três
 * modalidades de falha (parada em cart / checkout / print) e verificam
 * que o resultado é persistido corretamente na sale.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, saleQueries } from '../src/db.js';
import { generateLabel, addToCart, checkoutCart, printLabel } from '../src/melhorenvio.js';

const origFetch = globalThis.fetch;

function makeSale() {
  const tenantId = randomUUID();
  const saleId = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(tenantId, `${tenantId}@me-test.com`);
  db.prepare(`INSERT INTO sales (id, tenant_id, status, items_json, total_cents) VALUES (?, ?, ?, ?, ?)`)
    .run(saleId, tenantId, 'pago', JSON.stringify([{ titulo: 'X', quantidade: 1, valor_unitario: 30 }]), 3000);
  return saleQueries.byId.get(saleId);
}

const dummyLabelData = {
  serviceId: 1,
  from: { name: 'Loja', postal_code: '01001000', country_id: 'BR' },
  to: { name: 'Cliente', postal_code: '20040020', country_id: 'BR' },
  products: [{ name: 'X', quantity: 1, unitary_value: 30 }],
  volumes: { height: 10, width: 15, length: 20, weight: 0.5 },
};

test('generateLabel: caminho feliz — cart, checkout e print sucedem, sale ganha me_order_id/tracking/label_url', async () => {
  const sale = makeSale();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: options?.body ? JSON.parse(options.body) : null });
    if (String(url).endsWith('/me/cart'))              return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'ord-777', protocol: 'ZP-777' }) };
    if (String(url).endsWith('/me/shipment/checkout')) return { ok: true, status: 200, text: async () => JSON.stringify({ purchase: { id: 'p-1', orders: [{ id: 'ord-777', status: 'paid' }] } }) };
    if (String(url).endsWith('/me/shipment/print'))    return { ok: true, status: 200, text: async () => JSON.stringify({ url: 'https://melhorenvio.com.br/etiqueta/ord-777.pdf' }) };
    throw new Error('URL não esperada: ' + url);
  };
  try {
    const result = await generateLabel('token-fake', sale, dummyLabelData);
    assert.equal(result.ok, true);
    assert.equal(result.orderId, 'ord-777');
    assert.equal(result.labelUrl, 'https://melhorenvio.com.br/etiqueta/ord-777.pdf');
    assert.equal(result.tracking, 'ord-777'); // provisório — atualiza pelo worker de rastreio depois

    // Persistiu na sale
    const updated = saleQueries.byId.get(sale.id);
    assert.equal(updated.me_order_id, 'ord-777');
    assert.equal(updated.me_tracking_code, 'ord-777');
    assert.equal(updated.me_label_url, 'https://melhorenvio.com.br/etiqueta/ord-777.pdf');
    assert.equal(updated.me_label_status, 'gerada');
    assert.equal(updated.me_label_error, null);

    // Fez as 3 chamadas na ordem
    assert.equal(calls.length, 3);
    assert.ok(calls[0].url.endsWith('/me/cart'));
    assert.ok(calls[1].url.endsWith('/me/shipment/checkout'));
    assert.ok(calls[2].url.endsWith('/me/shipment/print'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('generateLabel: falha no cart (endereço inválido) → grava me_label_error, não chega no checkout', async () => {
  const sale = makeSale();
  let checkoutCalled = false;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/me/cart'))              return { ok: false, status: 422, text: async () => JSON.stringify({ message: 'CEP de destino inválido' }) };
    if (String(url).endsWith('/me/shipment/checkout')) { checkoutCalled = true; return { ok: true, status: 200, text: async () => '{}' }; }
    throw new Error('URL não esperada: ' + url);
  };
  try {
    const result = await generateLabel('token-fake', sale, dummyLabelData);
    assert.equal(result.ok, false);
    assert.equal(result.step, 'cart');
    assert.match(result.error, /CEP de destino inválido/);
    assert.equal(checkoutCalled, false, 'não deve tentar pagar se o carrinho falhou');

    const updated = saleQueries.byId.get(sale.id);
    assert.equal(updated.me_label_status, 'erro');
    assert.match(updated.me_label_error, /CEP de destino inválido/);
    assert.equal(updated.me_order_id, null, 'orderId permanece nulo quando cart falha');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('generateLabel: falha no checkout (saldo insuficiente) → grava erro E devolve orderId (carrinho fica no ME)', async () => {
  const sale = makeSale();
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/me/cart'))              return { ok: true,  status: 200, text: async () => JSON.stringify({ id: 'ord-abc', protocol: 'ZP-abc' }) };
    if (String(url).endsWith('/me/shipment/checkout')) return { ok: false, status: 402, text: async () => JSON.stringify({ message: 'Saldo insuficiente na sua conta Melhor Envio' }) };
    throw new Error('URL não esperada: ' + url);
  };
  try {
    const result = await generateLabel('token-fake', sale, dummyLabelData);
    assert.equal(result.ok, false);
    assert.equal(result.step, 'checkout');
    assert.equal(result.orderId, 'ord-abc');
    assert.match(result.error, /Saldo insuficiente/);

    const updated = saleQueries.byId.get(sale.id);
    assert.equal(updated.me_label_status, 'erro');
    assert.match(updated.me_label_error, /Saldo insuficiente/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('generateLabel: cart+checkout OK, mas print falha → grava erro E o orderId (etiqueta comprada, PDF regerado depois)', async () => {
  const sale = makeSale();
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/me/cart'))              return { ok: true,  status: 200, text: async () => JSON.stringify({ id: 'ord-xyz' }) };
    if (String(url).endsWith('/me/shipment/checkout')) return { ok: true,  status: 200, text: async () => JSON.stringify({ purchase: { orders: [{ id: 'ord-xyz' }] } }) };
    if (String(url).endsWith('/me/shipment/print'))    return { ok: false, status: 500, text: async () => JSON.stringify({ message: 'PDF temporariamente indisponível' }) };
    throw new Error('URL não esperada: ' + url);
  };
  try {
    const result = await generateLabel('token-fake', sale, dummyLabelData);
    assert.equal(result.ok, false);
    assert.equal(result.step, 'print');
    assert.equal(result.orderId, 'ord-xyz', 'expõe orderId para o front oferecer "regerar PDF" ou consultar no ME');
    assert.match(result.error, /PDF temporariamente/);

    const updated = saleQueries.byId.get(sale.id);
    assert.equal(updated.me_label_status, 'erro');
    // Nesta modalidade a compra já foi debitada — o front precisa ver o erro
    // e oferecer retry só do print, não repetir cart+checkout.
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('addToCart: monta body com service, from, to, products, volumes e options padrão', async () => {
  let posted = null;
  globalThis.fetch = async (_url, options) => {
    posted = JSON.parse(options.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'ord-1' }) };
  };
  try {
    const out = await addToCart('token-fake', {
      serviceId: 2,
      from: { name: 'A' }, to: { name: 'B' },
      products: [{ name: 'P', quantity: 1, unitary_value: 10 }],
      volumes: { height: 5, width: 5, length: 5, weight: 0.3 },
    });
    assert.equal(out.id, 'ord-1');
    assert.equal(posted.service, 2);
    assert.deepEqual(posted.volumes, [{ height: 5, width: 5, length: 5, weight: 0.3 }]);
    assert.equal(posted.options.non_commercial, true, 'default: sem NF avulsa');
    assert.equal(posted.options.own_hand, false);
    assert.equal(posted.options.receipt, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('checkoutCart e printLabel: cada um chama o endpoint certo com o orderIds no corpo', async () => {
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push({ url: String(url), body: JSON.parse(options.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ purchase: {}, url: 'x' }) };
  };
  try {
    await checkoutCart('t', ['a', 'b']);
    await printLabel('t', ['a']);
    assert.equal(seen.length, 2);
    assert.ok(seen[0].url.endsWith('/me/shipment/checkout'));
    assert.deepEqual(seen[0].body.orders, ['a', 'b']);
    assert.ok(seen[1].url.endsWith('/me/shipment/print'));
    assert.equal(seen[1].body.mode, 'private');
    assert.deepEqual(seen[1].body.orders, ['a']);
  } finally {
    globalThis.fetch = origFetch;
  }
});
