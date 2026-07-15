import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, getOrCreateContact, productWaitlistQueries } from '../src/db.js';
import { getRevenueRadar } from '../src/opportunities.js';

function makeTenant() {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(id, `${id}@test.com`);
  return tenantQueries.byId.get(id);
}

function insertSale(tenantId, contactId, { status = 'pago', totalCents = 9900, daysAgo = 0 } = {}) {
  db.prepare(`
    INSERT INTO sales (id, tenant_id, contact_id, status, total_cents, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', ?))
  `).run(randomUUID(), tenantId, contactId, status, totalCents, `-${daysAgo} days`);
}

function calcularFrete(tenantId, contactId, daysAgo = 0) {
  db.prepare(`
    INSERT INTO frete_calculos (tenant_id, contact_id, cep_destino, created_at)
    VALUES (?, ?, '01001-000', datetime('now', ?))
  `).run(tenantId, contactId, `-${daysAgo} days`);
}

test('getRevenueRadar retorna todas as categorias vazias sem dados', () => {
  const t = makeTenant();
  const radar = getRevenueRadar(t.id, []);
  assert.deepEqual(radar, {
    demanda: [],
    esperandoReposicao: [],
    checkoutPendente: [],
    freteSemCompra: [],
    recompra: [],
    leadsQuentesParados: [],
  });
});

test('getRevenueRadar detecta checkout pendente', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511977770001', 'Cliente Pendente');
  insertSale(t.id, c.id, { status: 'aguardando_pagamento', totalCents: 15000 });

  const radar = getRevenueRadar(t.id, []);
  assert.equal(radar.checkoutPendente.length, 1);
  assert.equal(radar.checkoutPendente[0].phone, c.wa_phone);
  assert.equal(radar.checkoutPendente[0].valorCents, 15000);
  assert.match(radar.checkoutPendente[0].mensagem, /pagamento/);
});

test('getRevenueRadar ignora venda já paga como checkout pendente', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511977770002', 'Cliente Pago');
  insertSale(t.id, c.id, { status: 'pago' });

  const radar = getRevenueRadar(t.id, []);
  assert.deepEqual(radar.checkoutPendente, []);
});

test('getRevenueRadar detecta frete calculado sem compra', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511977770003', 'Maria Frete');
  calcularFrete(t.id, c.id);

  const radar = getRevenueRadar(t.id, []);
  assert.equal(radar.freteSemCompra.length, 1);
  assert.equal(radar.freteSemCompra[0].phone, c.wa_phone);
  assert.match(radar.freteSemCompra[0].mensagem, /Maria/);
});

test('getRevenueRadar não considera frete sem compra quando o contato já fechou', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511977770004', 'Cliente Fechou');
  calcularFrete(t.id, c.id);
  db.prepare(`UPDATE contacts SET stage = 'fechado' WHERE id = ?`).run(c.id);

  const radar = getRevenueRadar(t.id, []);
  assert.deepEqual(radar.freteSemCompra, []);
});

test('getRevenueRadar detecta lead quente parado há mais de 24h', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511977770005', 'Lead Quente');
  db.prepare(`
    UPDATE contacts SET buy_intent = 'alta', stage = 'negociacao', handoff_status = 'none',
      last_message_at = datetime('now', '-30 hours')
    WHERE id = ?
  `).run(c.id);

  const radar = getRevenueRadar(t.id, []);
  assert.equal(radar.leadsQuentesParados.length, 1);
  assert.equal(radar.leadsQuentesParados[0].phone, c.wa_phone);
});

test('getRevenueRadar não considera lead quente recente (menos de 24h) parado', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511977770006', 'Lead Recente');
  db.prepare(`
    UPDATE contacts SET buy_intent = 'alta', stage = 'negociacao', handoff_status = 'none',
      last_message_at = datetime('now', '-1 hours')
    WHERE id = ?
  `).run(c.id);

  const radar = getRevenueRadar(t.id, []);
  assert.deepEqual(radar.leadsQuentesParados, []);
});

test('getRevenueRadar não considera lead quente parado aguardando humano', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511977770007', 'Aguardando Humano');
  db.prepare(`
    UPDATE contacts SET buy_intent = 'alta', stage = 'negociacao', handoff_status = 'waiting',
      last_message_at = datetime('now', '-30 hours')
    WHERE id = ?
  `).run(c.id);

  const radar = getRevenueRadar(t.id, []);
  assert.deepEqual(radar.leadsQuentesParados, []);
});

test('getRevenueRadar inclui lista de espera de reposição', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511977770008', 'Espera Reposição');
  productWaitlistQueries.add.run(t.id, c.id, 'Sabonete Líquido');

  const radar = getRevenueRadar(t.id, []);
  assert.equal(radar.esperandoReposicao.length, 1);
  assert.equal(radar.esperandoReposicao[0].produto, 'Sabonete Líquido');
  assert.equal(radar.esperandoReposicao[0].contatos, 1);
});

test('getRevenueRadar inclui sugestão de recompra vinda de repurchase.js', () => {
  const t = makeTenant();
  const c = getOrCreateContact(t.id, '5511977770009', 'Recompra');
  db.prepare(`
    INSERT INTO sales (id, tenant_id, contact_id, status, items_json, paid_at)
    VALUES (?, ?, ?, 'pago', ?, datetime('now', '-35 days'))
  `).run(randomUUID(), t.id, c.id, JSON.stringify([{ titulo: 'Perfume X', quantidade: 1, valor_unitario: 99.9 }]));

  const radar = getRevenueRadar(t.id, [{ nome: 'Perfume X', ciclo_dias: 30 }]);
  assert.equal(radar.recompra.length, 1);
  assert.equal(radar.recompra[0].produto, 'Perfume X');
});

test('getRevenueRadar não mistura dados de tenants diferentes', () => {
  const t1 = makeTenant();
  const t2 = makeTenant();
  const c1 = getOrCreateContact(t1.id, '5511977770010', 'T1');
  getOrCreateContact(t2.id, '5511977770011', 'T2');
  insertSale(t1.id, c1.id, { status: 'aguardando_pagamento' });

  const radarT2 = getRevenueRadar(t2.id, []);
  assert.deepEqual(radarT2.checkoutPendente, []);
});
