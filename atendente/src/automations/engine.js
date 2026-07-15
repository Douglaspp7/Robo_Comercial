/**
 * Motor das automações: avalia condições (determinísticas, sem IA) e executa
 * ações. Usado pelo worker (execução real) e pelo endpoint de teste (dry run).
 *
 * Segurança:
 *  - toda leitura/escrita é filtrada por tenant_id;
 *  - ações de template usam SOMENTE templates já cadastrados e passam pela
 *    fila persistente de saída (retry/429/backoff do outbound worker);
 *  - ações gated por plano não falham silenciosamente: viram status
 *    'blocked_plan' com explicação;
 *  - eventos emitidos por ações carregam origin/chain_depth (anti-loop).
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  contactQueries,
  saleQueries,
  contactTagQueries,
  notificationQueries,
  tenantQueries,
  decryptTenant,
  automationQueries,
  automationRunQueries,
} from '../db.js';
import { normalizeBusiness } from '../business.js';
import { isWithinBusinessHours } from '../business-hours.js';
import { getPlanLimits, planAtLeast, effectivePlanId } from '../plans.js';
import { subscriptionState } from '../db.js';
import { applyStageTag } from '../auto-tags.js';
import { sendPushEvent } from '../push.js';
import { dispatchWebhookEvent } from '../webhook-dispatch.js';
import { createOutboundJob } from '../outbound-queue.js';
import { emitDomainEvent } from '../domain-events.js';

function safeJson(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } }

/**
 * Carrega o contexto da execução: contato e/ou venda atuais (estado FRESCO —
 * condições avaliadas no momento da execução, não do evento).
 */
export function loadContext(tenant, event) {
  const payload = safeJson(event.payload_json, {});
  let contact = null;
  let sale = null;
  if (event.entity_type === 'contact' && event.entity_id) {
    contact = contactQueries.byId.get(Number(event.entity_id));
    if (contact && contact.tenant_id !== tenant.id) contact = null; // isolamento
  } else if (event.entity_type === 'sale' && event.entity_id) {
    sale = saleQueries.byId.get(String(event.entity_id));
    if (sale && sale.tenant_id !== tenant.id) sale = null;
    if (sale?.contact_id) {
      contact = contactQueries.byId.get(sale.contact_id);
      if (contact && contact.tenant_id !== tenant.id) contact = null;
    }
  }
  return { payload, contact, sale };
}

// ── Condições ────────────────────────────────────────────────────────────────

/**
 * Avalia UMA condição. @returns {{pass:boolean, detail:string}}
 */
