import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, contactTagQueries, campaignQueries, getOrCreateContact } from '../src/db.js';

function makeTenant() {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(id, `${id}@test.com`);
  return tenantQueries.byId.get(id);
}

test('contactTagQueries.contactsWithPhoneByTag retorna só contatos ativos com aquela tag', () => {
  const t = makeTenant();
  const c1 = getOrCreateContact(t.id, '5511933330001', 'Cliente VIP');
  const c2 = getOrCreateContact(t.id, '5511933330002', 'Cliente Comum');
  const c3 = getOrCreateContact(t.id, '5511933330003', 'Cliente Arquivado');
  contactTagQueries.add.run(t.id, c1.id, 'vip');
  contactTagQueries.add.run(t.id, c3.id, 'vip');
  contactTagQueries.add.run(t.id, c2.id, 'comum');
  db.prepare(`UPDATE contacts SET archived = 1 WHERE id = ?`).run(c3.id);

  const audiencia = contactTagQueries.contactsWithPhoneByTag.all(t.id, 'vip');
  assert.equal(audiencia.length, 1);
  assert.equal(audiencia[0].wa_phone, c1.wa_phone);
});

test('contactTagQueries.contactsWithPhoneByTag não vaza contatos de outro tenant', () => {
  const t1 = makeTenant();
  const t2 = makeTenant();
  const c1 = getOrCreateContact(t1.id, '5511933330004', 'Cliente T1');
  contactTagQueries.add.run(t1.id, c1.id, 'promo');

  assert.equal(contactTagQueries.contactsWithPhoneByTag.all(t2.id, 'promo').length, 0);
  assert.equal(contactTagQueries.contactsWithPhoneByTag.all(t1.id, 'promo').length, 1);
});

test('campaignQueries.insert registra contagens e listByTenant retorna mais recente primeiro', () => {
  const t = makeTenant();
  campaignQueries.insert.run({
    tenant_id: t.id, template_nome: 'recompra_v1', tag: 'vip',
    total_contatos: 10, enviados: 9, falhas: 1,
  });
  campaignQueries.insert.run({
    tenant_id: t.id, template_nome: 'promo_v2', tag: 'comum',
    total_contatos: 3, enviados: 3, falhas: 0,
  });

  const campanhas = campaignQueries.listByTenant.all(t.id);
  assert.equal(campanhas.length, 2);
  assert.equal(campanhas[0].template_nome, 'promo_v2');
  assert.equal(campanhas[0].enviados, 3);
  assert.equal(campanhas[1].template_nome, 'recompra_v1');
  assert.equal(campanhas[1].falhas, 1);
});
