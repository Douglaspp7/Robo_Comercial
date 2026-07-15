/**
 * Testes do product_id permanente:
 *  - unidade: ensureProductIds (idempotência, imutabilidade, unicidade);
 *  - integração: saveBusinessJson (persistência com backfill automático);
 *  - integração: renomear/duplicar/excluir produtos;
 *  - integração: mapeamentos Bling/Nuvemshop guardam product_id.
 */
import './_setup.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  db,
  tenantQueries,
  saveBusinessJson,
  blingProductMapQueries,
  nuvemshopProductMapQueries,
} from '../src/db.js';
import { ensureProductIds, newProductId, findProduct, backfillProductIdForMapping } from '../src/products.js';
import { normalizeBusiness } from '../src/business.js';
import { hashPassword } from '../src/auth.js';

function makeTenant(biz = {}) {
  const id = 't_' + randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO tenants (id, email, password_hash, business_name, business_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, `${id}@t.com`, hashPassword('x'), 'Loja', JSON.stringify(biz));
  return id;
}

function reloadBiz(tenantId) {
  const row = tenantQueries.byId.get(tenantId);
  return JSON.parse(row.business_json || '{}');
}

beforeEach(() => {
  db.exec(`DELETE FROM bling_product_map; DELETE FROM nuvemshop_product_map;`);
});

test('newProductId gera prefixo prod_ e 32 hex', () => {
  const id = newProductId();
  assert.match(id, /^prod_[0-9a-f]{32}$/);
});

test('ensureProductIds atribui IDs apenas para produtos sem product_id', () => {
  const produtos = [
    { nome: 'A' },
    { product_id: 'prod_existing', nome: 'B' },
    { nome: 'C' },
  ];
  const { produtos: out, changed } = ensureProductIds(produtos);
  assert.equal(changed, true);
  assert.match(out[0].product_id, /^prod_/);
  assert.equal(out[1].product_id, 'prod_existing');
  assert.match(out[2].product_id, /^prod_/);
  // IDs únicos
  const set = new Set(out.map((p) => p.product_id));
  assert.equal(set.size, 3);
});

test('ensureProductIds é idempotente: chamada 2x não altera changed=false na segunda', () => {
  const produtos = [{ nome: 'A' }, { nome: 'B' }];
  const step1 = ensureProductIds(produtos);
  assert.equal(step1.changed, true);
  const step2 = ensureProductIds(step1.produtos);
  assert.equal(step2.changed, false);
  assert.equal(step2.produtos[0].product_id, step1.produtos[0].product_id);
  assert.equal(step2.produtos[1].product_id, step1.produtos[1].product_id);
});

test('ensureProductIds preserva ordem, nome, preço', () => {
  const produtos = [
    { nome: 'X', preco: 1090, estoque_qtd: 5 },
    { nome: 'Y', preco: 2500 },
  ];
  const { produtos: out } = ensureProductIds(produtos);
  assert.equal(out[0].nome, 'X');
  assert.equal(out[0].preco, 1090);
  assert.equal(out[0].estoque_qtd, 5);
  assert.equal(out[1].nome, 'Y');
});

test('normalizeBusiness NÃO gera product_id (só migração persistida faz isso)', () => {
  const biz = normalizeBusiness({ produtos: [{ nome: 'Sem ID' }] });
  assert.equal(biz.produtos[0].product_id, undefined);
});

test('saveBusinessJson persiste com product_id sempre presente', () => {
  const tenant = makeTenant({ produtos: [{ nome: 'Novo' }] });
  const biz = normalizeBusiness(reloadBiz(tenant));
  saveBusinessJson(tenant, biz);
  const after = reloadBiz(tenant);
  assert.match(after.produtos[0].product_id, /^prod_/);
});

test('renomear produto mantém product_id', () => {
  const tenant = makeTenant({});
  const biz = normalizeBusiness({ produtos: [{ nome: 'Antigo' }] });
  saveBusinessJson(tenant, biz);
  const stored = reloadBiz(tenant);
  const originalId = stored.produtos[0].product_id;
  // Simula edição de nome (o product_id fica intacto no objeto)
  stored.produtos[0].nome = 'Novo Nome';
  saveBusinessJson(tenant, stored);
  const after = reloadBiz(tenant);
  assert.equal(after.produtos[0].nome, 'Novo Nome');
  assert.equal(after.produtos[0].product_id, originalId);
});

test('duplicar produto (cópia sem product_id) gera novo ID', () => {
  const tenant = makeTenant({});
  saveBusinessJson(tenant, { produtos: [{ nome: 'Original' }] });
  const stored = reloadBiz(tenant);
  const original = stored.produtos[0];
  // Duplicação: cria outro produto sem product_id (frontend clonaria sem o ID)
  const clone = { nome: 'Original (cópia)', preco: original.preco };
  stored.produtos.push(clone);
  saveBusinessJson(tenant, stored);
  const after = reloadBiz(tenant);
  assert.equal(after.produtos.length, 2);
  assert.notEqual(after.produtos[0].product_id, after.produtos[1].product_id);
});