export function evaluateCondition(condition, { tenant, contact, sale, payload }) {
  const tags = contact ? contactTagQueries.byContact.all(contact.id).map((r) => r.tag) : [];
  const saleAmount = sale ? (sale.total_cents != null ? sale.total_cents / 100 : (sale.amount || 0)) : null;
  switch (condition.type) {
    case 'stage_equals':
      return { pass: contact?.stage === condition.value, detail: `etapa=${contact?.stage ?? '—'}` };
    case 'stage_in':
      return { pass: Boolean(contact) && condition.values.includes(contact.stage), detail: `etapa=${contact?.stage ?? '—'}` };
    case 'buy_intent_equals':
      return { pass: contact?.buy_intent === condition.value, detail: `intenção=${contact?.buy_intent ?? '—'}` };
    case 'has_tag':
      return { pass: tags.includes(condition.value), detail: `tags=${tags.length}` };
    case 'does_not_have_tag':
      return { pass: !tags.includes(condition.value), detail: `tags=${tags.length}` };
    case 'product_equals': {
      const produto = payload?.produto || contact?.last_produto_mencionado || null;
      return { pass: produto === condition.value, detail: `produto=${produto ?? '—'}` };
    }
    case 'sale_amount_greater_than':
      return { pass: saleAmount != null && saleAmount > condition.value, detail: `valor=${saleAmount ?? '—'}` };
    case 'sale_amount_less_than':
      return { pass: saleAmount != null && saleAmount < condition.value, detail: `valor=${saleAmount ?? '—'}` };
    case 'origin_equals':
      return { pass: contact?.lead_source === condition.value, detail: `origem=${contact?.lead_source ?? '—'}` };
    case 'customer_type_equals':
      return { pass: contact?.tipo_cliente === condition.value, detail: `tipo=${contact?.tipo_cliente ?? '—'}` };
    case 'within_business_hours':
      return { pass: isWithinBusinessHours(normalizeBusiness(tenant.business_json)), detail: 'horário' };
    case 'outside_business_hours':
      return { pass: !isWithinBusinessHours(normalizeBusiness(tenant.business_json)), detail: 'horário' };
    case 'marketing_source_equals': {
      if (!contact) return { pass: false, detail: 'sem contato' };
      const attr = db.prepare(`
        SELECT ml.source FROM contact_attributions ca
        JOIN attribution_clicks ac ON ac.id = ca.last_touch_click_id
        JOIN marketing_links ml ON ml.id = ac.marketing_link_id
        WHERE ca.contact_id = ? AND ca.tenant_id = ?
      `).get(contact.id, tenant.id);
      return { pass: attr?.source === condition.value, detail: `origem_link=${attr?.source ?? '—'}` };
    }
    case 'marketing_campaign_equals': {
      if (!contact) return { pass: false, detail: 'sem contato' };
      const attr = db.prepare(`
        SELECT ml.campaign FROM contact_attributions ca
        JOIN attribution_clicks ac ON ac.id = ca.last_touch_click_id
        JOIN marketing_links ml ON ml.id = ac.marketing_link_id
        WHERE ca.contact_id = ? AND ca.tenant_id = ?
      `).get(contact.id, tenant.id);
      return { pass: attr?.campaign === condition.value, detail: `campanha_link=${attr?.campaign ?? '—'}` };
    }
    case 'marketing_link_equals': {
      if (!contact) return { pass: false, detail: 'sem contato' };
      const attr = db.prepare(`
        SELECT ml.slug, ml.id FROM contact_attributions ca
        JOIN attribution_clicks ac ON ac.id = ca.last_touch_click_id
        JOIN marketing_links ml ON ml.id = ac.marketing_link_id
        WHERE ca.contact_id = ? AND ca.tenant_id = ?
      `).get(contact.id, tenant.id);
      const matched = attr?.slug === condition.value || attr?.id === condition.value;
      return { pass: matched, detail: `link_marketing=${attr?.slug ?? '—'}` };
    }
    case 'has_attribution': {
      if (!contact) return { pass: false, detail: 'sem contato' };
      const attr = db.prepare(`
        SELECT first_touch_click_id FROM contact_attributions
        WHERE contact_id = ? AND tenant_id = ?
      `).get(contact.id, tenant.id);
      const hasAttr = Boolean(attr?.first_touch_click_id);
      return { pass: hasAttr, detail: `atribuição=${hasAttr ? 'sim' : 'não'}` };
    }
    case 'attribution_model_equals': {
      if (!contact) return { pass: false, detail: 'sem contato' };
      const attr = db.prepare(`
        SELECT first_touch_click_id, last_touch_click_id FROM contact_attributions
        WHERE contact_id = ? AND tenant_id = ?
      `).get(contact.id, tenant.id);
      let matches = false;
      if (condition.value === 'first_touch' && attr?.first_touch_click_id) matches = true;
      if (condition.value === 'last_touch' && attr?.last_touch_click_id) matches = true;
      return { pass: matches, detail: `modelo_atribuição=${condition.value}` };
    }
    default:
      return { pass: false, detail: `condição desconhecida: ${condition.type}` };
  }
}

/** Avalia todas as condições (AND). */
export function evaluateConditions(conditions, ctx) {
  const results = [];
  let pass = true;
  for (const condition of conditions) {
    const r = evaluateCondition(condition, ctx);
    results.push({ type: condition.type, pass: r.pass, detail: r.detail });
    if (!r.pass) pass = false;
  }
  return { pass, results };
}

// ── Ações ────────────────────────────────────────────────────────────────────

/**
 * Verifica se uma ação está disponível no plano do tenant.
 * @returns {null | string} null = liberada; string = motivo do bloqueio.
 */
