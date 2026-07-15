import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, getOrCreateContact } from '../src/db.js';
import { getDemandSignals } from '../src/demand-signals.js';

function makeTenant() {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(id, `${id}@test.com`);
  return tenantQueries.byId.get(id);
}

function mentionProduct(contactId, produto, hoursAgo = 0) {
  db.prepare(`
    UPDATE contacts SET last_produto_mencionado = ?, last_produto_mencionado_at = datetime('now', ?)
    WHERE id = ?
  `).run(produto, `-${hoursAgo} hours`, contactId);
}

test('getDemandSignals não retorna nada abaixo do mínimo de contatos', () => {
  const t = makeTenant();
  const c1 = getOrCreateContact(t.id, '5511988880001', 'A');
  const c2 = getOrCreateContact(t.id, '5511988880002', 'B');
  mentionProduct(c1.id, 'Perfume X');
  mentionProduct(c2.id, 'Perfume X');

  assert.deepEqual(getDemandSignals(t.id), []);
});

test('getDemandSignals detecta produto com contatos distintos suficientes na janela', () => {
  const t = makeTenant();
  const c1 = getOrCreateContact(t.id, '5511988880003', 'A');
  const c2 = getOrCreateContact(t.id, '5511988880004', 'B');
  const c3 = getOrCreateContact(t.id, '5511988880005', 'C');
  mentionProduct(c1.id, 'Perfume X');
  mentionProduct(c2.id, 'Perfume X');
  mentionProduct(c3.id, 'Perfume X');

  const signals = getDemandSignals(t.id);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].produto, 'Perfume X');
  assert.equal(signals[0].contatos, 3);
});

test('getDemandSignals ignora menções fora da janela de horas', () => {
  const t = makeTenant();
  const c1 = getOrCreateContact(t.id, '5511988880006', 'A');
  const c2 = getOrCreateContact(t.id, '5511988880007', 'B');
  const c3 = getOrCreateContact(t.id, '5511988880008', 'C');
  mentionProduct(c1.id, 'Perfume X', 1);
  mentionProduct(c2.id, 'Perfume X', 1);
  mentionProduct(c3.id, 'Perfume X', 10); // fora da janela padrão de 2h

  const signals = getDemandSignals(t.id);
  assert.deepEqual(signals, []);
});

test('getDemandSignals separa por produto e ordena por mais contatos primeiro', () => {
  const t = makeTenant();
  const contatosX = [1, 2, 3].map((n) => getOrCreateContact(t.id, `551198888001${n}`, `X${n}`));
  const contatosY = [1, 2, 3, 4].map((n) => getOrCreateContact(t.id, `551198888002${n}`, `Y${n}`));
  contatosX.forEach((c) => mentionProduct(c.id, 'Perfume X'));
  contatosY.forEach((c) => mentionProduct(c.id, 'Sabonete Y'));

  const signals = getDemandSignals(t.id);
  assert.equal(signals.length, 2);
  assert.equal(signals[0].produto, 'Sabonete Y');
  assert.equal(signals[0].contatos, 4);
  assert.equal(signals[1].produto, 'Perfume X');
  assert.equal(signals[1].contatos, 3);
});

test('getDemandSignals respeita minCount e windowHours customizados', () => {
  const t = makeTenant();
  const c1 = getOrCreateContact(t.id, '5511988880030', 'A');
  const c2 = getOrCreateContact(t.id, '5511988880031', 'B');
  mentionProduct(c1.id, 'Perfume X', 5);
  mentionProduct(c2.id, 'Perfume X', 5);

  assert.deepEqual(getDemandSignals(t.id, { windowHours: 2, minCount: 2 }), []);
  const signals = getDemandSignals(t.id, { windowHours: 6, minCount: 2 });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].contatos, 2);
});

test('getDemandSignals não conta tenants diferentes juntos', () => {
  const t1 = makeTenant();
  const t2 = makeTenant();
  const c1 = getOrCreateContact(t1.id, '5511988880040', 'A');
  const c2 = getOrCreateContact(t1.id, '5511988880041', 'B');
  const c3 = getOrCreateContact(t2.id, '5511988880042', 'C');
  mentionProduct(c1.id, 'Perfume X');
  mentionProduct(c2.id, 'Perfume X');
  mentionProduct(c3.id, 'Perfume X');

  assert.deepEqual(getDemandSignals(t1.id), []);
  assert.deepEqual(getDemandSignals(t2.id), []);
});
