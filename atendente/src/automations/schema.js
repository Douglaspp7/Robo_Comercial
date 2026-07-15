/**
 * Validação das automações (QUANDO → SE → ENTÃO) — allowlists explícitas.
 *
 * NUNCA confiar no JSON do frontend: todo gatilho/condição/ação passa por
 * schema Zod com tipos fechados (discriminated union). Nada de operador
 * arbitrário, URL arbitrária ou código configurável.
 */
import { z } from 'zod';
import { STAGE_IDS } from '../config.js';

export const TRIGGER_TYPES = [
  'contact_created',
  'stage_changed',
  'buy_intent_changed',
  'handoff_requested',
  'checkout_sent',
  'sale_paid',
  'product_restocked',
  'contact_idle',
  'marketing_link_clicked',
  'attribution_connected',
  'qualified_lead_created',
  'conversion_delivery_failed',
];

export const CONDITION_TYPES = [
  'stage_equals',
  'stage_in',
  'buy_intent_equals',
  'has_tag',
  'does_not_have_tag',
  'product_equals',
  'sale_amount_greater_than',
  'sale_amount_less_than',
  'origin_equals',
  'customer_type_equals',
  'within_business_hours',
  'outside_business_hours',
  'marketing_source_equals',
  'marketing_campaign_equals',
  'marketing_link_equals',
  'has_attribution',
  'attribution_model_equals',
];

export const ACTION_TYPES = [
  'add_tag',
  'remove_tag',
  'change_stage',
  'pause_ai',
  'resume_ai',
  'create_internal_notification',
  'send_push_notification',
  'send_whatsapp_template',
  'dispatch_existing_webhook',
];

const BUY_INTENTS = ['baixa', 'media', 'alta'];
// Mesmos valores usados em contacts.lead_source (ver db.js/auto-tags).
const tag = z.string().trim().min(1).max(40).regex(/^[a-z0-9à-ú_\- ]+$/i, 'Tag com caracteres inválidos.');
const shortText = z.string().trim().min(1).max(120);

// ── Gatilho ──────────────────────────────────────────────────────────────────
// trigger_config: delay_minutes atrasa a execução após o evento (0 = imediato).
// contact_idle EXIGE idle_minutes (o "ficou X sem responder").
export const triggerConfigSchema = z.object({
  delay_minutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
  idle_minutes: z.number().int().min(5).max(60 * 24 * 30).optional(),
}).strict();

// ── Condições (AND no MVP; modelo pronto para OR futuro sem expor agora) ─────
export const conditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stage_equals'), value: z.enum(STAGE_IDS) }).strict(),
  z.object({ type: z.literal('stage_in'), values: z.array(z.enum(STAGE_IDS)).min(1).max(STAGE_IDS.length) }).strict(),
  z.object({ type: z.literal('buy_intent_equals'), value: z.enum(BUY_INTENTS) }).strict(),
  z.object({ type: z.literal('has_tag'), value: tag }).strict(),
  z.object({ type: z.literal('does_not_have_tag'), value: tag }).strict(),
  z.object({ type: z.literal('product_equals'), value: shortText }).strict(),
  z.object({ type: z.literal('sale_amount_greater_than'), value: z.number().min(0).max(10_000_000) }).strict(),
  z.object({ type: z.literal('sale_amount_less_than'), value: z.number().min(0).max(10_000_000) }).strict(),
  z.object({ type: z.literal('origin_equals'), value: z.string().trim().min(1).max(60) }).strict(),
  z.object({ type: z.literal('customer_type_equals'), value: z.string().trim().min(1).max(60) }).strict(),
  z.object({ type: z.literal('within_business_hours') }).strict(),
  z.object({ type: z.literal('outside_business_hours') }).strict(),
  z.object({ type: z.literal('marketing_source_equals'), value: shortText }).strict(),
  z.object({ type: z.literal('marketing_campaign_equals'), value: shortText }).strict(),
  z.object({ type: z.literal('marketing_link_equals'), value: shortText }).strict(),
  z.object({ type: z.literal('has_attribution') }).strict(),
  z.object({ type: z.literal('attribution_model_equals'), value: z.enum(['first_touch', 'last_touch']) }).strict(),
]);

// ── Ações ────────────────────────────────────────────────────────────────────
// Textos de notificação/push são fixos do lojista (sem interpolação de dados
// do cliente) — por isso podem aparecer em tela bloqueada sem vazar nada.
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_tag'), tag }).strict(),
  z.object({ type: z.literal('remove_tag'), tag }).strict(),
  z.object({ type: z.literal('change_stage'), stage: z.enum(STAGE_IDS) }).strict(),
  z.object({ type: z.literal('pause_ai') }).strict(),
  z.object({ type: z.literal('resume_ai') }).strict(),
  z.object({
    type: z.literal('create_internal_notification'),
    title: shortText.optional(),
    message: z.string().trim().min(1).max(300).optional(),
  }).strict(),
  z.object({
    type: z.literal('send_push_notification'),
    title: shortText.optional(),
    body: z.string().trim().min(1).max(160).optional(),
  }).strict(),
  z.object({
    type: z.literal('send_whatsapp_template'),
    // Só o NOME de um template já cadastrado/aprovado — nunca texto livre.
    template_nome: z.string().trim().min(1).max(120),
    variaveis: z.array(z.string().trim().max(120)).max(10).optional(),
  }).strict(),
  // Usa exclusivamente o webhook já cadastrado pelo tenant — sem URL aqui.
  z.object({ type: z.literal('dispatch_existing_webhook') }).strict(),
]);

export const MAX_CONDITIONS = 10;
export const MAX_ACTIONS = 10;
export const MAX_JSON_BYTES = 20_000;

export const automationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional().or(z.literal('')),
  enabled: z.boolean().optional(),
  trigger_type: z.enum(TRIGGER_TYPES),
  trigger_config: triggerConfigSchema.optional().default({}),
  conditions: z.array(conditionSchema).max(MAX_CONDITIONS).optional().default([]),
  actions: z.array(actionSchema).min(1).max(MAX_ACTIONS),
  cooldown_seconds: z.number().int().min(0).max(60 * 60 * 24 * 30).optional().default(0),
}).strict();

/**
 * Valida o corpo de criação/edição. Lança erro { validation:true } no padrão
 * do error handler do Express (mensagem em português).
 */
export function validateAutomation(body) {
  if (JSON.stringify(body || {}).length > MAX_JSON_BYTES) {
    const err = new Error('Automação grande demais.');
    err.statusCode = 400;
    err.validation = true;
    throw err;
  }
  const result = automationSchema.safeParse(body);
  if (!result.success) {
    const messages = result.error.issues
      .map((e) => `${e.path.join('.') || 'automação'}: ${e.message}`)
      .join('; ');
    const err = new Error(`Automação inválida — ${messages}`.slice(0, 400));
    err.statusCode = 400;
    err.validation = true;
    throw err;
  }
  const data = result.data;
  if (data.trigger_type === 'contact_idle' && !data.trigger_config?.idle_minutes) {
    const err = new Error('O gatilho "cliente parado" exige o tempo de inatividade (idle_minutes).');
    err.statusCode = 400;
    err.validation = true;
    throw err;
  }
  return data;
}
