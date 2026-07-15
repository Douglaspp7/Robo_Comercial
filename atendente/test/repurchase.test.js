import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, getOrCreateContact } from '../src/db.js';
import { getRepurchaseSuggestions } from '../src/repurchase.js';

function makeTenant() {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(id, `${id}@test.com`);
  return tenantQueries.byId.get(id);
}

function insertSale(tenantId, contactId, items, { status = 'pago', daysAgo = 0 } = {}) {
  db.prepare(`
    INSERT INTO sales (id, tenant_id, contact_id, status, items_json, paid_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', ?))
  `).run(randomUUID(), tenantId, contactId, status, JSON.stringify(items), `-${daysAgo} days`);
}

test('getRepurchaseSuggestions retorna vazio sem produtos com ciclo_dias', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511966660001', 'Cliente');
  insertSale(t.id, c.id, [{ titulo: 'Perfume X', quantidade: 1, valor_unitario: 99.9 }], { daysAgo: 40 });

  const suggestions = getRepurchaseSuggestions(t.id, [{ nome: 'Perfume X', preco: '99.90' }]);
  assert.deepEqual(suggestions, []);
});

test('getRepurchaseSuggestions sugere quando o ciclo já passou', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511966660002', 'Maria Compradora');
  insertSale(t.id, c.id, [{ titulo: 'Perfume X', quantidade: 1, valor_unitario: 99.9 }], { daysAgo: 35 });

  const suggestions = getRepurchaseSuggestions(t.id, [{ nome: 'Perfume X', ciclo_dias: 30 }]);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].phone, c.wa_phone);
  assert.equal(suggestions[0].produto, 'Perfume X');
  assert.equal(suggestions[0].diasDesde, 35);
  assert.equal(suggestions[0].cicloDias, 30);
  assert.match(suggestions[0].mensagem, /Maria/);
  assert.match(suggestions[0].mensagem, /Perfume X/);
});

test('getRepurchaseSuggestions não sugere quando o ciclo ainda não passou', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511966660003', 'Cliente Recente');
  insertSale(t.id, c.id, [{ titulo: 'Perfume X', quantidade: 1, valor_unitario: 99.9 }], { daysAgo: 10 });

  const suggestions = getRepurchaseSuggestions(t.id, [{ nome: 'Perfume X', ciclo_dias: 30 }]);
  assert.deepEqual(suggestions, []);
});

test('getRepurchaseSuggestions considera só a compra mais recente do par contato+produto', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511966660004', 'Cliente Fiel');
  // Compra antiga (venceria o ciclo) e uma recompra recente do mesmo produto —
  // só a mais recente deve valer, e ela ainda está dentro do ciclo.
  insertSale(t.id, c.id, [{ titulo: 'Perfume X', quantidade: 1, valor_unitario: 99.9 }], { daysAgo: 60 });
  insertSale(t.id, c.id, [{ titulo: 'Perfume X', quantidade: 1, valor_unitario: 99.9 }], { daysAgo: 5 });

  const suggestions = getRepurchaseSuggestions(t.id, [{ nome: 'Perfume X', ciclo_dias: 30 }]);
  assert.deepEqual(suggestions, []);
});

test('getRepurchaseSuggestions ignora venda não paga', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511966660005', 'Cliente Pendente');
  insertSale(t.id, c.id, [{ titulo: 'Perfume X', quantidade: 1, valor_unitario: 99.9 }], { status: 'aguardando_pagamento', daysAgo: 40 });

  const suggestions = getRepurchaseSuggestions(t.id, [{ nome: 'Perfume X', ciclo_dias: 30 }]);
  assert.deepEqual(suggestions, []);
});

test('getRepurchaseSuggestions ordena os mais atrasados primeiro', () => {
  const t = makeTenant();
  const c1 = getOrCreateContact(t.id, '5511966660006', 'Pouco atrasado');
  const c2 = getOrCreateContact(t.id, '5511966660007', 'Muito atrasado');
  insertSale(t.id, c1.id, [{ titulo: 'Perfume X', quantidade: 1, valor_unitario: 99.9 }], { daysAgo: 32 });
  insertSale(t.id, c2.id, [{ titulo: 'Perfume X', quantidade: 1, valor_unitario: 99.9 }], { daysAgo: 60 });

  const suggestions = getRepurchaseSuggestions(t.id, [{ nome: 'Perfume X', ciclo_dias: 30 }]);
  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0].name, 'Muito atrasado');
  assert.equal(suggestions[1].name, 'Pouco atrasado');
});
