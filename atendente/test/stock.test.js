import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, getOrCreateContact, saleQueries } from '../src/db.js';
import { normalizeBusiness } from '../src/business.js';
import { deductStockForSale, restoreStockForSale } from '../src/stock.js';

function makeTenant(produtos) {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(id, `${id}@test.com`);
  db.prepare(`UPDATE tenants SET business_json = ? WHERE id = ?`).run(JSON.stringify({ produtos }), id);
  return tenantQueries.byId.get(id);
}

function makeSale(tenantId, contactId, items) {
  const id = randomUUID();
  saleQueries.create.run({
    id, tenant_id: tenantId, contact_id: contactId, status: 'checkout_enviado',
    items_json: JSON.stringify(items), total_cents: 0, checkout_url: '', payment_provider: '',
    external_payment_id: '', notes: '',
  });
  return saleQueries.byId.get(id);
}

function produtosOf(tenantId) {
  const t = tenantQueries.byId.get(tenantId);
  return normalizeBusiness(t.business_json).produtos;
}

test('deductStockForSale desconta a quantidade vendida do produto controlado', () => {
  const t = makeTenant([{ nome: 'Perfume X', estoque_qtd: 10 }]);
  const c = getOrCreateContact(t.id, '5511977710001', 'Cliente');
  const sale = makeSale(t.id, c.id, [{ titulo: 'Perfume X', quantidade: 3, valor_unitario: 50 }]);

  const zeroed = deductStockForSale(t.id, sale);
  assert.deepEqual(zeroed, []);
  assert.equal(produtosOf(t.id).find((p) => p.nome === 'Perfume X').estoque_qtd, 7);
});

test('deductStockForSale marca stock_adjusted e não desconta de novo se chamado outra vez', () => {
  const t = makeTenant([{ nome: 'Perfume X', estoque_qtd: 10 }]);
  const c = getOrCreateContact(t.id, '5511977710002', 'Cliente');
  const sale = makeSale(t.id, c.id, [{ titulo: 'Perfume X', quantidade: 3, valor_unitario: 50 }]);

  deductStockForSale(t.id, sale);
  const saleAfter = saleQueries.byId.get(sale.id);
  assert.equal(saleAfter.stock_adjusted, 1);

  deductStockForSale(t.id, saleAfter); // idempotente
  assert.equal(produtosOf(t.id).find((p) => p.nome === 'Perfume X').estoque_qtd, 7);
});

test('deductStockForSale retorna o produto que zerou e marca esgotado', () => {
  const t = makeTenant([{ nome: 'Perfume X', estoque_qtd: 2 }]);
  const c = getOrCreateContact(t.id, '5511977710003', 'Cliente');
  const sale = makeSale(t.id, c.id, [{ titulo: 'Perfume X', quantidade: 2, valor_unitario: 50 }]);

  const zeroed = deductStockForSale(t.id, sale);
  assert.deepEqual(zeroed, ['Perfume X']);
  const produto = produtosOf(t.id).find((p) => p.nome === 'Perfume X');
  assert.equal(produto.estoque_qtd, 0);
  assert.equal(produto.esgotado, true);
});

test('deductStockForSale não deixa estoque negativo (venda maior que o disponível)', () => {
  const t = makeTenant([{ nome: 'Perfume X', estoque_qtd: 1 }]);
  const c = getOrCreateContact(t.id, '5511977710004', 'Cliente');
  const sale = makeSale(t.id, c.id, [{ titulo: 'Perfume X', quantidade: 5, valor_unitario: 50 }]);

  deductStockForSale(t.id, sale);
  assert.equal(produtosOf(t.id).find((p) => p.nome === 'Perfume X').estoque_qtd, 0);
});

test('deductStockForSale ignora produto sem estoque_qtd configurado', () => {
  const t = makeTenant([{ nome: 'Serviço Y', preco: 'sob consulta' }]);
  const c = getOrCreateContact(t.id, '5511977710005', 'Cliente');
  const sale = makeSale(t.id, c.id, [{ titulo: 'Serviço Y', quantidade: 1, valor_unitario: 50 }]);

  const zeroed = deductStockForSale(t.id, sale);
  assert.deepEqual(zeroed, []);
  assert.equal(produtosOf(t.id).find((p) => p.nome === 'Serviço Y').estoque_qtd, undefined);
});

test('deductStockForSale trata estoque_qtd como string vazia (form) igual a "não controlado" — não confunde com zero', () => {
  const t = makeTenant([{ nome: 'Serviço Y', preco: 'sob consulta', estoque_qtd: '' }]);
  const c = getOrCreateContact(t.id, '5511977710008', 'Cliente');
  const sale = makeSale(t.id, c.id, [{ titulo: 'Serviço Y', quantidade: 1, valor_unitario: 50 }]);

  const zeroed = deductStockForSale(t.id, sale);
  assert.deepEqual(zeroed, [], 'não deveria marcar como esgotado um produto não controlado');
  const produto = produtosOf(t.id).find((p) => p.nome === 'Serviço Y');
  assert.equal(produto.esgotado, undefined);
});

test('restoreStockForSale devolve a quantidade e reabre o produto esgotado', () => {
  const t = makeTenant([{ nome: 'Perfume X', estoque_qtd: 2 }]);
  const c = getOrCreateContact(t.id, '5511977710006', 'Cliente');
  const sale = makeSale(t.id, c.id, [{ titulo: 'Perfume X', quantidade: 2, valor_unitario: 50 }]);

  deductStockForSale(t.id, sale);
  assert.equal(produtosOf(t.id).find((p) => p.nome === 'Perfume X').esgotado, true);

  restoreStockForSale(t.id, saleQueries.byId.get(sale.id));
  const produto = produtosOf(t.id).find((p) => p.nome === 'Perfume X');
  assert.equal(produto.estoque_qtd, 2);
  assert.equal(produto.esgotado, false);
  assert.equal(saleQueries.byId.get(sale.id).stock_adjusted, 0);
});

test('restoreStockForSale não age se a venda nunca teve estoque descontado', () => {
  const t = makeTenant([{ nome: 'Perfume X', estoque_qtd: 5 }]);
  const c = getOrCreateContact(t.id, '5511977710007', 'Cliente');
  const sale = makeSale(t.id, c.id, [{ titulo: 'Perfume X', quantidade: 2, valor_unitario: 50 }]);

  restoreStockForSale(t.id, sale); // stock_adjusted ainda é 0
  assert.equal(produtosOf(t.id).find((p) => p.nome === 'Perfume X').estoque_qtd, 5);
});
