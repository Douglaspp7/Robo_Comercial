import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, getOrCreateContact, contactTagQueries } from '../src/db.js';
import {
  applyStageTag, applyBuyIntentTag, applyHandoffReasonTag, applyTipoClienteTag,
} from '../src/auto-tags.js';

function makeTenant() {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(id, `${id}@test.com`);
  return tenantQueries.byId.get(id);
}

function tagsOf(contactId) {
  return contactTagQueries.byContact.all(contactId).map((r) => r.tag);
}

test('applyStageTag aplica a tag da etapa e remove as outras do mesmo grupo', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511900000001', 'Cliente');

  applyStageTag(t.id, c.id, 'orcamento');
  assert.ok(tagsOf(c.id).includes('orçamento enviado'));

  applyStageTag(t.id, c.id, 'checkout');
  const tags = tagsOf(c.id);
  assert.ok(tags.includes('aguardando pagamento'));
  assert.ok(!tags.includes('orçamento enviado'));

  applyStageTag(t.id, c.id, 'perdido');
  const tags2 = tagsOf(c.id);
  assert.ok(tags2.includes('venda perdida'));
  assert.ok(!tags2.includes('aguardando pagamento'));
});

test('applyStageTag não faz nada para etapas sem tag mapeada', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511900000002', 'Cliente');
  applyStageTag(t.id, c.id, 'orcamento');
  applyStageTag(t.id, c.id, 'duvida'); // sem tag mapeada — não deve remover nem adicionar
  const tags = tagsOf(c.id);
  assert.ok(tags.includes('orçamento enviado')); // continua, pois "duvida" não está no grupo
});

test('applyBuyIntentTag adiciona/remove "alta intenção" conforme a classificação', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511900000003', 'Cliente');

  applyBuyIntentTag(t.id, c.id, 'alta');
  assert.ok(tagsOf(c.id).includes('alta intenção'));

  applyBuyIntentTag(t.id, c.id, 'baixa');
  assert.ok(!tagsOf(c.id).includes('alta intenção'));
});

test('applyHandoffReasonTag só marca "reclamação" quando o motivo é reclamacao', () => {
  const t = makeTenant();
  const c1 = getOrCreateContact(t.id, '5511900000004', 'Cliente 1');
  const c2 = getOrCreateContact(t.id, '5511900000005', 'Cliente 2');

  applyHandoffReasonTag(t.id, c1.id, 'reclamacao');
  assert.ok(tagsOf(c1.id).includes('reclamação'));

  applyHandoffReasonTag(t.id, c2.id, 'pediu_humano');
  assert.ok(!tagsOf(c2.id).includes('reclamação'));
});

test('applyTipoClienteTag alterna entre "pessoa física" e "empresa"', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511900000006', 'Cliente');

  applyTipoClienteTag(t.id, c.id, 'pf');
  let tags = tagsOf(c.id);
  assert.ok(tags.includes('pessoa física'));
  assert.ok(!tags.includes('empresa'));

  applyTipoClienteTag(t.id, c.id, 'pj');
  tags = tagsOf(c.id);
  assert.ok(tags.includes('empresa'));
  assert.ok(!tags.includes('pessoa física'));
});

test('getOrCreateContact aplica a tag automática "cliente novo" só na criação', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511900000007', 'Cliente');
  assert.ok(tagsOf(c.id).includes('cliente novo'));

  contactTagQueries.remove.run(c.id, 'cliente novo');
  getOrCreateContact(t.id, '5511900000007', 'Cliente'); // já existe — não deve reaplicar
  assert.ok(!tagsOf(c.id).includes('cliente novo'));
});
