/**
 * Event bus de domínio das automações.
 *
 * emitDomainEvent() registra o evento (auditoria) e AGENDA jobs persistentes
 * para cada automação ativa daquele gatilho — tudo síncrono/transacional no
 * SQLite, então o dado está no disco antes da requisição HTTP responder.
 * A execução em si acontece no worker (src/automations/worker.js).
 *
 * Prevenção de loop: eventos gerados por ações de automação carregam
 * origin='automation:<id>' e chain_depth incrementado; acima de
 * AUTOMATION_MAX_CHAIN_DEPTH o evento é registrado mas NÃO agenda jobs.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  automationQueries,
  automationEventQueries,
  automationJobQueries,
  marketingConversionQueries,
  conversionJobQueries,
  contactAttributionQueries,
  tenantQueries,
  saleQueries,
} from './db.js';

export const MAX_CHAIN_DEPTH = Math.max(1, Number(process.env.AUTOMATION_MAX_CHAIN_DEPTH) || 3);
export const automationsEnabled = process.env.AUTOMATIONS_ENABLED !== 'false';

function newId(prefix) {
  return prefix + randomUUID().replace(/-/g, '').slice(0, 24);
}

const MAX_PAYLOAD_BYTES = 4_000;

/** Payload seguro: nunca conteúdo de mensagem; corta qualquer excesso. */
function safePayload(payload) {
  try {
    const json = JSON.stringify(payload || {});
    if (json.length <= MAX_PAYLOAD_BYTES) return json;
    return JSON.stringify({ truncated: true });
  } catch {
    return '{}';
  }
}

/**
 * Emite um evento de domínio e agenda os jobs das automações correspondentes.
 * Nunca lança (falha de automação não pode derrubar o fluxo que emitiu).
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.type        um de TRIGGER_TYPES (schema.js)
 * @param {string} [opts.entityType]  'contact' | 'sale' | 'product'
 * @param {string|number} [opts.entityId]
 * @param {object} [opts.payload]   dados seguros do evento (sem conteúdo de conversa)
 * @param {string} [opts.origin]    'system' | 'automation:<id>'
 * @param {number} [opts.chainDepth]
 * @returns {{eventId:string|null, jobs:number}}
 */
export function emitDomainEvent({
  tenantId, type, entityType = null, entityId = null,
  payload = {}, origin = 'system', chainDepth = 0,
}) {
  if (!automationsEnabled) return { eventId: null, jobs: 0 };
  if (!tenantId || !type) return { eventId: null, jobs: 0 };
  try {
    const eventId = newId('aev_');
    let jobs = 0;
    const tx = db.transaction(() => {
      automationEventQueries.insert.run({
        id: eventId,
        tenant_id: tenantId,
        event_type: type,
        entity_type: entityType,
        entity_id: entityId != null ? String(entityId) : null,
        payload_json: safePayload(payload),
        origin,
        chain_depth: chainDepth,
      });

      // Guarda anti-loop: profundo demais → só auditoria, sem novos jobs.
      if (chainDepth >= MAX_CHAIN_DEPTH) {
        automationEventQueries.markProcessed.run(eventId);
        return;
      }

      const automations = automationQueries.listEnabledByTrigger.all(tenantId, type);
      for (const automation of automations) {
        // Uma automação nunca reage a evento gerado por ela mesma.
        if (origin === `automation:${automation.id}`) continue;
        const config = safeJson(automation.trigger_config_json);
        const delayMin = Number(config.delay_minutes) || 0;
        const runAt = delayMin > 0
          ? sqliteFuture(delayMin)
          : new Date().toISOString().replace('T', ' ').slice(0, 19);
        automationJobQueries.insert.run({
          id: newId('ajb_'),
          tenant_id: tenantId,
          automation_id: automation.id,
          event_id: eventId,
          run_at: runAt,
        });
        jobs++;
      }
      automationEventQueries.markProcessed.run(eventId);
    });
    tx();

    // Processamento de conversão em segundo plano
    trackConversionEvent({ tenantId, type, entityType, entityId, payload });

    return { eventId, jobs };
  } catch (e) {
    console.error('[automations] emitDomainEvent falhou:', e.message);
    return { eventId: null, jobs: 0 };
  }
}

