/**
 * Testes da fila persistente de envios em massa (src/outbound-queue.js e
 * tabelas outbound_jobs/outbound_job_items em src/db.js).
 *
 * Cobre: criação de job, HTTP 202, idempotência, reserva atômica de itens,
 * concorrência global vs por-tenant, retomada após "restart" (lock expirado),
 * pausa/cancelamento, retentativa com backoff, 429 com Retry-After, erro
 * permanente e recuperação de itens presos.
 */
import './_setup.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  db,
  outboundJobQueries,
  outboundJobItemQueries,
  tenantQueries,
} from '../src/db.js';
import {
  createOutboundJob,
  registerHandler,
  runner,
  drainForTesting,
  reclaimStaleLocks,
  _resetForTesting,
  outboundConfig,
} from '../src/outbound-queue.js';
import { hashPassword } from '../src/auth.js';

function makeTenant() {
  const id = 't_' + randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO tenants (id, email, password_hash, business_name, business_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, `${id}@t.com`, hashPassword('x'), 'Teste', '{}');
  return id;
}

beforeEach(() => {
  db.exec(`DELETE FROM outbound_job_items; DELETE FROM outbound_jobs;`);
  _resetForTesting();
});

test('createOutboundJob cria job pending com N itens e devolve 202-friendly payload', () => {
  const tenant = makeTenant();
  const result = createOutboundJob({
    tenantId: tenant,
    type: 'campaign',
    payload: { template_nome: 't1' },
    items: [
      { contact_id: 1, destination: '5511900000001' },
      { contact_id: 2, destination: '5511900000002' },
      { contact_id: 3, destination: '5511900000003' },
    ],
  });
  assert.match(result.job_id, /^obj_/);
  assert.equal(result.status, 'pending');
  assert.equal(result.total, 3);
  const job = outboundJobQueries.getById.get(result.job_id, tenant);
  assert.equal(job.status, 'pending');
  assert.equal(job.total_items, 3);
  assert.equal(job.pending_items, 3);
});

test('idempotency_key devolve o mesmo job em vez de duplicar', () => {
  const tenant = makeTenant();
  const first = createOutboundJob({
    tenantId: tenant, type: 'campaign',
    items: [{ contact_id: 1, destination: 'x' }],
    idempotencyKey: 'campanha-2026-07-10',
  });
  const second = createOutboundJob({
    tenantId: tenant, type: 'campaign',
    items: [{ contact_id: 1, destination: 'x' }],
    idempotencyKey: 'campanha-2026-07-10',
  });
  assert.equal(first.job_id, second.job_id);
  assert.equal(second.duplicated, true);
  const totalJobs = db.prepare(`SELECT COUNT(*) AS n FROM outbound_jobs WHERE tenant_id = ?`).get(tenant).n;
  assert.equal(totalJobs, 1);
});

test('worker processa item pending e marca como sent', async () => {
  const tenant = makeTenant();
  const sent = [];
  registerHandler('t-sent', async ({ item }) => {
    sent.push(item.destination);
    return { provider_message_id: 'wa-' + item.destination };
  });
  createOutboundJob({
    tenantId: tenant, type: 't-sent',
    items: [
      { contact_id: 11, destination: 'A' },
      { contact_id: 12, destination: 'B' },
    ],
  });
  await drainForTesting({ ticks: 40, delayMs: 20 });
  assert.deepEqual(sent.sort(), ['A', 'B']);
  const rows = outboundJobItemQueries.countByJobStatus.all(
    db.prepare(`SELECT id FROM outbound_jobs WHERE tenant_id = ?`).get(tenant).id,
  );
  const counts = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  assert.equal(counts.sent, 2);
});

test('item já enviado não é reenviado (idempotência de item)', async () => {
  const tenant = makeTenant();
  const calls = [];
  registerHandler('t-once', async ({ item }) => {
    calls.push(item.id);
    return {};
  });
  const { job_id } = createOutboundJob({
    tenantId: tenant, type: 't-once',
    items: [{ contact_id: 42, destination: 'z' }],
  });
  await drainForTesting();
  // Segunda passada não deve reenviar
  await drainForTesting();
  assert.equal(calls.length, 1);
  const job = outboundJobQueries.getById.get(job_id, tenant);
  assert.equal(job.sent_items, 1);
  assert.equal(job.status, 'completed');
});