export function actionPlanBlock(action, tenant) {
  const status = subscriptionState(tenant).status;
  if (action.type === 'send_whatsapp_template') {
    if (!planAtLeast(effectivePlanId(tenant.plan, status), 'elite')) {
      return 'Envio de template exige plano Elite ou Especial.';
    }
  }
  return null;
}

/**
 * Executa UMA ação de verdade. Retorna { status, result } — nunca lança para
 * fora (o chamador registra a falha da ação).
 */
export async function executeAction(action, { tenant, automation, event, contact, sale: _sale }) {
  const blocked = actionPlanBlock(action, tenant);
  if (blocked) return { status: 'blocked_plan', result: { reason: blocked } };

  switch (action.type) {
    case 'add_tag': {
      if (!contact) return { status: 'skipped', result: { reason: 'sem contato no evento' } };
      contactTagQueries.add.run(tenant.id, contact.id, action.tag.toLowerCase());
      return { status: 'success', result: { tag: action.tag } };
    }
    case 'remove_tag': {
      if (!contact) return { status: 'skipped', result: { reason: 'sem contato no evento' } };
      contactTagQueries.remove.run(contact.id, action.tag.toLowerCase());
      return { status: 'success', result: { tag: action.tag } };
    }
    case 'change_stage': {
      if (!contact) return { status: 'skipped', result: { reason: 'sem contato no evento' } };
      if (contact.stage === action.stage) return { status: 'success', result: { unchanged: true } };
      db.prepare(`UPDATE contacts SET stage = ? WHERE id = ? AND tenant_id = ?`)
        .run(action.stage, contact.id, tenant.id);
      applyStageTag(tenant.id, contact.id, action.stage);
      // Evento derivado com origem/profundidade — outras automações podem
      // reagir, mas o loop é limitado por chain_depth.
      emitDomainEvent({
        tenantId: tenant.id,
        type: 'stage_changed',
        entityType: 'contact',
        entityId: contact.id,
        payload: { from: contact.stage, to: action.stage },
        origin: `automation:${automation.id}`,
        chainDepth: (event.chain_depth || 0) + 1,
      });
      return { status: 'success', result: { from: contact.stage, to: action.stage } };
    }
    case 'pause_ai': {
      if (!contact) return { status: 'skipped', result: { reason: 'sem contato no evento' } };
      db.prepare(`UPDATE contacts SET needs_human = 1 WHERE id = ? AND tenant_id = ?`).run(contact.id, tenant.id);
      return { status: 'success', result: {} };
    }
    case 'resume_ai': {
      if (!contact) return { status: 'skipped', result: { reason: 'sem contato no evento' } };
      db.prepare(`UPDATE contacts SET needs_human = 0 WHERE id = ? AND tenant_id = ?`).run(contact.id, tenant.id);
      return { status: 'success', result: {} };
    }
    case 'create_internal_notification': {
      notificationQueries.create.run({
        tenant_id: tenant.id,
        type: 'automacao',
        title: action.title || `Automação: ${automation.name}`,
        message: action.message || `A automação "${automation.name}" foi executada.`,
        contact_id: contact?.id ?? null,
      });
      return { status: 'success', result: {} };
    }
    case 'send_push_notification': {
      const r = await sendPushEvent({
        tenantId: tenant.id,
        event: 'automation_notification',
        title: action.title || `Automação: ${automation.name}`,
        body: action.body || 'Uma automação sua foi executada.',
        url: '/automations.html',
        dedupeKey: `automation:${automation.id}:${event.id}`,
        cooldownMinutes: 1,
      });
      return { status: 'success', result: { sent: r.sent, skipped: r.skipped || null } };
    }
    case 'send_whatsapp_template': {
      if (!contact?.wa_phone) return { status: 'skipped', result: { reason: 'sem contato/telefone no evento' } };
      if (contact.wa_phone.startsWith('_sandbox_')) return { status: 'skipped', result: { reason: 'contato de sandbox' } };
      const biz = normalizeBusiness(tenant.business_json);
      const template = (biz.whatsappTemplates || []).find((t) => t.nome === action.template_nome);
      if (!template) {
        // Erro permanente — template sumiu/foi removido; não adianta retry.
        return { status: 'failed_permanent', result: { reason: `Template "${action.template_nome}" não está cadastrado em Integrações.` } };
      }
      // Fila persistente de saída: retry/backoff/429 são do outbound worker.
      const job = createOutboundJob({
        tenantId: tenant.id,
        type: 'automation_template',
        payload: {
          template_nome: template.nome,
          template_idioma: template.idioma || 'pt_BR',
          variaveis: (action.variaveis || []).map(String),
          automation_id: automation.id,
        },
        idempotencyKey: `aut:${automation.id}:${event.id}:${contact.id}`,
        items: [{ contact_id: contact.id, destination: contact.wa_phone }],
      });
      return { status: 'success', result: { outbound_job_id: job.job_id, duplicated: job.duplicated || false } };
    }
    case 'dispatch_existing_webhook': {
      const decTenant = decryptTenant(tenantQueries.byId.get(tenant.id));
      if (!decTenant?.webhook_url || !decTenant.webhook_enabled) {
        return { status: 'skipped', result: { reason: 'Webhook não configurado em Integrações.' } };
      }
      await dispatchWebhookEvent(decTenant, 'automation.executed', {
        automation_id: automation.id,
        automation_name: automation.name,
        event_type: event.event_type,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
      });
      return { status: 'success', result: {} };
    }
    default:
      return { status: 'failed_permanent', result: { reason: `ação desconhecida: ${action.type}` } };
  }
}