function trackConversionEvent({ tenantId, type, entityType, entityId, payload }) {
  let eventName = '';
  let valueCents = null;
  let currency = 'BRL';
  let saleId = null;
  let contactId = null;

  if (type === 'contact_created') {
    eventName = 'Lead';
    contactId = Number(entityId);
  } else if (type === 'buy_intent_changed' && payload.new_intent === 'alta') {
    eventName = 'QualifiedLead';
    contactId = Number(entityId);
  } else if (type === 'checkout_sent') {
    eventName = 'InitiateCheckout';
    saleId = String(entityId);
    const sale = saleQueries.byId.get(saleId);
    if (sale) {
      contactId = sale.contact_id;
      valueCents = sale.total_cents != null ? sale.total_cents : Math.round((sale.amount || 0) * 100);
    }
  } else if (type === 'sale_paid') {
    eventName = 'Purchase';
    saleId = String(entityId);
    const sale = saleQueries.byId.get(saleId);
    if (sale) {
      contactId = sale.contact_id;
      valueCents = sale.total_cents != null ? sale.total_cents : Math.round((sale.amount || 0) * 100);
    }
  }

  if (!eventName || !contactId) return;

  try {
    const attr = contactAttributionQueries.get.get(contactId, tenantId);
    let marketingLinkId = null;
    if (attr && attr.last_touch_click_id) {
      const click = db.prepare(`SELECT marketing_link_id FROM attribution_clicks WHERE id = ?`).get(attr.last_touch_click_id);
      if (click) {
        marketingLinkId = click.marketing_link_id;
      }
    }

    const conversionId = 'con_' + randomUUID().replace(/-/g, '').slice(0, 24);
    let eventId = '';
    if (type === 'contact_created') {
      eventId = `lead_${contactId}`;
    } else if (type === 'buy_intent_changed') {
      eventId = `qual_${contactId}`;
    } else if (type === 'checkout_sent') {
      eventId = `init_${saleId}`;
    } else if (type === 'sale_paid') {
      eventId = `purc_${saleId}`;
    }

    const eventTime = Math.round(Date.now() / 1000);

    marketingConversionQueries.insert.run({
      id: conversionId,
      tenant_id: tenantId,
      contact_id: contactId,
      sale_id: saleId,
      event_name: eventName,
      event_id: eventId,
      event_time: eventTime,
      attribution_model: 'last_touch',
      marketing_link_id: marketingLinkId,
      value_cents: valueCents,
      currency,
      payload_json: JSON.stringify(payload || {}),
    });

    const tenant = tenantQueries.byId.get(tenantId);
    if (tenant && tenant.capi_enabled === 1 && tenant.capi_pixel_id) {
      const jobId = 'cjb_' + randomUUID().replace(/-/g, '').slice(0, 24);
      conversionJobQueries.insert.run(jobId, tenantId, conversionId, 'meta_capi');
    }
  } catch (err) {
    console.error('[ConversionEvent] Falha ao registrar conversão:', err.message);
  }
}

/**
 * Mensagem recebida do cliente: cancela os lembretes de inatividade pendentes
 * dele e agenda novos (contact_idle é persistente — sobrevive a reinício).
 * O dedupe do run usa contact_id + last_message_at do momento do agendamento,
 * então uma nova mensagem gera uma "versão" nova sem colidir com a anterior.
 */
export function handleInboundMessageForAutomations(tenant, contact) {
  if (!automationsEnabled || !tenant?.id || !contact?.id) return;
  try {
    // Cancela qualquer idle pendente do contato (respondeu → não está parado).
    automationJobQueries.cancelPendingByEventEntity.run({
      tenant_id: tenant.id,
      event_type: 'contact_idle',
      entity_type: 'contact',
      entity_id: String(contact.id),
    });

    const automations = automationQueries.listEnabledByTrigger.all(tenant.id, 'contact_idle');
    if (!automations.length) return;

    const messageVersion = new Date().toISOString();
    const eventId = newId('aev_');
    const tx = db.transaction(() => {
      automationEventQueries.insert.run({
        id: eventId,
        tenant_id: tenant.id,
        event_type: 'contact_idle',
        entity_type: 'contact',
        entity_id: String(contact.id),
        payload_json: safePayload({ message_version: messageVersion }),
        origin: 'system',
        chain_depth: 0,
      });
      for (const automation of automations) {
        const config = safeJson(automation.trigger_config_json);
        const idleMin = Number(config.idle_minutes) || 0;
        if (idleMin <= 0) continue;
        automationJobQueries.insert.run({
          id: newId('ajb_'),
          tenant_id: tenant.id,
          automation_id: automation.id,
          event_id: eventId,
          run_at: sqliteFuture(idleMin),
        });
      }
      automationEventQueries.markProcessed.run(eventId);
    });
    tx();
  } catch (e) {
    console.error('[automations] agendamento de inatividade falhou:', e.message);
  }
}

/**
 * Venda paga/cancelada: invalida lembretes pendentes ligados àquela venda
 * (ex.: "checkout sem pagamento há 24h") e, no pagamento, também os idle do
 * contato — cliente que acabou de pagar não é "cliente parado".
 */
export function cancelPendingJobsForSale(tenantId, saleId, contactId = null) {
  if (!automationsEnabled || !tenantId || !saleId) return;
  try {
    for (const eventType of ['checkout_sent', 'sale_paid']) {
      automationJobQueries.cancelPendingByEventEntity.run({
        tenant_id: tenantId,
        event_type: eventType,
        entity_type: 'sale',
        entity_id: String(saleId),
      });
    }
    if (contactId != null) {
      automationJobQueries.cancelPendingByEventEntity.run({
        tenant_id: tenantId,
        event_type: 'contact_idle',
        entity_type: 'contact',
        entity_id: String(contactId),
      });
    }
  } catch (e) {
    console.error('[automations] cancelamento por venda falhou:', e.message);
  }
}

function safeJson(s) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }

/** datetime futuro no formato do SQLite (UTC, 'YYYY-MM-DD HH:MM:SS'). */
function sqliteFuture(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString().replace('T', ' ').slice(0, 19);
}
