import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, getOrCreateContact, messageQueries, getConversation } from '../src/db.js';

function makeTenant() {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tenants (id, email, password_hash, plan, subscription_status) VALUES (?, ?, 'h', 'pro', 'active')`
  ).run(id, `${id}@test.com`);
  return tenantQueries.byId.get(id);
}

test('messageQueries.insert criptografa mensagem que contém CPF/CNPJ válido', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511999991000', 'Cliente PJ');
  // CNPJ válido (checksum correto) digitado no chat, como no fluxo pfPjRule.
  messageQueries.insert.run(c.id, 'user', 'Meu CNPJ é 11.222.333/0001-81, pode confirmar?');

  const raw = db.prepare('SELECT content FROM messages WHERE contact_id = ?').get(c.id);
  assert.ok(raw.content.startsWith('enc:v1:'), 'conteúdo com CNPJ válido deve ser armazenado cifrado');
  assert.ok(!raw.content.includes('11.222.333/0001-81'), 'CNPJ em texto puro não deve aparecer no banco');
});

test('messageQueries.insert não criptografa mensagem comum (sem documento válido)', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511999991001', 'Cliente Comum');
  messageQueries.insert.run(c.id, 'user', 'Meu telefone é 11987654321, pode me ligar?');

  const raw = db.prepare('SELECT content FROM messages WHERE contact_id = ?').get(c.id);
  assert.equal(raw.content, 'Meu telefone é 11987654321, pode me ligar?');
});

test('getConversation decifra transparentemente o conteúdo cifrado', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511999991002', 'Cliente PF');
  // CPF válido (checksum correto).
  messageQueries.insert.run(c.id, 'user', 'CPF: 111.444.777-35');
  messageQueries.insert.run(c.id, 'assistant', 'Obrigado, já registrei aqui!');

  const conv = getConversation(c.id);
  assert.equal(conv.length, 2);
  assert.equal(conv[0].content, 'CPF: 111.444.777-35');
  assert.equal(conv[1].content, 'Obrigado, já registrei aqui!');
});

test('cleanupInactiveMessages apaga mensagens só de contatos inativos há mais de 365 dias', async () => {
  const { cleanupInactiveMessages } = await import('../src/db.js');
  const t = makeTenant();
  const ativo = getOrCreateContact(t.id, '5511999991003', 'Cliente Ativo');
  const inativo = getOrCreateContact(t.id, '5511999991004', 'Cliente Inativo');

  messageQueries.insert.run(ativo.id, 'user', 'Oi, ainda quero comprar');
  messageQueries.insert.run(inativo.id, 'user', 'Já fechei a compra faz tempo');

  db.prepare(`UPDATE contacts SET last_message_at = datetime('now', '-400 days') WHERE id = ?`).run(inativo.id);
  db.prepare(`UPDATE contacts SET last_message_at = datetime('now') WHERE id = ?`).run(ativo.id);

  cleanupInactiveMessages();

  const msgsAtivo = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE contact_id = ?').get(ativo.id).n;
  const msgsInativo = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE contact_id = ?').get(inativo.id).n;
  assert.equal(msgsAtivo, 1, 'mensagens de contato ativo devem permanecer');
  assert.equal(msgsInativo, 0, 'mensagens de contato inativo há +365 dias devem ser apagadas');

  // Contato em si continua existindo (só o histórico de texto é expurgado).
  assert.ok(db.prepare('SELECT id FROM contacts WHERE id = ?').get(inativo.id));
});
