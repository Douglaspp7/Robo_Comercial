import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, getOrCreateContact } from '../src/db.js';
import { buildDailySummaryMessage } from '../src/daily-summary.js';

function makeTenant(businessName = 'Loja Teste') {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tenants (id, email, password_hash, business_name) VALUES (?, ?, 'h', ?)`
  ).run(id, `${id}@test.com`, businessName);
  return tenantQueries.byId.get(id);
}

test('buildDailySummaryMessage mostra zeros e omite linhas opcionais quando não há atividade', () => {
  const t = makeTenant('Loja Vazia');
  const msg = buildDailySummaryMessage(t);
  assert.match(msg, /Loja Vazia/);
  assert.match(msg, /Novos contatos: 0/);
  assert.match(msg, /Respostas da IA: 0/);
  assert.match(msg, /Vendas fechadas: 0 \(R\$\s?0,00\)/);
  assert.doesNotMatch(msg, /Aguardando pagamento/);
  assert.doesNotMatch(msg, /Aguardando humano/);
});

test('buildDailySummaryMessage conta contatos novos e respostas da IA de hoje', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511955550001', 'Cliente Hoje');
  db.prepare(`INSERT INTO messages (contact_id, role, content) VALUES (?, 'assistant', 'oi')`).run(c.id);
  db.prepare(`INSERT INTO messages (contact_id, role, content) VALUES (?, 'assistant', 'tudo bem?')`).run(c.id);
  db.prepare(`INSERT INTO messages (contact_id, role, content) VALUES (?, 'user', 'oi')`).run(c.id);

  const msg = buildDailySummaryMessage(t);
  assert.match(msg, /Novos contatos: 1/);
  assert.match(msg, /Respostas da IA: 2/);
});

test('buildDailySummaryMessage não conta contato criado em outro dia', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511955550002', 'Cliente Antigo');
  db.prepare(`UPDATE contacts SET created_at = datetime('now', '-2 days') WHERE id = ?`).run(c.id);

  const msg = buildDailySummaryMessage(t);
  assert.match(msg, /Novos contatos: 0/);
});

test('buildDailySummaryMessage soma vendas pagas hoje e mostra aguardando pagamento/humano', () => {
  const t = makeTenant();
  const c1 = getOrCreateContact(t.id, '5511955550003', 'Comprou');
  const c2 = getOrCreateContact(t.id, '5511955550004', 'Aguardando pagamento');
  const c3 = getOrCreateContact(t.id, '5511955550005', 'Aguardando humano');

  db.prepare(`
    INSERT INTO sales (id, tenant_id, contact_id, status, total_cents, paid_at)
    VALUES (?, ?, ?, 'pago', 15000, datetime('now'))
  `).run(randomUUID(), t.id, c1.id);
  db.prepare(`
    INSERT INTO sales (id, tenant_id, contact_id, status, total_cents)
    VALUES (?, ?, ?, 'aguardando_pagamento', 5000)
  `).run(randomUUID(), t.id, c2.id);
  db.prepare(`UPDATE contacts SET handoff_status = 'waiting' WHERE id = ?`).run(c3.id);

  const msg = buildDailySummaryMessage(t);
  assert.match(msg, /Vendas fechadas: 1 \(R\$\s?150,00\)/);
  assert.match(msg, /Aguardando pagamento: 1/);
  assert.match(msg, /Aguardando humano: 1/);
});

test('buildDailySummaryMessage não soma venda paga em outro dia', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511955550006', 'Comprou ontem');
  db.prepare(`
    INSERT INTO sales (id, tenant_id, contact_id, status, total_cents, paid_at)
    VALUES (?, ?, ?, 'pago', 9900, datetime('now', '-1 day'))
  `).run(randomUUID(), t.id, c.id);

  const msg = buildDailySummaryMessage(t);
  assert.match(msg, /Vendas fechadas: 0 \(R\$\s?0,00\)/);
});
