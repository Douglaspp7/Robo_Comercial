/**
 * Testes de paginação por cursor (src/pagination.js) e das queries
 * paginadas de contatos, vendas e mensagens.
 *
 * Cobre: cursor válido/inválido, primeira página, próxima página, sem
 * duplicação entre páginas, ordenação estável em empate de timestamp,
 * limite máximo, refresh incremental via changes-since e isolamento
 * entre tenants.
 */
import './_setup.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  db,
  contactQueries,
  messageQueries,
  saleQueries,
} from '../src/db.js';
import {
  encodeCursor, decodeCursor, clampLimit, paginate,
  DEFAULT_LIMIT, MAX_LIMIT, MIN_LIMIT,
} from '../src/pagination.js';
import { hashPassword } from '../src/auth.js';

function makeTenant() {
  const id = 't_' + randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO tenants (id, email, password_hash, business_name, business_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, `${id}@t.com`, hashPassword('x'), 'Loja', '{}');
  return id;
}

function makeContact(tenantId, { phone, last_message_at, stage = 'novo_contato', archived = 0 } = {}) {
  const wa = phone || '5511' + Math.floor(Math.random() * 1e9);
  const info = db.prepare(`
    INSERT INTO contacts (tenant_id, wa_phone, name, stage, last_message_at, archived)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tenantId, wa, wa, stage, last_message_at || new Date().toISOString(), archived);
  return db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(info.lastInsertRowid);
}

function makeSale(tenantId, contactId, { updated_at, status = 'pago' } = {}) {
  const id = 'sale_' + randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO sales (id, tenant_id, contact_id, status, total_cents, items_json, updated_at)
    VALUES (?, ?, ?, ?, 1000, '[]', ?)
  `).run(id, tenantId, contactId, status, updated_at || new Date().toISOString());
  return id;
}

beforeEach(() => {
  db.exec(`DELETE FROM messages; DELETE FROM sales; DELETE FROM contacts;`);
});

// ── Unit tests do módulo pagination.js ─────────────────────────────────────

test('encodeCursor/decodeCursor: round-trip válido', () => {
  const raw = encodeCursor({ t: '2026-07-10T12:00:00Z', id: 42 });
  const back = decodeCursor(raw);
  assert.equal(back.t, '2026-07-10T12:00:00Z');
  assert.equal(back.id, 42);
});

test('decodeCursor: entrada inválida vira null', () => {
  assert.equal(decodeCursor(''), null);
  assert.equal(decodeCursor(null), null);
  assert.equal(decodeCursor('não-é-base64'), null);
  assert.equal(decodeCursor('a'.repeat(500)), null); // muito grande
});

test('clampLimit: dentro/fora do intervalo', () => {
  assert.equal(clampLimit(undefined), DEFAULT_LIMIT);
  assert.equal(clampLimit('50'), 50);
  assert.equal(clampLimit('5'), MIN_LIMIT);
  assert.equal(clampLimit('9999'), MAX_LIMIT);
  assert.equal(clampLimit('lixo'), DEFAULT_LIMIT);
});

test('paginate: has_more=true quando rows.length > limit', () => {
  const rows = [{ t: '3', id: 3 }, { t: '2', id: 2 }, { t: '1', id: 1 }];
  const p = paginate(rows, 2, (r) => r);
  assert.equal(p.items.length, 2);
  assert.equal(p.has_more, true);
  assert.ok(p.next_cursor);
});

test('paginate: has_more=false quando cabe tudo', () => {
  const rows = [{ t: '1', id: 1 }];
  const p = paginate(rows, 10, (r) => r);
  assert.equal(p.items.length, 1);
  assert.equal(p.has_more, false);
  assert.equal(p.next_cursor, null);
});

// ── Contatos: paginação por cursor ─────────────────────────────────────────

test('contacts: primeira página + próxima cobrem toda a lista sem duplicação', () => {
  const tenant = makeTenant();
  for (let i = 0; i < 12; i++) {
    // Timestamp incrementa para garantir ordem determinística
    makeContact(tenant, {
      phone: `5511${String(i).padStart(9, '0')}`,
      last_message_at: new Date(2026, 0, 1, 12, i).toISOString(),
    });
  }
  const first = contactQueries.listByTenantPage.all({
    tenant_id: tenant, since_t: null, since_id: 0, limit_plus_one: 6,
  });
  assert.equal(first.length, 6);
  const nextT = first[4].last_message_at; // última do items (excluindo o +1)
  const nextId = first[4].id;
  const second = contactQueries.listByTenantPage.all({
    tenant_id: tenant, since_t: nextT, since_id: nextId, limit_plus_one: 6,
  });
  assert.ok(second.length > 0);
  const ids = new Set([...first.slice(0, 5).map((r) => r.id), ...second.slice(0, 5).map((r) => r.id)]);
  assert.equal(ids.size, first.slice(0, 5).length + second.slice(0, 5).length, 'sem duplicação entre páginas');
});