// ── Execução completa de um job ──────────────────────────────────────────────

/** Chave de dedupe do run — contact_idle inclui a "versão" da última mensagem. */
export function buildDedupeKey(automation, event) {
  if (event.event_type === 'contact_idle') {
    const payload = safeJson(event.payload_json, {});
    return `${automation.id}:idle:${event.entity_id}:${payload.message_version || event.id}`;
  }
  return `${automation.id}:${event.id}`;
}

/**
 * Executa (de verdade) uma automação para um evento. Retorna um resumo do run.
 * Lança apenas erros marcados como retryable (para o worker retentar).
 */
export async function runAutomationForEvent({ tenant, automation, event }) {
  const conditions = safeJson(automation.conditions_json, []);
  const actions = safeJson(automation.actions_json, []);
  const ctx = { tenant, ...loadContext(tenant, event) };

  // contact_idle: revalida no momento da execução — se o cliente respondeu
  // depois do agendamento (corrida com o cancelamento), não dispara.
  if (event.event_type === 'contact_idle') {
    const payload = safeJson(event.payload_json, {});
    if (!ctx.contact) return { status: 'skipped', reason: 'contato não existe mais' };
    const scheduledVersion = Date.parse(payload.message_version || 0);
    const lastMessage = Date.parse((ctx.contact.last_message_at || '').replace(' ', 'T') + 'Z');
    if (Number.isFinite(lastMessage) && Number.isFinite(scheduledVersion) && lastMessage - scheduledVersion > 60_000) {
      return { status: 'skipped', reason: 'cliente respondeu depois do agendamento' };
    }
  }

  // Dedupe (único por tenant+chave) — se já existe run, não repete.
  const runId = 'arn_' + randomUUID().replace(/-/g, '').slice(0, 24);
  const dedupeKey = buildDedupeKey(automation, event);
  const inserted = automationRunQueries.tryInsert.run({
    id: runId,
    tenant_id: tenant.id,
    automation_id: automation.id,
    event_id: event.id,
    dedupe_key: dedupeKey,
  });
  if (!inserted.changes) return { status: 'skipped', reason: 'já executada para este evento (dedupe)' };

  // Cooldown: mesma automação para a mesma entidade dentro da janela → skip.
  const cooldown = Number(automation.cooldown_seconds) || 0;
  if (cooldown > 0 && event.entity_id) {
    const recent = automationRunQueries.lastRunForEntityWithin.get({
      tenant_id: tenant.id,
      automation_id: automation.id,
      entity_type: event.entity_type,
      entity_id: String(event.entity_id),
      exclude_run_id: runId,
      window: `-${cooldown} seconds`,
    });
    if (recent) {
      automationRunQueries.finish.run({ id: runId, status: 'skipped', error_summary: 'cooldown' });
      return { status: 'skipped', reason: 'cooldown da automação para esta entidade' };
    }
  }

  const evaluation = evaluateConditions(conditions, ctx);
  if (!evaluation.pass) {
    automationRunQueries.finish.run({ id: runId, status: 'skipped', error_summary: 'condições não atendidas' });
    return { status: 'skipped', reason: 'condições não atendidas', conditions: evaluation.results };
  }

  let failed = 0;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    let outcome;
    try {
      outcome = await executeAction(action, { tenant, automation, event, contact: ctx.contact, sale: ctx.sale });
    } catch (e) {
      outcome = { status: 'failed', result: { reason: String(e.message || e).slice(0, 200) } };
    }
    if (outcome.status.startsWith('failed')) failed++;
    automationRunQueries.insertAction.run({
      run_id: runId,
      action_index: i,
      action_type: action.type,
      status: outcome.status,
      result_json: JSON.stringify(outcome.result || {}),
      error_summary: outcome.status.startsWith('failed') ? (outcome.result?.reason || 'falha').slice(0, 200) : null,
    });
  }

  const finalStatus = failed ? 'failed' : 'success';
  automationRunQueries.finish.run({
    id: runId,
    status: finalStatus,
    error_summary: failed ? `${failed} ação(ões) falharam` : null,
  });
  automationQueries.touchLastRun.run(automation.id);
  return { status: finalStatus, runId };
}

