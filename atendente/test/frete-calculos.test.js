import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, getOrCreateContact, freteCalculoQueries } from '../src/db.js';

function makeTenant() {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(id, `${id}@test.com`);
  return tenantQueries.byId.get(id);
}

test('freteCalculoQueries.semCompraCount conta contatos com frete calculado que ainda não fecharam', () => {
  const t = makeTenant();
  const c1 = getOrCreateContact(t.id, '5511933330001', 'Sem compra');
  const c2 = getOrCreateContact(t.id, '5511933330002', 'Fechou depois');
  db.prepare(`UPDATE contacts SET stage = 'fechado' WHERE id = ?`).run(c2.id);

  freteCalculoQueries.insert.run(t.id, c1.id, '01000-000');
  freteCalculoQueries.insert.run(t.id, c2.id, '02000-000');

  assert.equal(freteCalculoQueries.semCompraCount.get(t.id).n, 1);
});

test('freteCalculoQueries.semCompraCount conta cada contato uma única vez mesmo com vários cálculos', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511933330003', 'Várias consultas');
  freteCalculoQueries.insert.run(t.id, c.id, '01000-000');
  freteCalculoQueries.insert.run(t.id, c.id, '02000-000');
  freteCalculoQueries.insert.run(t.id, c.id, '03000-000');

  assert.equal(freteCalculoQueries.semCompraCount.get(t.id).n, 1);
});
