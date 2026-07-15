import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, getOrCreateContact, notificationQueries } from '../src/db.js';

function makeTenant() {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(id, `${id}@test.com`);
  return tenantQueries.byId.get(id);
}

test('notificationQueries.create insere e listByTenant retorna mais recente primeiro', () => {
  const t = makeTenant();
  notificationQueries.create.run({ tenant_id: t.id, type: 'estoque_esgotado', title: 'A', message: 'msg A', contact_id: null });
  notificationQueries.create.run({ tenant_id: t.id, type: 'limite_ia', title: 'B', message: 'msg B', contact_id: null });

  const rows = notificationQueries.listByTenant.all(t.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'B'); // mais recente primeiro
  assert.equal(rows[1].title, 'A');
});

test('notificationQueries.listByTenant traz telefone/nome do contato quando vinculado', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511911110001', 'Cliente Vinculado');
  notificationQueries.create.run({ tenant_id: t.id, type: 'aguardando_humano', title: 'X', message: 'msg', contact_id: c.id });

  const rows = notificationQueries.listByTenant.all(t.id);
  assert.equal(rows[0].wa_phone, c.wa_phone);
  assert.equal(rows[0].contact_name, 'Cliente Vinculado');
});

test('notificationQueries.unreadCount conta só as não lidas', () => {
  const t = makeTenant();
  const { lastInsertRowid: id1 } = notificationQueries.create.run({ tenant_id: t.id, type: 'a', title: 'A', message: 'm', contact_id: null });
  notificationQueries.create.run({ tenant_id: t.id, type: 'b', title: 'B', message: 'm', contact_id: null });

  assert.equal(notificationQueries.unreadCount.get(t.id).n, 2);
  notificationQueries.markRead.run(id1, t.id);
  assert.equal(notificationQueries.unreadCount.get(t.id).n, 1);
});

test('notificationQueries.markRead não afeta outro tenant', () => {
  const t1 = makeTenant();
  const t2 = makeTenant();
  const { lastInsertRowid: id1 } = notificationQueries.create.run({ tenant_id: t1.id, type: 'a', title: 'A', message: 'm', contact_id: null });

  const info = notificationQueries.markRead.run(id1, t2.id);
  assert.equal(info.changes, 0);
  assert.equal(notificationQueries.unreadCount.get(t1.id).n, 1);
});

test('notificationQueries.markAllRead zera as pendências do tenant', () => {
  const t = makeTenant();
  notificationQueries.create.run({ tenant_id: t.id, type: 'a', title: 'A', message: 'm', contact_id: null });
  notificationQueries.create.run({ tenant_id: t.id, type: 'b', title: 'B', message: 'm', contact_id: null });

  notificationQueries.markAllRead.run(t.id);
  assert.equal(notificationQueries.unreadCount.get(t.id).n, 0);
});