/**
 * DRY RUN — simula a automação contra um contato/venda real do tenant (ou o
 * mais recente) SEM executar nenhum efeito: mostra gatilho, condições
 * aprovadas/reprovadas, ações que rodariam e bloqueios de plano/config.
 */
export function dryRunAutomation({ tenant, automation, contactId = null }) {
  const conditions = safeJson(automation.conditions_json, []);
  const actions = safeJson(automation.actions_json, []);

  let contact = null;
  if (contactId != null) {
    contact = contactQueries.byId.get(Number(contactId));
    if (contact && contact.tenant_id !== tenant.id) contact = null;
  }
  if (!contact) {
    contact = db.prepare(
      `SELECT * FROM contacts WHERE tenant_id = ? AND archived = 0 ORDER BY last_message_at DESC LIMIT 1`
    ).get(tenant.id) || null;
  }
  const sale = contact
    ? db.prepare(`SELECT * FROM sales WHERE tenant_id = ? AND contact_id = ? ORDER BY created_at DESC LIMIT 1`).get(tenant.id, contact.id) || null
    : null;

  const ctx = { tenant, contact, sale, payload: {} };
  const evaluation = evaluateConditions(conditions, ctx);
  const biz = normalizeBusiness(tenant.business_json);

  const actionsPreview = actions.map((action) => {
    const blocked = actionPlanBlock(action, tenant);
    let note = null;
    let ok = !blocked;
    if (action.type === 'send_whatsapp_template') {
      const template = (biz.whatsappTemplates || []).find((t) => t.nome === action.template_nome);
      if (!template) { ok = false; note = `Template "${action.template_nome}" não está cadastrado.`; }
      else note = `Usaria o template "${template.nome}" (${template.idioma || 'pt_BR'}).`;
    }
    if (action.type === 'dispatch_existing_webhook' && !tenant.webhook_url) {
      ok = false; note = 'Webhook não configurado em Integrações.';
    }
    if ((action.type === 'add_tag' || action.type === 'remove_tag' || action.type === 'change_stage' ||
         action.type === 'pause_ai' || action.type === 'resume_ai') && !contact) {
      ok = false; note = 'Nenhum contato de exemplo disponível.';
    }
    return { type: action.type, would_run: evaluation.pass && ok, blocked_reason: blocked || note };
  });

  return {
    dry_run: true,
    trigger: { type: automation.trigger_type, config: safeJson(automation.trigger_config_json, {}) },
    sample_contact: contact ? { name: contact.name || null, stage: contact.stage, buy_intent: contact.buy_intent } : null,
    conditions: evaluation.results,
    conditions_pass: evaluation.pass,
    actions: actionsPreview,
    plan: { id: effectivePlanId(tenant.plan, subscriptionState(tenant).status), limits: { automationMaxActive: getPlanLimits(tenant.plan, subscriptionState(tenant).status).automationMaxActive } },
  };
}
