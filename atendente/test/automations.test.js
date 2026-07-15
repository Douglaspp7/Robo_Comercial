import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db,
  tenantQueries,
  contactQueries,
  contactTagQueries,
  saleQueries,
  notificationQueries,
  automationQueries,
  automationEventQueries,
  automationJobQueries,
  automationRunQueries,
  getOrCreateContact,
  decryptTenant,
} from '../src/db.js';
import { validateAutomation } from '../src/automations/schema.js';
import {
  emitDomainEvent,
  handleInboundMessageForAutomations,
  cancelPendingJobsForSale,
  MAX_CHAIN_DEPTH,
} from '../src/domain-events.js';
import {
  evaluateCondition,
  evaluateConditions,
  executeAction,
  runAutomationForEvent,
  dryRunAutomation,
  actionPlanBlock,
} from '../src/automations/engine.js';
import {
  drainAutomationsForTesting,
  reclaimStaleAutomationLocks,
  automationHealthMetrics,
  _resetAutomationRunnerForTesting,
} from '../src/automations/worker.js';
import { PLAN_LIMITS } from '../src/plans.js';
import { outboundJobQueries } from '../src/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeTenant({ plan = 'elite', status = 'active', businessJson = null } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO tenants (id, email, password_hash, plan, subscription_status, business_json)
    VALUES (?, ?, 'h', ?, ?, ?)
  `).run(id, `${id}@test.com`, plan, status, businessJson || '{}');
  return decryptTenant(tenantQueries.byId.get(id));
}

function makeAutomation(tenant, overrides = {}) {
  const id = 'aut_' + randomUUID().replace(/-/g, '').slice(0, 24);
  automationQueries.insert.run({
    id,
    tenant_id: tenant.id,
    name: overrides.name || 'Teste',
    description: null,
    enabled: overrides.enabled ?? 1,
    trigger_type: overrides.trigger_type || 'contact_created',
    trigger_config_json: JSON.stringify(overrides.trigger_config || {}),
    conditions_json: JSON.stringify(overrides.conditions || []),
    actions_json: JSON.stringify(overrides.actions || [{ type: 'add_tag', tag: 'auto-teste' }]),
    cooldown_seconds: overrides.cooldown_seconds ?? 0,
  });
  return automationQueries.byId.get(id, tenant.id);
}

function makeEvent(tenant, { type = 'contact_created', entityType = 'contact', entityId, payload = {}, chainDepth = 0 } = {}) {
  const id = 'aev_' + randomUUID().replace(/-/g, '').slice(0, 24);
  automationEventQueries.insert.run({
    id,
    tenant_id: tenant.id,
    event_type: type,
    entity_type: entityType,
    entity_id: entityId != null ? String(entityId) : null,
    payload_json: JSON.stringify(payload),
    origin: 'system',
    chain_depth: chainDepth,
  });
  return automationEventQueries.byId.get(id);
}

// ── Validação (allowlists) ───────────────────────────────────────────────────

test('validateAutomation aceita automação válida e normaliza defaults', () => {
  const data = validateAutomation({
    name: 'Lembrete',
    trigger_type: 'checkout_sent',
    trigger_config: { delay_minutes: 60 },
    actions: [{ type: 'add_tag', tag: 'retorno-pendente' }],
  });
  assert.equal(data.trigger_type, 'checkout_sent');
  assert.deepEqual(data.conditions, []);
  assert.equal(data.cooldown_seconds, 0);
});

test('validateAutomation rejeita gatilho/condição/ação fora da allowlist e campos extras', () => {
  assert.throws(() => validateAutomation({ name: 'X', trigger_type: 'evil_trigger', actions: [{ type: 'add_tag', tag: 'a' }] }));
  assert.throws(() => validateAutomation({ name: 'X', trigger_type: 'sale_paid', actions: [{ type: 'run_code', code: 'x' }] }));
  assert.throws(() => validateAutomation({
    name: 'X', trigger_type: 'sale_paid',
    conditions: [{ type: 'sql_injection', value: '1; DROP TABLE' }],
    actions: [{ type: 'add_tag', tag: 'a' }],
  }));
  // URL arbitrária em webhook não existe no schema:
  assert.throws(() => validateAutomation({
    name: 'X', trigger_type: 'sale_paid',
    actions: [{ type: 'dispatch_existing_webhook', url: 'https://evil.com' }],
  }));
  // sem ações:
  assert.throws(() => validateAutomation({ name: 'X', trigger_type: 'sale_paid', actions: [] }));
  // nome gigante:
  assert.throws(() => validateAutomation({ name: 'x'.repeat(200), trigger_type: 'sale_paid', actions: [{ type: 'pause_ai' }] }));
});

test('validateAutomation exige idle_minutes para contact_idle', () => {
  assert.throws(() => validateAutomation({ name: 'Idle', trigger_type: 'contact_idle', actions: [{ type: 'pause_ai' }] }));
  const ok = validateAutomation({
    name: 'Idle', trigger_type: 'contact_idle',
    trigger_config: { idle_minutes: 30 },
    actions: [{ type: 'pause_ai' }],
  });
  assert.equal(ok.trigger_config.idle_minutes, 30);
});

// ── Event bus + agendamento ──────────────────────────────────────────────────

test('emitDomainEvent agenda job para automação ativa do gatilho (e só dela)', () => {
  const t = makeTenant();
  makeAutomation(t, { trigger_type: 'sale_paid' });
  makeAutomation(t, { trigger_type: 'contact_created' });
  makeAutomation(t, { trigger_type: 'sale_paid', enabled: 0 }); // desativada: nada

  const { eventId, jobs } = emitDomainEvent({ tenantId: t.id, type: 'sale_paid', entityType: 'sale', entityId: 's1' });
  assert.ok(eventId);
  assert.equal(jobs, 1);
});

test('emitDomainEvent com delay agenda run_at futuro', () => {
  const t = makeTenant();
  const a = makeAutomation(t, { trigger_type: 'checkout_sent', trigger_config: { delay_minutes: 60 } });
  emitDomainEvent({ tenantId: t.id, type: 'checkout_sent', entityType: 'sale', entityId: 's2' });
  const job = db.prepare(`SELECT * FROM automation_jobs WHERE automation_id = ?`).get(a.id);
  assert.ok(job.run_at > new Date().toISOString().replace('T', ' ').slice(0, 19));
});

test('chain depth: no limite, evento é auditado mas não agenda jobs (anti-loop)', () => {
  const t = makeTenant();
  makeAutomation(t, { trigger_type: 'stage_changed' });
  const r1 = emitDomainEvent({ tenantId: t.id, type: 'stage_changed', entityType: 'contact', entityId: 1, chainDepth: MAX_CHAIN_DEPTH });
  assert.equal(r1.jobs, 0);
  const r2 = emitDomainEvent({ tenantId: t.id, type: 'stage_changed', entityType: 'contact', entityId: 1, chainDepth: 0 });
  assert.equal(r2.jobs, 1);
});

test('automação não reage a evento originado por ela mesma', () => {
  const t = makeTenant();
  const a = makeAutomation(t, { trigger_type: 'stage_changed' });
  const r = emitDomainEvent({
    tenantId: t.id, type: 'stage_changed', entityType: 'contact', entityId: 1,
    origin: `automation:${a.id}`, chainDepth: 1,
  });
  assert.equal(r.jobs, 0);
});

test('isolamento: evento de um tenant nunca agenda automação de outro', () => {
  const a = makeTenant();
  const b = makeTenant();
  makeAutomation(b, { trigger_type: 'sale_paid' });
  const r = emitDomainEvent({ tenantId: a.id, type: 'sale_paid', entityType: 'sale', entityId: 's3' });
  assert.equal(r.jobs, 0);
});

// ── Condições ────────────────────────────────────────────────────────────────

test('todas as condições do MVP avaliam contra o estado atual', () => {
  const t = makeTenant({
    businessJson: JSON.stringify({ horario_atendimento: { ativo: false } }),
  });
  const contact = getOrCreateContact(t.id, '5511911110001', 'Cliente');
  db.prepare(`UPDATE contacts SET stage = 'negociacao', buy_intent = 'alta', lead_source = 'instagram', tipo_cliente = 'revendedor', last_produto_mencionado = 'Vela Lavanda' WHERE id = ?`).run(contact.id);
  contactTagQueries.add.run(t.id, contact.id, 'vip');
  const fresh = contactQueries.byId.get(contact.id);
  const saleId = randomUUID();
  saleQueries.create.run({
    id: saleId, tenant_id: t.id, contact_id: contact.id, status: 'checkout_enviado',
    items_json: '[]', total_cents: 25000, checkout_url: '', payment_provider: '',
    external_payment_id: '', notes: '', amount: 250, items: '[]', mp_preference_id: '',
  });
  const sale = saleQueries.byId.get(saleId);
  const ctx = { tenant: t, contact: fresh, sale, payload: {} };

  const cases = [
    [{ type: 'stage_equals', value: 'negociacao' }, true],
    [{ type: 'stage_equals', value: 'fechado' }, false],
    [{ type: 'stage_in', values: ['negociacao', 'checkout'] }, true],
    [{ type: 'stage_in', values: ['novo_contato'] }, false],
    [{ type: 'buy_intent_equals', value: 'alta' }, true],
    [{ type: 'has_tag', value: 'vip' }, true],
    [{ type: 'has_tag', value: 'fantasma' }, false],
    [{ type: 'does_not_have_tag', value: 'fantasma' }, true],
    [{ type: 'product_equals', value: 'Vela Lavanda' }, true],
    [{ type: 'sale_amount_greater_than', value: 100 }, true],
    [{ type: 'sale_amount_greater_than', value: 500 }, false],
    [{ type: 'sale_amount_less_than', value: 500 }, true],
    [{ type: 'origin_equals', value: 'instagram' }, true],
    [{ type: 'customer_type_equals', value: 'revendedor' }, true],
    [{ type: 'within_business_hours' }, true],  // sem config = sempre dentro
    [{ type: 'outside_business_hours' }, false],
  ];
  for (const [condition, expected] of cases) {
    assert.equal(evaluateCondition(condition, ctx).pass, expected, JSON.stringify(condition));
  }
});

test('múltiplas condições em AND: uma reprovada reprova o conjunto', () => {
  const t = makeTenant();
  const contact = getOrCreateContact(t.id, '5511911110002', 'AND');
  db.prepare(`UPDATE contacts SET stage = 'checkout', buy_intent = 'alta' WHERE id = ?`).run(contact.id);
  const ctx = { tenant: t, contact: contactQueries.byId.get(contact.id), sale: null, payload: {} };
  const both = evaluateConditions([
    { type: 'stage_equals', value: 'checkout' },
    { type: 'buy_intent_equals', value: 'alta' },
  ], ctx);
  assert.equal(both.pass, true);
  const oneFails = evaluateConditions([
    { type: 'stage_equals', value: 'checkout' },
    { type: 'buy_intent_equals', value: 'baixa' },
  ], ctx);
  assert.equal(oneFails.pass, false);
  assert.equal(oneFails.results.length, 2);
});

// ── Ações ────────────────────────────────────────────────────────────────────

test('ações de tag/etapa/IA alteram o contato do próprio tenant', async () => {
  const t = makeTenant();
  const contact = getOrCreateContact(t.id, '5511911110003', 'Ações');
  const automation = makeAutomation(t, { trigger_type: 'contact_created' });
  const event = makeEvent(t, { entityId: contact.id });
  const ctx = { tenant: t, automation, event, contact: contactQueries.byId.get(contact.id), sale: null };

  assert.equal((await executeAction({ type: 'add_tag', tag: 'Quente' }, ctx)).status, 'success');
  assert.ok(contactTagQueries.byContact.all(contact.id).some((r) => r.tag === 'quente'));

  assert.equal((await executeAction({ type: 'change_stage', stage: 'negociacao' }, ctx)).status, 'success');
  assert.equal(contactQueries.byId.get(contact.id).stage, 'negociacao');

  assert.equal((await executeAction({ type: 'pause_ai' }, ctx)).status, 'success');
  assert.equal(contactQueries.byId.get(contact.id).needs_human, 1);
  assert.equal((await executeAction({ type: 'resume_ai' }, ctx)).status, 'success');
  assert.equal(contactQueries.byId.get(contact.id).needs_human, 0);

  assert.equal((await executeAction({ type: 'remove_tag', tag: 'quente' }, ctx)).status, 'success');
  assert.ok(!contactTagQueries.byContact.all(contact.id).some((r) => r.tag === 'quente'));

  assert.equal((await executeAction({ type: 'create_internal_notification', title: 'Oi' }, ctx)).status, 'success');
});

test('change_stage emite evento derivado com chain_depth+1 e origem da automação', async () => {
  const t = makeTenant();
  const contact = getOrCreateContact(t.id, '5511911110004', 'Chain');
  const automation = makeAutomation(t, { trigger_type: 'contact_created' });
  const event = makeEvent(t, { entityId: contact.id, chainDepth: 0 });
  await executeAction({ type: 'change_stage', stage: 'orcamento' },
    { tenant: t, automation, event, contact: contactQueries.byId.get(contact.id), sale: null });
  const derived = db.prepare(`
    SELECT * FROM automation_events WHERE tenant_id = ? AND event_type = 'stage_changed' AND origin = ?
  `).get(t.id, `automation:${automation.id}`);
  assert.ok(derived);
  assert.equal(derived.chain_depth, 1);
});

test('send_whatsapp_template usa só template cadastrado e entra na fila persistente', async () => {
  const t = makeTenant({
    plan: 'elite',
    businessJson: JSON.stringify({ whatsappTemplates: [{ nome: 'lembrete_v1', idioma: 'pt_BR', categoria: 'utility', corpo: 'Oi {{1}}' }] }),
  });
  const contact = getOrCreateContact(t.id, '5511911110005', 'Template');
  const automation = makeAutomation(t, { trigger_type: 'checkout_sent' });
  const event = makeEvent(t, { type: 'checkout_sent', entityType: 'contact', entityId: contact.id });
  const ctx = { tenant: t, automation, event, contact: contactQueries.byId.get(contact.id), sale: null };

  const ok = await executeAction({ type: 'send_whatsapp_template', template_nome: 'lembrete_v1' }, ctx);
  assert.equal(ok.status, 'success');
  const job = db.prepare(`SELECT * FROM outbound_jobs WHERE tenant_id = ? AND type = 'automation_template'`).get(t.id);
  assert.ok(job, 'job na fila persistente de saída');

  // Template ausente → falha permanente com explicação (sem retry).
  const missing = await executeAction({ type: 'send_whatsapp_template', template_nome: 'nao_existe' }, ctx);
  assert.equal(missing.status, 'failed_permanent');
  assert.match(missing.result.reason, /não está cadastrado/);
});

test('send_whatsapp_template é bloqueado por plano abaixo de Elite (com explicação)', async () => {
  const t = makeTenant({ plan: 'essencial', status: 'active' });
  assert.match(actionPlanBlock({ type: 'send_whatsapp_template', template_nome: 'x' }, t), /Elite/);
  const contact = getOrCreateContact(t.id, '5511911110006', 'Bloqueado');
  const automation = makeAutomation(t, { trigger_type: 'sale_paid' });
  const event = makeEvent(t, { type: 'sale_paid', entityType: 'contact', entityId: contact.id });
  const r = await executeAction({ type: 'send_whatsapp_template', template_nome: 'x' },
    { tenant: t, automation, event, contact, sale: null });
  assert.equal(r.status, 'blocked_plan');
});

test('trial usa plano efetivo Elite: template liberado durante o trial', () => {
  const trialEnds = new Date(Date.now() + 3 * 86400000).toISOString();
  const t = makeTenant({ plan: 'essencial', status: 'trialing' });
  db.prepare(`UPDATE tenants SET trial_ends_at = ? WHERE id = ?`).run(trialEnds, t.id);
  const fresh = decryptTenant(tenantQueries.byId.get(t.id));
  assert.equal(actionPlanBlock({ type: 'send_whatsapp_template', template_nome: 'x' }, fresh), null);
});

test('dispatch_existing_webhook sem webhook configurado vira skipped explicado', async () => {
  const t = makeTenant();
  const automation = makeAutomation(t, { trigger_type: 'sale_paid' });
  const event = makeEvent(t, { type: 'sale_paid', entityType: 'sale', entityId: 'sx' });
  const r = await executeAction({ type: 'dispatch_existing_webhook' },
    { tenant: t, automation, event, contact: null, sale: null });
  assert.equal(r.status, 'skipped');
  assert.match(r.result.reason, /não configurado/i);
});

// ── Execução completa: dedupe, cooldown, condições ───────────────────────────

test('runAutomationForEvent executa, registra run + ações e deduplica repetição', async () => {
  const t = makeTenant();
  const contact = getOrCreateContact(t.id, '5511911110007', 'Run');
  const automation = makeAutomation(t, {
    trigger_type: 'contact_created',
    actions: [{ type: 'add_tag', tag: 'novo' }, { type: 'create_internal_notification' }],
  });
  const event = makeEvent(t, { entityId: contact.id });

  const r1 = await runAutomationForEvent({ tenant: t, automation, event });
  assert.equal(r1.status, 'success');
  const run = automationRunQueries.byId.get(r1.runId, t.id);
  assert.equal(run.status, 'success');
  assert.equal(automationRunQueries.actionsByRun.all(r1.runId).length, 2);

  // Mesma automação + mesmo evento → dedupe.
  const r2 = await runAutomationForEvent({ tenant: t, automation, event });
  assert.equal(r2.status, 'skipped');
  assert.match(r2.reason, /dedupe/);
});

test('condições não atendidas → run skipped sem executar ações', async () => {
  const t = makeTenant();
  const contact = getOrCreateContact(t.id, '5511911110008', 'Skip');
  const automation = makeAutomation(t, {
    trigger_type: 'contact_created',
    conditions: [{ type: 'stage_equals', value: 'fechado' }],
    actions: [{ type: 'add_tag', tag: 'nunca' }],
  });
  const event = makeEvent(t, { entityId: contact.id });
  const r = await runAutomationForEvent({ tenant: t, automation, event });
  assert.equal(r.status, 'skipped');
  assert.ok(!contactTagQueries.byContact.all(contact.id).some((x) => x.tag === 'nunca'));
});

test('cooldown: segunda execução para a mesma entidade dentro da janela é pulada', async () => {
  const t = makeTenant();
  const contact = getOrCreateContact(t.id, '5511911110009', 'Cool');
  const automation = makeAutomation(t, { trigger_type: 'stage_changed', cooldown_seconds: 3600 });
  const e1 = makeEvent(t, { type: 'stage_changed', entityId: contact.id });
  const e2 = makeEvent(t, { type: 'stage_changed', entityId: contact.id });
  assert.equal((await runAutomationForEvent({ tenant: t, automation, event: e1 })).status, 'success');
  const r2 = await runAutomationForEvent({ tenant: t, automation, event: e2 });
  assert.equal(r2.status, 'skipped');
  assert.match(r2.reason, /cooldown/);
});

// ── Worker persistente ───────────────────────────────────────────────────────

test('worker: job agendado é executado e sobrevive a "reinício" (linha persistida)', async () => {
  _resetAutomationRunnerForTesting();
  const t = makeTenant();
  const contact = getOrCreateContact(t.id, '5511911110010', 'Worker');
  makeAutomation(t, { trigger_type: 'handoff_requested', actions: [{ type: 'add_tag', tag: 'humano' }] });
  emitDomainEvent({ tenantId: t.id, type: 'handoff_requested', entityType: 'contact', entityId: contact.id });

  // O job está no SQLite (não em memória): um restart não perde nada.
  const pending = db.prepare(`SELECT * FROM automation_jobs WHERE tenant_id = ? AND status = 'pending'`).all(t.id);
  assert.equal(pending.length, 1);

  await drainAutomationsForTesting();
  const done = db.prepare(`SELECT * FROM automation_jobs WHERE tenant_id = ?`).get(t.id);
  assert.equal(done.status, 'done');
  assert.ok(contactTagQueries.byContact.all(contact.id).some((r) => r.tag === 'humano'));
});

test('worker: automação pausada cancela o job sem executar', async () => {
  _resetAutomationRunnerForTesting();
  const t = makeTenant();
  const contact = getOrCreateContact(t.id, '5511911110011', 'Pausada');
  const automation = makeAutomation(t, { trigger_type: 'sale_paid', actions: [{ type: 'add_tag', tag: 'pago' }] });
  emitDomainEvent({ tenantId: t.id, type: 'sale_paid', entityType: 'contact', entityId: contact.id });
  automationQueries.setEnabled.run({ id: automation.id, tenant_id: t.id, enabled: 0 });

  await drainAutomationsForTesting();
  const job = db.prepare(`SELECT * FROM automation_jobs WHERE tenant_id = ?`).get(t.id);
  assert.equal(job.status, 'cancelled');
  assert.ok(!contactTagQueries.byContact.all(contact.id).some((r) => r.tag === 'pago'));
});

test('lock expirado volta para retry (recuperação de worker morto)', () => {
  const t = makeTenant();
  makeAutomation(t, { trigger_type: 'sale_paid' });
  emitDomainEvent({ tenantId: t.id, type: 'sale_paid', entityType: 'sale', entityId: 'lock1' });
  const job = db.prepare(`SELECT * FROM automation_jobs WHERE tenant_id = ?`).get(t.id);
  db.prepare(`UPDATE automation_jobs SET status = 'processing', locked_at = datetime('now', '-1 hour') WHERE id = ?`).run(job.id);
  reclaimStaleAutomationLocks();
  assert.equal(automationJobQueries.byId.get(job.id).status, 'retry');
});

// ── contact_idle: persistência e cancelamentos ───────────────────────────────

test('contact_idle agenda job futuro; nova mensagem cancela e reagenda', () => {
  const t = makeTenant();
  const contact = getOrCreateContact(t.id, '5511911110012', 'Idle');
  makeAutomation(t, {
    trigger_type: 'contact_idle',
    trigger_config: { idle_minutes: 30 },
    actions: [{ type: 'create_internal_notification' }],
  });

  handleInboundMessageForAutomations(t, contact);
  let jobs = db.prepare(`SELECT * FROM automation_jobs WHERE tenant_id = ? AND status = 'pending'`).all(t.id);
  assert.equal(jobs.length, 1);
  assert.ok(jobs[0].run_at > new Date().toISOString().replace('T', ' ').slice(0, 19), 'agendado para o futuro');
  const firstJobId = jobs[0].id;

  // Cliente respondeu de novo: job antigo cancelado, novo agendado.
  handleInboundMessageForAutomations(t, contact);
  assert.equal(automationJobQueries.byId.get(firstJobId).status, 'cancelled');
  jobs = db.prepare(`SELECT * FROM automation_jobs WHERE tenant_id = ? AND status = 'pending'`).all(t.id);
  assert.equal(jobs.length, 1);
});

test('pagamento cancela contact_idle pendente e lembretes da venda', () => {
  const t = makeTenant();
  const contact = getOrCreateContact(t.id, '5511911110013', 'IdlePay');
  makeAutomation(t, { trigger_type: 'contact_idle', trigger_config: { idle_minutes: 30 }, actions: [{ type: 'pause_ai' }] });
  makeAutomation(t, { trigger_type: 'checkout_sent', trigger_config: { delay_minutes: 1440 }, actions: [{ type: 'create_internal_notification' }] });

  handleInboundMessageForAutomations(t, contact);
  emitDomainEvent({ tenantId: t.id, type: 'checkout_sent', entityType: 'sale', entityId: 'sale-idle-1' });
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM automation_jobs WHERE tenant_id = ? AND status = 'pending'`).get(t.id).n, 2);

  cancelPendingJobsForSale(t.id, 'sale-idle-1', contact.id);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM automation_jobs WHERE tenant_id = ? AND status = 'pending'`).get(t.id).n, 0);
});

test('contact_idle no run: cliente respondeu depois do agendamento → skip (guarda de corrida)', async () => {
  const t = makeTenant();
  const contact = getOrCreateContact(t.id, '5511911110014', 'Race');
  const automation = makeAutomation(t, { trigger_type: 'contact_idle', trigger_config: { idle_minutes: 30 }, actions: [{ type: 'pause_ai' }] });
  // Evento agendado "há 2 horas"; contato respondeu depois disso.
  const event = makeEvent(t, {
    type: 'contact_idle', entityId: contact.id,
    payload: { message_version: new Date(Date.now() - 2 * 3600_000).toISOString() },
  });
  db.prepare(`UPDATE contacts SET last_message_at = datetime('now') WHERE id = ?`).run(contact.id);
  const r = await runAutomationForEvent({ tenant: t, automation, event });
  assert.equal(r.status, 'skipped');
  assert.match(r.reason, /respondeu/);
});

// ── Dry run ──────────────────────────────────────────────────────────────────

test('dry run mostra condições/ações e NÃO executa nenhum efeito', () => {
  const t = makeTenant({ plan: 'essencial', status: 'active' });
  const contact = getOrCreateContact(t.id, '5511911110015', 'Dry');
  db.prepare(`UPDATE contacts SET stage = 'negociacao' WHERE id = ?`).run(contact.id);
  const automation = makeAutomation(t, {
    trigger_type: 'stage_changed',
    conditions: [{ type: 'stage_equals', value: 'negociacao' }],
    actions: [{ type: 'add_tag', tag: 'dry' }, { type: 'send_whatsapp_template', template_nome: 'x' }],
  });

  const before = db.prepare(`SELECT COUNT(*) n FROM contact_tags WHERE tenant_id = ?`).get(t.id).n;
  const notifBefore = notificationQueries.listByTenant.all(t.id).length;
  const result = dryRunAutomation({ tenant: t, automation, contactId: contact.id });

  assert.equal(result.dry_run, true);
  assert.equal(result.conditions_pass, true);
  assert.equal(result.actions[0].would_run, true);
  assert.equal(result.actions[1].would_run, false); // bloqueada por plano
  assert.match(result.actions[1].blocked_reason, /Elite/);
  // Nenhum efeito colateral:
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM contact_tags WHERE tenant_id = ?`).get(t.id).n, before);
  assert.equal(notificationQueries.listByTenant.all(t.id).length, notifBefore);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM automation_runs WHERE tenant_id = ?`).get(t.id).n, 0);
});

// ── Limites por plano / métricas / rotas ─────────────────────────────────────

test('limite de automações ativas por plano está definido para todos os planos', () => {
  assert.equal(PLAN_LIMITS.essencial.automationMaxActive, 2);
  assert.equal(PLAN_LIMITS.pro.automationMaxActive, 10);
  assert.equal(PLAN_LIMITS.elite.automationMaxActive, 30);
  assert.equal(PLAN_LIMITS.especial.automationMaxActive, 100);
});

test('automationHealthMetrics devolve só agregados', () => {
  const m = automationHealthMetrics();
  assert.deepEqual(Object.keys(m).sort(), ['events_pending', 'jobs_failed', 'jobs_pending', 'jobs_processing', 'runs_last_24h']);
  for (const v of Object.values(m)) assert.equal(typeof v, 'number');
});

test('todas as rotas /api/automations exigem auth (e CSRF nas mutações); test tem rate limit', () => {
  const api = readFileSync(join(__dirname, '..', 'src', 'api.js'), 'utf8');
  const routes = api.match(/apiRouter\.(get|post|put|delete)\('\/api\/automations[^']*'[^\n]*/g) || [];
  assert.ok(routes.length >= 10, `esperava >=10 rotas, achei ${routes.length}`);
  for (const route of routes) {
    assert.ok(route.includes('requireAuth'), `rota sem requireAuth: ${route}`);
    if (/apiRouter\.(post|put|delete)/.test(route)) {
      assert.ok(route.includes('requireCsrf'), `mutação sem requireCsrf: ${route}`);
    }
  }
  const testRoute = routes.find((r) => r.includes('/test'));
  assert.ok(/Limiter/.test(testRoute), 'rota de teste deve ter rate limit');
});

test('paginação do histórico: listByAutomation respeita limit/offset por tenant', async () => {
  const t = makeTenant();
  const automation = makeAutomation(t, { trigger_type: 'sale_paid' });
  for (let i = 0; i < 5; i++) {
    const event = makeEvent(t, { type: 'sale_paid', entityType: 'sale', entityId: `pg${i}` });
    await runAutomationForEvent({ tenant: t, automation, event });
  }
  assert.equal(automationRunQueries.countByAutomation.get(t.id, automation.id).n, 5);
  const page1 = automationRunQueries.listByAutomation.all(t.id, automation.id, 2, 0);
  const page2 = automationRunQueries.listByAutomation.all(t.id, automation.id, 2, 2);
  assert.equal(page1.length, 2);
  assert.equal(page2.length, 2);
  assert.notEqual(page1[0].id, page2[0].id);
  // outro tenant não vê nada
  const other = makeTenant();
  assert.equal(automationRunQueries.listByAutomation.all(other.id, automation.id, 10, 0).length, 0);
});

test('template de automação com contato inexistente no evento → skipped, sem envio', async () => {
  const t = makeTenant({
    plan: 'elite',
    businessJson: JSON.stringify({ whatsappTemplates: [{ nome: 'tpl', idioma: 'pt_BR', categoria: 'utility', corpo: 'x' }] }),
  });
  const automation = makeAutomation(t, { trigger_type: 'sale_paid' });
  const event = makeEvent(t, { type: 'sale_paid', entityType: 'sale', entityId: 'venda-sem-contato' });
  const r = await executeAction({ type: 'send_whatsapp_template', template_nome: 'tpl' },
    { tenant: t, automation, event, contact: null, sale: null });
  assert.equal(r.status, 'skipped');
  assert.equal(outboundJobQueries.findByIdempotency.get(t.id, `aut:${automation.id}:${event.id}:null`), undefined);
});