test('findProduct prefere product_id, mas cai pra nome como fallback', () => {
  const produtos = [
    { product_id: 'prod_a', nome: 'Alfa' },
    { product_id: 'prod_b', nome: 'Beta' },
  ];
  assert.equal(findProduct(produtos, { product_id: 'prod_b' })?.nome, 'Beta');
  assert.equal(findProduct(produtos, { nome: 'Alfa' })?.product_id, 'prod_a');
  assert.equal(findProduct(produtos, { nome: 'não existe' }), undefined);
});

test('backfillProductIdForMapping resolve por SKU quando único', () => {
  const produtos = [
    { product_id: 'prod_a', nome: 'A', sku: 'DIF-LAV' },
    { product_id: 'prod_b', nome: 'B', sku: 'DIF-MEN' },
  ];
  assert.equal(
    backfillProductIdForMapping(produtos, { external_sku: 'DIF-LAV' }),
    'prod_a',
  );
});

test('backfillProductIdForMapping resolve por nome exato', () => {
  const produtos = [
    { product_id: 'prod_a', nome: 'Difusor Lavanda' },
    { product_id: 'prod_b', nome: 'Difusor Menta' },
  ];
  assert.equal(
    backfillProductIdForMapping(produtos, { produto_nome: 'Difusor Lavanda' }),
    'prod_a',
  );
});

test('backfillProductIdForMapping devolve undefined em ambiguidade de SKU', () => {
  const produtos = [
    { product_id: 'prod_a', nome: 'A', sku: 'X' },
    { product_id: 'prod_b', nome: 'B', sku: 'X' },
  ];
  assert.equal(
    backfillProductIdForMapping(produtos, { external_sku: 'X' }),
    undefined,
  );
});

test('mapeamento Bling grava product_id e permite lookup por product_id', () => {
  const tenant = makeTenant({});
  saveBusinessJson(tenant, { produtos: [{ nome: 'Produto A', sku: 'SKU-A' }] });
  const stored = reloadBiz(tenant);
  const pid = stored.produtos[0].product_id;
  blingProductMapQueries.upsert.run({
    tenant_id: tenant,
    produto_nome: 'Produto A',
    produto_codigo: 'SKU-A',
    bling_produto_id: 'bling-123',
    bling_sku: 'SKU-A',
    product_id: pid,
  });
  const found = blingProductMapQueries.byTenantAndProductId.get(tenant, pid);
  assert.ok(found, 'lookup por product_id deve encontrar');
  assert.equal(found.bling_produto_id, 'bling-123');
});

test('mapeamento Nuvemshop grava product_id e faz lookup', () => {
  const tenant = makeTenant({});
  saveBusinessJson(tenant, { produtos: [{ nome: 'Produto N' }] });
  const stored = reloadBiz(tenant);
  const pid = stored.produtos[0].product_id;
  nuvemshopProductMapQueries.upsert.run({
    tenant_id: tenant,
    produto_nome: 'Produto N',
    nuvemshop_produto_id: 'ns-1',
    nuvemshop_sku: null,
    product_id: pid,
  });
  const found = nuvemshopProductMapQueries.byTenantAndProductId.get(tenant, pid);
  assert.ok(found);
  assert.equal(found.nuvemshop_produto_id, 'ns-1');
});

test('renomear produto NÃO quebra vínculo Bling porque o mapping usa product_id', () => {
  const tenant = makeTenant({});
  saveBusinessJson(tenant, { produtos: [{ nome: 'Nome Original', sku: 'K1' }] });
  const stored = reloadBiz(tenant);
  const pid = stored.produtos[0].product_id;
  blingProductMapQueries.upsert.run({
    tenant_id: tenant,
    produto_nome: 'Nome Original',
    produto_codigo: 'K1',
    bling_produto_id: 'b-9',
    bling_sku: 'K1',
    product_id: pid,
  });
  // Renomeio no Zapien
  stored.produtos[0].nome = 'Nome Renomeado';
  saveBusinessJson(tenant, stored);
  // Lookup por product_id continua funcionando
  const map = blingProductMapQueries.byTenantAndProductId.get(tenant, pid);
  assert.ok(map);
  assert.equal(map.bling_produto_id, 'b-9');
});

test('isolamento entre tenants: product_id de um tenant não vaza para outro', () => {
  const a = makeTenant({});
  const b = makeTenant({});
  saveBusinessJson(a, { produtos: [{ nome: 'Só A' }] });
  saveBusinessJson(b, { produtos: [{ nome: 'Só B' }] });
  const aStored = reloadBiz(a);
  const pidA = aStored.produtos[0].product_id;
  const bStored = reloadBiz(b);
  const pidB = bStored.produtos[0].product_id;
  assert.notEqual(pidA, pidB);
  // Lookup direto respeita tenant
  blingProductMapQueries.upsert.run({
    tenant_id: a, produto_nome: 'Só A', produto_codigo: null,
    bling_produto_id: 'x', bling_sku: null, product_id: pidA,
  });
  assert.ok(blingProductMapQueries.byTenantAndProductId.get(a, pidA));
  assert.equal(blingProductMapQueries.byTenantAndProductId.get(b, pidA), undefined);
});
