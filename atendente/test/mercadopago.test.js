import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, getOrCreateContact, saleQueries } from '../src/db.js';
import { createPaymentLink } from '../src/mercadopago.js';

const origFetch = globalThis.fetch;

function mockMpPreference() {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ init_point: 'https://mp.example.com/checkout/123', id: 'pref-123' }),
    text: async () => '',
  });
}

function makeTenant(produtos) {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash, mp_access_token) VALUES (?, ?, 'h', 'fake-token')`)
    .run(id, `${id}@test.com`);
  db.prepare(`UPDATE tenants SET business_json = ? WHERE id = ?`).run(JSON.stringify({ produtos }), id);
  return tenantQueries.byId.get(id);
}

function produtosOf(tenantId) {
  const t = tenantQueries.byId.get(tenantId);
  return JSON.parse(t.business_json).produtos;
}

test('createPaymentLink cria a venda no banco (bug de contagem de parâmetros corrigido) e retorna o link', async () => {
  mockMpPreference();
  try {
    const t = makeTenant([{ nome: 'Perfume X', estoque_qtd: 5 }]);
    const c = getOrCreateContact(t.id, '5511922220001', 'Cliente MP');

    const { link, zeroedOut } = await createPaymentLink(t, c, {
      itens: [{ titulo: 'Perfume X', quantidade: 2, valor_unitario: 89.9 }],
    });

    assert.equal(link, 'https://mp.example.com/checkout/123');
    assert.deepEqual(zeroedOut, []);

    const sale = saleQueries.latestOpenByContact.get(c.id);
    assert.ok(sale, 'a venda deveria ter sido persistida no banco');
    assert.equal(sale.total_cents, 17980);
    assert.equal(JSON.parse(sale.items_json)[0].titulo, 'Perfume X');
    assert.equal(sale.stock_adjusted, 1);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('createPaymentLink desconta o estoque configurado e reporta produto zerado', async () => {
  mockMpPreference();
  try {
    const t = makeTenant([{ nome: 'Perfume X', estoque_qtd: 2 }]);
    const c = getOrCreateContact(t.id, '5511922220002', 'Cliente Zera Estoque');

    const { zeroedOut } = await createPaymentLink(t, c, {
      itens: [{ titulo: 'Perfume X', quantidade: 2, valor_unitario: 89.9 }],
    });

    assert.deepEqual(zeroedOut, ['Perfume X']);
    const produto = produtosOf(t.id).find((p) => p.nome === 'Perfume X');
    assert.equal(produto.estoque_qtd, 0);
    assert.equal(produto.esgotado, true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('createPaymentLink não desconta duas vezes ao reutilizar a mesma venda aberta', async () => {
  mockMpPreference();
  try {
    const t = makeTenant([{ nome: 'Perfume X', estoque_qtd: 10 }]);
    const c = getOrCreateContact(t.id, '5511922220003', 'Cliente Repete');
    const pedido = { itens: [{ titulo: 'Perfume X', quantidade: 3, valor_unitario: 89.9 }] };

    await createPaymentLink(t, c, pedido);
    await createPaymentLink(t, c, pedido); // mesmo pedido de novo (turno seguinte da IA)

    assert.equal(produtosOf(t.id).find((p) => p.nome === 'Perfume X').estoque_qtd, 7);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('createPaymentLink devolve o estoque reservado quando os itens do pedido mudam', async () => {
  mockMpPreference();
  try {
    const t = makeTenant([
      { nome: 'Perfume X', estoque_qtd: 5 },
      { nome: 'Perfume Y', estoque_qtd: 5 },
    ]);
    const c = getOrCreateContact(t.id, '5511922220004', 'Cliente Muda de Ideia');

    await createPaymentLink(t, c, { itens: [{ titulo: 'Perfume X', quantidade: 2, valor_unitario: 89.9 }] });
    assert.equal(produtosOf(t.id).find((p) => p.nome === 'Perfume X').estoque_qtd, 3);

    await createPaymentLink(t, c, { itens: [{ titulo: 'Perfume Y', quantidade: 1, valor_unitario: 79.9 }] });

    const produtos = produtosOf(t.id);
    assert.equal(produtos.find((p) => p.nome === 'Perfume X').estoque_qtd, 5, 'estoque do item trocado deve voltar ao normal');
    assert.equal(produtos.find((p) => p.nome === 'Perfume Y').estoque_qtd, 4);
  } finally {
    globalThis.fetch = origFetch;
  }
});
