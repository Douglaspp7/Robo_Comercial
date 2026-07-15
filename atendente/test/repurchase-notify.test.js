import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, getOrCreateContact, notificationQueries } from '../src/db.js';
import { runRepurchaseNotifications } from '../src/repurchase-notify.js';

function makeTenant(businessJson) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tenants (id, email, password_hash, business_name, active, business_json) VALUES (?, ?, 'h', 'Loja Teste', 1, ?)`
  ).run(id, `${id}@test.com`, JSON.stringify(businessJson || {}));
  return tenantQueries.byId.get(id);
}

function insertPaidSale(tenantId, contactId, titulo, daysAgo) {
  db.prepare(`
    INSERT INTO sales (id, tenant_id, contact_id, status, items_json, paid_at)
    VALUES (?, ?, ?, 'pago', ?, datetime('now', ?))
  `).run(randomUUID(), tenantId, contactId, JSON.stringify([{ titulo, quantidade: 1, valor_unitario: 9.9 }]), `-${daysAgo} days`);
}

test('runRepurchaseNotifications cria aviso quando há sugestão pendente', () => {
  const t = makeTenant({ produtos: [{ nome: 'Perfume X', ciclo_dias: 30 }] });
  const c = getOrCreateContact(t.id, '5511977770001', 'Cliente Recompra');
  insertPaidSale(t.id, c.id, 'Perfume X', 35);

  runRepurchaseNotifications();

  const notices = notificationQueries.listByTenant.all(t.id);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].type, 'recompra');
  assert.match(notices[0].message, /Cliente Recompra/);
});

test('runRepurchaseNotifications não cria aviso sem sugestão de recompra', () => {
  const t = makeTenant({ produtos: [{ nome: 'Perfume X', ciclo_dias: 30 }] });
  const c = getOrCreateContact(t.id, '5511977770002', 'Cliente Recente');
  insertPaidSale(t.id, c.id, 'Perfume X', 5);

  runRepurchaseNotifications();

  assert.deepEqual(notificationQueries.listByTenant.all(t.id), []);
});

test('runRepurchaseNotifications não repete aviso no mesmo dia', () => {
  const t = makeTenant({ produtos: [{ nome: 'Perfume X', ciclo_dias: 30 }] });
  const c = getOrCreateContact(t.id, '5511977770003', 'Cliente Repetido');
  insertPaidSale(t.id, c.id, 'Perfume X', 40);

  runRepurchaseNotifications();
  runRepurchaseNotifications();

  assert.equal(notificationQueries.listByTenant.all(t.id).length, 1);
});

test('runRepurchaseNotifications agrupa quando há mais de uma sugestão', () => {
  const t = makeTenant({ produtos: [{ nome: 'Perfume X', ciclo_dias: 30 }] });
  const c1 = getOrCreateContact(t.id, '5511977770004', 'Cliente A');
  const c2 = getOrCreateContact(t.id, '5511977770005', 'Cliente B');
  insertPaidSale(t.id, c1.id, 'Perfume X', 40);
  insertPaidSale(t.id, c2.id, 'Perfume X', 45);

  runRepurchaseNotifications();

  const notices = notificationQueries.listByTenant.all(t.id);
  assert.equal(notices.length, 1);
  assert.match(notices[0].message, /2 clientes/);
});
