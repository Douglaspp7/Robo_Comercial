import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, getOrCreateContact, productWaitlistQueries } from '../src/db.js';

function makeTenant() {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(id, `${id}@test.com`);
  return tenantQueries.byId.get(id);
}

test('productWaitlistQueries.add insere e existsActive detecta duplicidade', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511944440001', 'Cliente Espera');
  assert.equal(productWaitlistQueries.existsActive.get(t.id, c.id, 'Perfume X'), undefined);

  productWaitlistQueries.add.run(t.id, c.id, 'Perfume X');
  assert.ok(productWaitlistQueries.existsActive.get(t.id, c.id, 'Perfume X'));
});

test('productWaitlistQueries.countsByTenant agrega por produto e ignora já notificados', () => {
  const t = makeTenant();
  const c1 = getOrCreateContact(t.id, '5511944440002', 'A');
  const c2 = getOrCreateContact(t.id, '5511944440003', 'B');
  const c3 = getOrCreateContact(t.id, '5511944440004', 'C');
  productWaitlistQueries.add.run(t.id, c1.id, 'Perfume X');
  const { lastInsertRowid: id2 } = productWaitlistQueries.add.run(t.id, c2.id, 'Perfume X');
  productWaitlistQueries.add.run(t.id, c3.id, 'Sabonete Y');

  const counts = Object.fromEntries(
    productWaitlistQueries.countsByTenant.all(t.id).map((r) => [r.produto_nome, r.n])
  );
  assert.equal(counts['Perfume X'], 2);
  assert.equal(counts['Sabonete Y'], 1);

  // Notificar só uma das duas entradas de "Perfume X" reduz a contagem em 1, não zera.
  productWaitlistQueries.markNotified.run(id2);
  const countsAfter = Object.fromEntries(
    productWaitlistQueries.countsByTenant.all(t.id).map((r) => [r.produto_nome, r.n])
  );
  assert.equal(countsAfter['Perfume X'], 1);
  assert.equal(countsAfter['Sabonete Y'], 1);
});

test('productWaitlistQueries.activeByProduto retorna telefone e nome de quem está esperando', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511944440005', 'Aguardando Reposição');
  productWaitlistQueries.add.run(t.id, c.id, 'Perfume X');

  const rows = productWaitlistQueries.activeByProduto.all(t.id, 'Perfume X');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].wa_phone, c.wa_phone);
  assert.equal(rows[0].name, 'Aguardando Reposição');
});

test('productWaitlistQueries.markNotified marca só a entrada notificada, preservando as demais', () => {
  const t = makeTenant();
  const c1 = getOrCreateContact(t.id, '5511944440006', 'Notificado');
  const c2 = getOrCreateContact(t.id, '5511944440007', 'Ainda esperando');
  const { lastInsertRowid: id1 } = productWaitlistQueries.add.run(t.id, c1.id, 'Perfume X');
  productWaitlistQueries.add.run(t.id, c2.id, 'Perfume X');

  productWaitlistQueries.markNotified.run(id1);

  const remaining = productWaitlistQueries.activeByProduto.all(t.id, 'Perfume X');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].wa_phone, c2.wa_phone);
});
