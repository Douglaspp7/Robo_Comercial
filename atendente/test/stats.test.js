/**
 * Regressão do bug em src/api.js /api/stats: a query de paidSalesStats
 * usava status = 'paid', mas todo o app grava 'pago'. Resultado: o
 * "Relatório de valor da IA" (receita/vendas) ficava sempre zerado.
 *
 * Este teste roda a mesma SQL exposta em api.js contra o banco de teste
 * para garantir que ambas as grafias são contadas e que receita usa
 * COALESCE entre amount (reais) e total_cents/100 (novas vendas só
 * gravam total_cents).
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries } from '../src/db.js';

const PAID_STATS_SQL = `SELECT
   COUNT(*) AS total_vendas,
   COALESCE(SUM(COALESCE(amount, total_cents / 100.0)), 0) AS receita_total
 FROM sales WHERE tenant_id = ? AND status IN ('pago', 'paid')`;

function makeTenant() {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`)
    .run(id, `${id}@stats-test.com`);
  return tenantQueries.byId.get(id);
}

function insertSale(tenantId, { status, amount = null, total_cents = null, id = randomUUID() }) {
  db.prepare(`INSERT INTO sales (id, tenant_id, status, amount, total_cents) VALUES (?, ?, ?, ?, ?)`)
    .run(id, tenantId, status, amount, total_cents);
}

test('paidSalesStats conta status pago e paid, e soma reais + centavos', () => {
  const t = makeTenant();
  // Fluxo normal (webhook grava 'pago', total_cents preenchido).
  insertSale(t.id, { status: 'pago', total_cents: 8990 });   // R$ 89,90
  insertSale(t.id, { status: 'pago', total_cents: 6990 });   // R$ 69,90
  // Registro herdado que usava 'paid' + amount em reais.
  insertSale(t.id, { status: 'paid', amount: 42.9 });
  // Ruído: vendas não pagas nunca devem contar.
  insertSale(t.id, { status: 'rascunho', total_cents: 10000 });
  insertSale(t.id, { status: 'aguardando_pagamento', total_cents: 5000 });

  const stats = db.prepare(PAID_STATS_SQL).get(t.id);

  assert.equal(stats.total_vendas, 3, 'conta as 3 vendas pagas (pago + paid)');
  assert.equal(Number(stats.receita_total).toFixed(2), '202.70', 'soma 89,90 + 69,90 + 42,90');
});

test('paidSalesStats retorna 0 sem vendas pagas (nunca null)', () => {
  const t = makeTenant();
  insertSale(t.id, { status: 'rascunho', total_cents: 10000 });

  const stats = db.prepare(PAID_STATS_SQL).get(t.id);
  assert.equal(stats.total_vendas, 0);
  assert.equal(Number(stats.receita_total), 0);
});