test('erro permanente marca item como failed sem retentativa', async () => {
  const tenant = makeTenant();
  let attempts = 0;
  registerHandler('t-perm', async () => {
    attempts++;
    const err = new Error('Falha ao enviar (400): {"code":131026,"message":"not on whatsapp"}');
    err.permanent = true;
    throw err;
  });
  const { job_id } = createOutboundJob({
    tenantId: tenant, type: 't-perm',
    items: [{ contact_id: 1, destination: 'x' }],
  });
  await drainForTesting();
  assert.equal(attempts, 1);
  const job = outboundJobQueries.getById.get(job_id, tenant);
  assert.equal(job.failed_items, 1);
  assert.equal(job.status, 'completed_with_errors');
});

test('erro transitório vira retry com next_attempt_at futuro', async () => {
  const tenant = makeTenant();
  registerHandler('t-retry', async () => { throw new Error('boom'); });
  const { job_id } = createOutboundJob({
    tenantId: tenant, type: 't-retry',
    items: [{ contact_id: 1, destination: 'x' }],
  });
  await drainForTesting({ ticks: 3, delayMs: 5 });
  const item = db.prepare(`SELECT * FROM outbound_job_items WHERE job_id = ?`).get(job_id);
  assert.equal(item.status, 'retry');
  assert.ok(item.attempts >= 1);
  assert.ok(item.next_attempt_at, 'next_attempt_at deve estar preenchido');
});

test('429 com Retry-After pausa o tenant afetado', async () => {
  const tenant = makeTenant();
  let count = 0;
  registerHandler('t-429', async () => {
    count++;
    throw new Error('Falha ao enviar (429): {"retry-after":60}');
  });
  createOutboundJob({
    tenantId: tenant, type: 't-429',
    items: [{ contact_id: 1, destination: 'x' }],
  });
  await drainForTesting({ ticks: 2, delayMs: 5 });
  const pauseUntil = runner.tenantPauseUntil.get(tenant) || 0;
  assert.ok(pauseUntil > Date.now(), 'tenant deve estar pausado até depois do Retry-After');
});

test('concorrência global respeita OUTBOUND_CONCURRENCY', async () => {
  outboundConfig.concurrency = 2;
  outboundConfig.maxPerTenant = 2;
  const a = makeTenant(), b = makeTenant(), c = makeTenant();
  let peak = 0;
  let inflight = 0;
  registerHandler('t-conc', async () => {
    inflight++;
    if (inflight > peak) peak = inflight;
    await new Promise((r) => setTimeout(r, 20));
    inflight--;
    return {};
  });
  for (const t of [a, b, c]) {
    createOutboundJob({
      tenantId: t, type: 't-conc',
      items: [
        { contact_id: 1, destination: 'x1' },
        { contact_id: 2, destination: 'x2' },
      ],
    });
  }
  await drainForTesting({ ticks: 30, delayMs: 15 });
  assert.ok(peak <= outboundConfig.concurrency, `peak=${peak} deve respeitar concorrência ${outboundConfig.concurrency}`);
  outboundConfig.concurrency = 3;
  outboundConfig.maxPerTenant = 1;
});

test('round-robin entre tenants: nenhum tenant monopoliza a fila', async () => {
  outboundConfig.concurrency = 3;
  outboundConfig.maxPerTenant = 1;
  const a = makeTenant(), b = makeTenant();
  const order = [];
  registerHandler('t-fair', async ({ item, tenant }) => {
    order.push(tenant.id.slice(0, 6));
    await new Promise((r) => setTimeout(r, 5));
    return {};
  });
  // Tenant A com 5 itens; tenant B com 1 item. B deve ser atendido cedo, não
  // depois dos 5 de A.
  createOutboundJob({
    tenantId: a, type: 't-fair',
    items: [1, 2, 3, 4, 5].map((n) => ({ contact_id: n, destination: 'a' + n })),
  });
  createOutboundJob({
    tenantId: b, type: 't-fair',
    items: [{ contact_id: 99, destination: 'b1' }],
  });
  await drainForTesting({ ticks: 40, delayMs: 15 });
  const bIndex = order.findIndex((tid) => tid === b.slice(0, 6));
  assert.ok(bIndex >= 0 && bIndex <= 2, `tenant B deve ser atendido cedo (bIndex=${bIndex}, ordem=${order.join(',')})`);
});

