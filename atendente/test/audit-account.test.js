import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, getOrCreateContact, messageQueries, auditLogQueries, logAudit } from '../src/db.js';

function makeTenant() {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tenants (id, email, password_hash, plan, subscription_status) VALUES (?, ?, 'h', 'pro', 'active')`
  ).run(id, `${id}@test.com`);
  return tenantQueries.byId.get(id);
}

test('tenantQueries.delete apaga em cascata contatos, mensagens e vendas do tenant', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511999992000', 'Cliente Teste');
  messageQueries.insert.run(c.id, 'user', 'Oi, quero comprar');
  db.prepare(`INSERT INTO sales (id, tenant_id, contact_id, status, total_cents) VALUES (?, ?, ?, 'pago', 1000)`)
    .run(randomUUID(), t.id, c.id);

  tenantQueries.delete.run(t.id);

  assert.equal(tenantQueries.byId.get(t.id), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE tenant_id = ?').get(t.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE contact_id = ?').get(c.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales WHERE tenant_id = ?').get(t.id).n, 0);
});

test('logAudit grava a ação e sobrevive à exclusão do tenant-alvo (target_tenant_id vira NULL, não some a linha)', () => {
  const actor = makeTenant();
  const target = makeTenant();

  logAudit({
    actorTenantId: actor.id, actorEmail: actor.email,
    targetTenantId: target.id, targetEmail: target.email,
    action: 'impersonate_start',
  });

  const rows = auditLogQueries.byTargetTenant.all(target.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'impersonate_start');

  tenantQueries.delete.run(target.id);

  const recent = auditLogQueries.recent.all();
  const row = recent.find((r) => r.target_email === target.email);
  assert.ok(row, 'linha de auditoria deve sobreviver à exclusão do tenant-alvo');
  assert.equal(row.target_tenant_id, null);
});

test('logAudit nunca lança mesmo com dados malformados', () => {
  assert.doesNotThrow(() => logAudit({ action: 'account_delete_self' }));
});
