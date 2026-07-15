/**
 * Testes da fila de IA justa entre tenants (src/queue.js — FairQueue).
 * Usa a classe direto (sem o singleton) para controlar limites e concorrência.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FairQueue, aiQueue } from '../src/queue.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function drain(queue) {
  while (queue.pending > 0) await tick();
}

// Job que registra sua execução num array compartilhado.
const track = (order, label) => () => { order.push(label); };

// Cria um job "bloqueador" que só termina quando release() for chamado.
function blocker() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return { job: () => gate, release };
}

test('round-robin: tenant pequeno não espera o backlog do tenant grande', async () => {
  const q = new FairQueue({ concurrency: 1 });
  const { job, release } = blocker();
  const order = [];

  q.add(job, { tenantId: 'A', type: 'mensagem' }); // ocupa o worker
  await tick();
  for (let i = 1; i <= 5; i++) q.add(track(order, `A${i}`), { tenantId: 'A' });
  q.add(track(order, 'B1'), { tenantId: 'B' });

  release();
  await drain(q);

  // B1 executa antes do backlog de A terminar (no máximo na 2ª posição).
  assert.ok(order.indexOf('B1') <= 1, `ordem: ${order.join(',')}`);
  assert.ok(order.indexOf('B1') < order.indexOf('A2'), `ordem: ${order.join(',')}`);
  assert.deepEqual([...order].sort(), ['A1', 'A2', 'A3', 'A4', 'A5', 'B1']);
});

test('round-robin alterna entre vários tenants', async () => {
  const q = new FairQueue({ concurrency: 1 });
  const { job, release } = blocker();
  const order = [];

  q.add(job, { tenantId: 'A' });
  await tick();
  q.add(track(order, 'A1'), { tenantId: 'A' });
  q.add(track(order, 'A2'), { tenantId: 'A' });
  q.add(track(order, 'B1'), { tenantId: 'B' });
  q.add(track(order, 'B2'), { tenantId: 'B' });
  q.add(track(order, 'C1'), { tenantId: 'C' });

  release();
  await drain(q);

  // Uma passada completa por tenant antes de repetir (o ponto de partida da
  // rotação pode variar, mas ninguém repete antes de todos rodarem uma vez).
  assert.deepEqual(new Set(order.slice(0, 3)), new Set(['A1', 'B1', 'C1']), `ordem: ${order.join(',')}`);
  assert.deepEqual(new Set(order.slice(3)), new Set(['A2', 'B2']), `ordem: ${order.join(',')}`);
});

test('prioridade: high fura a fila de normal/low dentro do tenant', async () => {
  const q = new FairQueue({ concurrency: 1 });
  const { job, release } = blocker();
  const order = [];

  q.add(job, { tenantId: 'A' });
  await tick();
  q.add(track(order, 'low'), { tenantId: 'A', priority: 'low' });
  q.add(track(order, 'normal'), { tenantId: 'A', priority: 'normal' });
  q.add(track(order, 'high'), { tenantId: 'A', priority: 'high' });

  release();
  await drain(q);
  assert.deepEqual(order, ['high', 'normal', 'low']);
});

test('aging: low não sofre starvation atrás de um fluxo contínuo de high', async () => {
  const q = new FairQueue({ concurrency: 1, agingMs: 10 });
  const { job, release } = blocker();
  const order = [];

  q.add(job, { tenantId: 'A' });
  await tick();
  q.add(track(order, 'low-antigo'), { tenantId: 'A', priority: 'low' });
  // Espera o low envelhecer 2 níveis (rank 2 → efetivo 0).
  await new Promise((resolve) => setTimeout(resolve, 35));
  q.add(track(order, 'high-novo'), { tenantId: 'A', priority: 'high' });

  release();
  await drain(q);
  // Empate de prioridade efetiva → FIFO: o low mais antigo executa primeiro.
  assert.equal(order[0], 'low-antigo');
});

test('limite global: recusa sem lançar e conta em rejected', async () => {
  const q = new FairQueue({ concurrency: 1, maxGlobal: 2 });
  const { job, release } = blocker();
  q.add(job, { tenantId: 'A' });
  await tick();

  assert.equal(q.add(() => {}, { tenantId: 'A' }).ok, true);
  assert.equal(q.add(() => {}, { tenantId: 'B' }).ok, true);
  const rejected = q.add(() => {}, { tenantId: 'C' });
  assert.deepEqual(rejected, { ok: false, reason: 'global_limit' });
  assert.equal(q.metrics().rejected_total, 1);

  release();
  await drain(q);
});

test('limite por tenant: um tenant lotado não impede outro de enfileirar', async () => {
  const q = new FairQueue({ concurrency: 1, maxPerTenant: 1 });
  const { job, release } = blocker();
  const rejections = [];
  q.onReject = (reason, meta) => rejections.push({ reason, tenantId: meta.tenantId });

  q.add(job, { tenantId: 'A' });
  await tick();
  assert.equal(q.add(() => {}, { tenantId: 'A' }).ok, true);
  const rejected = q.add(() => {}, { tenantId: 'A' });
  assert.deepEqual(rejected, { ok: false, reason: 'tenant_limit' });
  assert.equal(q.add(() => {}, { tenantId: 'B' }).ok, true, 'outro tenant continua aceito');

  assert.deepEqual(rejections, [{ reason: 'tenant_limit', tenantId: 'A' }]);

  release();
  await drain(q);
});

test('erro em um job não interrompe a fila nem derruba o processo', async () => {
  const q = new FairQueue({ concurrency: 1 });
  const order = [];
  q.add(() => { throw new Error('boom'); }, { tenantId: 'A' });
  q.add(async () => { throw new Error('boom async'); }, { tenantId: 'A' });
  q.add(track(order, 'depois'), { tenantId: 'B' });
  await drain(q);

  assert.deepEqual(order, ['depois']);
  const m = q.metrics();
  assert.equal(m.errors_total, 2);
  assert.equal(m.completed_total, 1);
});

test('respeita o limite global de concorrência', async () => {
  const q = new FairQueue({ concurrency: 2 });
  let running = 0;
  let maxRunning = 0;
  const job = async () => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((resolve) => setTimeout(resolve, 10));
    running--;
  };
  for (let i = 0; i < 6; i++) q.add(job, { tenantId: `T${i % 3}` });
  await drain(q);
  assert.equal(maxRunning, 2);
  assert.equal(q.metrics().completed_total, 6);
});

test('métricas agregadas: pending, tenants_waiting, maior fila, esperas', async () => {
  const q = new FairQueue({ concurrency: 1, agingMs: 1000 });
  const { job, release } = blocker();
  q.add(job, { tenantId: 'A' });
  await tick();
  q.add(() => {}, { tenantId: 'A' });
  q.add(() => {}, { tenantId: 'A' });
  q.add(() => {}, { tenantId: 'B' });

  const m = q.metrics();
  assert.equal(m.pending, 3);
  assert.equal(m.running, 1);
  assert.equal(m.tenants_waiting, 2);
  assert.equal(m.largest_tenant_queue, 2);
  assert.ok(m.oldest_wait_ms >= 0);
  assert.equal(m.rejected_total, 0);
  // Nenhum campo com dado pessoal ou id de tenant.
  assert.deepEqual(
    Object.keys(m).sort(),
    ['avg_wait_ms', 'completed_total', 'errors_total', 'largest_tenant_queue',
      'oldest_wait_ms', 'pending', 'rejected_total', 'running', 'tenants_waiting'].sort()
  );

  release();
  await drain(q);
  // 3 jobs enfileirados + o bloqueador.
  assert.equal(q.metrics().completed_total, 4);
});

test('jobs globais sem tenantId caem no tenant "platform" e executam', async () => {
  const q = new FairQueue({ concurrency: 1 });
  const order = [];
  q.add(track(order, 'global')); // sem metadados — compatibilidade
  await drain(q);
  assert.deepEqual(order, ['global']);
});

test('singleton aiQueue usa a concorrência do config e expõe pending', () => {
  assert.ok(aiQueue instanceof FairQueue);
  assert.equal(typeof aiQueue.pending, 'number');
  assert.equal(typeof aiQueue.metrics, 'function');
});