test('reclaimStaleLocks devolve itens travados para pending após timeout', () => {
  const tenant = makeTenant();
  const { job_id } = createOutboundJob({
    tenantId: tenant, type: 'x',
    items: [{ contact_id: 1, destination: 'x' }],
  });
  const item = db.prepare(`SELECT id FROM outbound_job_items WHERE job_id = ?`).get(job_id);
  // Simula item travado há muito tempo (crash do worker no meio de um envio)
  db.prepare(`UPDATE outbound_job_items SET status='processing', locked_at=datetime('now','-1 day') WHERE id=?`).run(item.id);
  reclaimStaleLocks();
  const after = db.prepare(`SELECT status FROM outbound_job_items WHERE id=?`).get(item.id);
  assert.equal(after.status, 'pending');
});

test('pause impede novos itens de serem despachados', async () => {
  const tenant = makeTenant();
  let count = 0;
  registerHandler('t-pause', async () => { count++; return {}; });
  const { job_id } = createOutboundJob({
    tenantId: tenant, type: 't-pause',
    items: [
      { contact_id: 1, destination: 'a' },
      { contact_id: 2, destination: 'b' },
    ],
  });
  outboundJobQueries.markPaused.run(job_id, tenant);
  await drainForTesting({ ticks: 5, delayMs: 5 });
  // Pause é no nível do job. `distinctTenantsPending` só olha jobs em
  // pending/processing, então itens de job pausado não são despachados.
  assert.equal(count, 0, 'nenhum item deve rodar enquanto o job está pausado');
});

test('cancel marca job como cancelled e itens como cancelled', async () => {
  const tenant = makeTenant();
  registerHandler('t-cancel', async () => { throw new Error('should not run'); });
  const { job_id } = createOutboundJob({
    tenantId: tenant, type: 't-cancel',
    items: [{ contact_id: 1, destination: 'x' }],
  });
  outboundJobItemQueries.cancelPending.run(job_id);
  outboundJobQueries.markCancelled.run(job_id, tenant);
  outboundJobQueries.refreshCounters.run(job_id);
  await drainForTesting({ ticks: 3, delayMs: 5 });
  const job = outboundJobQueries.getById.get(job_id, tenant);
  assert.equal(job.status, 'cancelled');
  assert.equal(job.cancelled_items, 1);
});

test('retry-failed reprocessa itens que falharam', async () => {
  const tenant = makeTenant();
  let n = 0;
  registerHandler('t-retry-failed', async () => {
    n++;
    if (n <= 1) { const e = new Error('bad'); e.permanent = true; throw e; }
    return {};
  });
  const { job_id } = createOutboundJob({
    tenantId: tenant, type: 't-retry-failed',
    items: [{ contact_id: 1, destination: 'x' }],
  });
  await drainForTesting({ ticks: 20, delayMs: 20 });
  let job = outboundJobQueries.getById.get(job_id, tenant);
  assert.equal(job.failed_items, 1);
  // Retry manual dos itens falhos.
  outboundJobItemQueries.retryFailed.run(job_id);
  outboundJobQueries.refreshCounters.run(job_id);
  outboundJobQueries.updateStatus.run('pending', null, job_id);
  // Segundo drain — dá tempo suficiente pra o worker acordar e processar.
  await drainForTesting({ ticks: 40, delayMs: 20 });
  job = outboundJobQueries.getById.get(job_id, tenant);
  assert.equal(n, 2, `handler deveria ter sido chamado 2x (n=${n})`);
  assert.equal(job.sent_items, 1);
  assert.equal(job.failed_items, 0);
  assert.equal(job.status, 'completed');
});

test('isolamento entre tenants: getById só retorna se tenant bate', () => {
  const a = makeTenant();
  const b = makeTenant();
  const { job_id } = createOutboundJob({
    tenantId: a, type: 'x',
    items: [{ contact_id: 1, destination: 'x' }],
  });
  assert.ok(outboundJobQueries.getById.get(job_id, a));
  assert.equal(outboundJobQueries.getById.get(job_id, b), undefined);
});
