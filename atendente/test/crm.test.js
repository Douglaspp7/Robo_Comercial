import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  db, tenantQueries, contactQueries, contactTagQueries,
  getOrCreateContact, decryptContactDocument,
} from '../src/db.js';
import { encryptSecret } from '../src/crypto.js';
import { hashDocument } from '../src/cpf-cnpj.js';

function makeTenant() {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tenants (id, email, password_hash, plan, subscription_status) VALUES (?, ?, 'h', 'pro', 'active')`
  ).run(id, `${id}@test.com`);
  return tenantQueries.byId.get(id);
}

test('getOrCreateContact cria contato novo com lead_source padrão', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511999990000', 'Cliente Teste');
  assert.equal(c.lead_source, 'whatsapp_direto');
  assert.equal(c.name, 'Cliente Teste');
});

test('getOrCreateContact captura lead_source de referral do WhatsApp (Meta Ads)', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511999990001', 'Cliente Ads', {
    source_type: 'ad',
    headline: 'Promoção de verão',
  });
  assert.equal(c.lead_source, 'meta_ads');
  assert.equal(c.lead_source_detail, 'Promoção de verão');
});

test('getOrCreateContact não sobrescreve lead_source em contato já existente', () => {
  const t = makeTenant();
  const first = getOrCreateContact(t.id, '5511999990002', 'Cliente');
  assert.equal(first.lead_source, 'whatsapp_direto');
  const second = getOrCreateContact(t.id, '5511999990002', 'Cliente', { source_type: 'ad' });
  assert.equal(second.lead_source, 'whatsapp_direto');
  assert.equal(second.id, first.id);
});

test('updateCrmFields grava e decryptContactDocument decifra o CPF/CNPJ salvo', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511999990003', 'Cliente PF');
  const digits = '12345678909';
  contactQueries.updateCrmFields.run({
    id: c.id,
    tenant_id: t.id,
    tipo_cliente: 'pf',
    cpf_cnpj_enc: encryptSecret(digits),
    cpf_cnpj_hash: hashDocument(digits),
    razao_social: null,
    nome_fantasia: null,
    email: 'cliente@teste.com',
    cep: '01000-000',
    endereco: 'Rua Teste, 123',
    cidade: 'São Paulo',
    uf: 'SP',
    lead_source: 'instagram_facebook',
    responsavel: 'João',
    prioridade: 'alta',
    proxima_tarefa: 'Enviar link de pagamento',
    prazo_resposta: '2026-07-05 18:00',
  });
  const updated = contactQueries.byId.get(c.id);
  assert.equal(updated.tipo_cliente, 'pf');
  assert.equal(updated.email, 'cliente@teste.com');
  assert.equal(updated.prioridade, 'alta');
  assert.equal(decryptContactDocument(updated), digits);
});

test('findByCpfCnpjHash detecta duplicidade de CPF/CNPJ dentro do mesmo tenant', () => {
  const t = makeTenant();
  const c1 = getOrCreateContact(t.id, '5511999990004', 'Cliente 1');
  const c2 = getOrCreateContact(t.id, '5511999990005', 'Cliente 2');
  const digits = '98765432100';
  const hash = hashDocument(digits);
  contactQueries.updateCrmFields.run({
    id: c1.id, tenant_id: t.id, tipo_cliente: 'pf', cpf_cnpj_enc: encryptSecret(digits),
    cpf_cnpj_hash: hash, razao_social: null, nome_fantasia: null, email: null, cep: null,
    endereco: null, cidade: null, uf: null, lead_source: 'whatsapp_direto', responsavel: null,
    prioridade: 'media', proxima_tarefa: null, prazo_resposta: null,
  });
  const dup = contactQueries.findByCpfCnpjHash.get(t.id, hash, c2.id);
  assert.equal(dup.id, c1.id);
  const noDup = contactQueries.findByCpfCnpjHash.get(t.id, hash, c1.id);
  assert.equal(noDup, undefined);
});

test('contactTagQueries adiciona, lista e remove tags sem duplicar', () => {
  const t = makeTenant();
  // getOrCreateContact já aplica a tag automática "cliente novo" — as asserções
  // abaixo levam isso em conta.
  const c = getOrCreateContact(t.id, '5511999990006', 'Cliente Tags');

  contactTagQueries.add.run(t.id, c.id, 'cliente quente');
  contactTagQueries.add.run(t.id, c.id, 'pediu frete');
  contactTagQueries.add.run(t.id, c.id, 'cliente quente'); // duplicado, deve ser ignorado

  const tags = contactTagQueries.byContact.all(c.id).map((r) => r.tag);
  assert.deepEqual(tags.sort(), ['cliente novo', 'cliente quente', 'pediu frete']);

  contactTagQueries.remove.run(c.id, 'pediu frete');
  contactTagQueries.remove.run(c.id, 'cliente novo');
  const afterRemove = contactTagQueries.byContact.all(c.id).map((r) => r.tag);
  assert.deepEqual(afterRemove, ['cliente quente']);
});

test('contactTagQueries.byTenant agrega contagem de uso por tag', () => {
  const t = makeTenant();
  // getOrCreateContact já aplica "cliente novo" automaticamente — usamos tags
  // diferentes aqui para medir a agregação sem interferência desse automatismo.
  const c1 = getOrCreateContact(t.id, '5511999990007', 'A');
  const c2 = getOrCreateContact(t.id, '5511999990008', 'B');
  contactTagQueries.add.run(t.id, c1.id, 'aguardando pagamento');
  contactTagQueries.add.run(t.id, c2.id, 'aguardando pagamento');
  contactTagQueries.add.run(t.id, c1.id, 'alta intenção');

  const summary = contactTagQueries.byTenant.all(t.id);
  const byTag = Object.fromEntries(summary.map((r) => [r.tag, r.n]));
  assert.equal(byTag['aguardando pagamento'], 2);
  assert.equal(byTag['alta intenção'], 1);
  assert.equal(byTag['cliente novo'], 2); // automática, aplicada nos dois contatos na criação
});

test('contactQueries.archive/unarchive tiram e devolvem o contato da listagem principal', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511999990009', 'Arquivável');

  assert.ok(contactQueries.listByTenant.all(t.id).some((x) => x.id === c.id));
  assert.equal(contactQueries.listArchivedByTenant.all(t.id).length, 0);

  contactQueries.archive.run(t.id, c.wa_phone);
  assert.ok(!contactQueries.listByTenant.all(t.id).some((x) => x.id === c.id));
  const archived = contactQueries.listArchivedByTenant.all(t.id);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].id, c.id);
  assert.ok(archived[0].archived_at);

  contactQueries.unarchive.run(t.id, c.wa_phone);
  assert.ok(contactQueries.listByTenant.all(t.id).some((x) => x.id === c.id));
  assert.equal(contactQueries.listArchivedByTenant.all(t.id).length, 0);
});

test('contactQueries.deleteByPhone apaga o contato e, em cascata, suas mensagens', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511999990010', 'Excluível');
  db.prepare(`INSERT INTO messages (contact_id, role, content) VALUES (?, 'user', 'oi')`).run(c.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE contact_id = ?').get(c.id).n, 1);

  const info = contactQueries.deleteByPhone.run(t.id, c.wa_phone);
  assert.equal(info.changes, 1);
  assert.equal(contactQueries.byPhone.get(t.id, c.wa_phone), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE contact_id = ?').get(c.id).n, 0);
});

test('saleQueries.ltvByTenant agrega só vendas pagas por contato (compras + total gasto)', async () => {
  const { saleQueries } = await import('../src/db.js');
  const t = makeTenant();
  const c1 = getOrCreateContact(t.id, '5511999990020', 'Cliente Fiel');
  const c2 = getOrCreateContact(t.id, '5511999990021', 'Cliente Novo');

  const insert = db.prepare(
    `INSERT INTO sales (id, tenant_id, contact_id, status, total_cents, amount, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  // c1: duas pagas (uma só com total_cents, outra só com amount) + uma aberta (não conta)
  insert.run(randomUUID(), t.id, c1.id, 'pago', 15000, null, '2026-01-10 12:00:00');
  insert.run(randomUUID(), t.id, c1.id, 'paid', null, 230, '2026-03-02 12:00:00');
  insert.run(randomUUID(), t.id, c1.id, 'aguardando_pagamento', 9900, null, null);
  // c2: só venda perdida (não conta)
  insert.run(randomUUID(), t.id, c2.id, 'perdido', 5000, null, null);

  const rows = saleQueries.ltvByTenant.all(t.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contact_id, c1.id);
  assert.equal(rows[0].compras, 2);
  assert.equal(rows[0].total_gasto_cents, 15000 + 23000);
  assert.equal(rows[0].ultima_compra_at, '2026-03-02 12:00:00');
});

test('saleQueries.ltvByTenant não vaza vendas de outro tenant', async () => {
  const { saleQueries } = await import('../src/db.js');
  const t1 = makeTenant();
  const t2 = makeTenant();
  const c = getOrCreateContact(t1.id, '5511999990022', 'Cliente T1');
  db.prepare(
    `INSERT INTO sales (id, tenant_id, contact_id, status, total_cents) VALUES (?, ?, ?, 'pago', 1000)`
  ).run(randomUUID(), t1.id, c.id);
  assert.equal(saleQueries.ltvByTenant.all(t2.id).length, 0);
  assert.equal(saleQueries.ltvByTenant.all(t1.id).length, 1);
});