test('contacts: cursor com timestamp idêntico usa id como desempate (ordenação estável)', () => {
  const tenant = makeTenant();
  const t = new Date(2026, 0, 1, 12, 0).toISOString();
  const a = makeContact(tenant, { phone: '5511111111111', last_message_at: t });
  const b = makeContact(tenant, { phone: '5511222222222', last_message_at: t });
  const c = makeContact(tenant, { phone: '5511333333333', last_message_at: t });
  // Ordem esperada (id DESC): c, b, a
  const first = contactQueries.listByTenantPage.all({
    tenant_id: tenant, since_t: null, since_id: 0, limit_plus_one: 2,
  });
  assert.equal(first[0].id, c.id);
  assert.equal(first[1].id, b.id);
  // Segunda página com cursor em b (mesmo timestamp, id=b.id)
  const second = contactQueries.listByTenantPage.all({
    tenant_id: tenant, since_t: t, since_id: b.id, limit_plus_one: 2,
  });
  assert.equal(second[0].id, a.id, 'próxima página deve trazer a, não pular nem repetir');
});

test('contacts: isolamento entre tenants', () => {
  const t1 = makeTenant(), t2 = makeTenant();
  makeContact(t1, { last_message_at: new Date(2026, 0, 1, 12, 0).toISOString() });
  makeContact(t2, { last_message_at: new Date(2026, 0, 1, 12, 0).toISOString() });
  const rows = contactQueries.listByTenantPage.all({
    tenant_id: t1, since_t: null, since_id: 0, limit_plus_one: 10,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenant_id, t1);
});

test('contacts: listChangedSince pega apenas alterações depois do timestamp', () => {
  const tenant = makeTenant();
  makeContact(tenant, { last_message_at: '2026-01-01 10:00:00' });
  makeContact(tenant, { last_message_at: '2026-01-01 12:00:00' });
  makeContact(tenant, { last_message_at: '2026-01-01 14:00:00' });
  const rows = contactQueries.listChangedSince.all({
    tenant_id: tenant, since: '2026-01-01 11:00:00', limit: 100,
  });
  assert.equal(rows.length, 2);
});

test('contacts: archived=1 usa listArchivedByTenantPage e devolve só arquivados', () => {
  const tenant = makeTenant();
  makeContact(tenant, { archived: 0, last_message_at: new Date().toISOString() });
  const archived = makeContact(tenant, { archived: 1, last_message_at: new Date().toISOString() });
  db.prepare(`UPDATE contacts SET archived_at = ? WHERE id = ?`).run(new Date().toISOString(), archived.id);
  const rows = contactQueries.listArchivedByTenantPage.all({
    tenant_id: tenant, since_t: null, since_id: 0, limit_plus_one: 10,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, archived.id);
});

// ── Vendas: paginação por cursor ───────────────────────────────────────────

test('sales: paginação com filtro por status', () => {
  const tenant = makeTenant();
  const c = makeContact(tenant, { last_message_at: new Date().toISOString() });
  makeSale(tenant, c.id, { status: 'pago', updated_at: '2026-01-01 10:00:00' });
  makeSale(tenant, c.id, { status: 'pago', updated_at: '2026-01-01 11:00:00' });
  makeSale(tenant, c.id, { status: 'perdido', updated_at: '2026-01-01 12:00:00' });
  const rows = saleQueries.byTenantPage.all({
    tenant_id: tenant, status: 'pago', from_dt: null, to_dt: null,
    since_t: null, since_id: null, limit_plus_one: 10,
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.status === 'pago'));
});

test('sales: sem filtro devolve todos, ordenados por updated_at DESC + id DESC', () => {
  const tenant = makeTenant();
  const c = makeContact(tenant, { last_message_at: new Date().toISOString() });
  const a = makeSale(tenant, c.id, { updated_at: '2026-01-01 10:00:00' });
  const b = makeSale(tenant, c.id, { updated_at: '2026-01-01 12:00:00' });
  const rows = saleQueries.byTenantPage.all({
    tenant_id: tenant, status: null, from_dt: null, to_dt: null,
    since_t: null, since_id: null, limit_plus_one: 10,
  });
  assert.equal(rows[0].id, b);
  assert.equal(rows[1].id, a);
});

// ── Mensagens: paginação por before_id ─────────────────────────────────────

test('messages: página inicial + before_id trazem histórico completo sem duplicação', () => {
  const tenant = makeTenant();
  const c = makeContact(tenant, { last_message_at: new Date().toISOString() });
  for (let i = 0; i < 12; i++) {
    messageQueries.insert.run(c.id, i % 2 === 0 ? 'user' : 'assistant', `msg ${i}`);
  }
  const first = messageQueries.page.all({ contact_id: c.id, before_id: null, limit_plus_one: 6 });
  assert.equal(first.length, 6);
  const oldestFirstPage = first[4]; // primeiros 5 são itens, 6º sinaliza has_more
  const second = messageQueries.page.all({
    contact_id: c.id, before_id: oldestFirstPage.id, limit_plus_one: 20,
  });
  const seenIds = new Set([...first.slice(0, 5).map((m) => m.id), ...second.map((m) => m.id)]);
  assert.equal(seenIds.size, 5 + second.length, 'sem duplicação');
});

test('messages: página inicial (before_id=null) devolve as mais recentes', () => {
  const tenant = makeTenant();
  const c = makeContact(tenant, { last_message_at: new Date().toISOString() });
  for (let i = 0; i < 3; i++) {
    messageQueries.insert.run(c.id, 'user', `msg ${i}`);
  }
  const rows = messageQueries.page.all({ contact_id: c.id, before_id: null, limit_plus_one: 10 });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].content, 'msg 2', 'mais recente primeiro');
});
