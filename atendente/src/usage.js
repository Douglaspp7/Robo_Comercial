/**
 * Apuração de uso por tenant — junta os limites do plano (src/plans.js) com
 * os números reais do banco (src/db.js) para responder duas perguntas em
 * qualquer ponto do app: "quanto já foi usado" e "pode usar mais agora".
 *
 * Uso computado ao vivo (sem contador em cache) — evita drift e bugs de
 * sincronização; para o volume de um SaaS neste estágio, as agregações são
 * baratas (índices por tenant_id + created_at).
 */
import {
  ensureBillingCycle,
  aiUsageQueries,
  audioTranscriptionQueries,
  storageUsedBytes,
  extraDocumentQueries,
  knowledgeDocumentQueries,
  subscriptionState,
} from './db.js';
import { getPlanLimits, effectivePlanId, usageStatus } from './plans.js';

const MB = 1024 * 1024;

/**
 * Resumo completo de uso do tenant no ciclo de cobrança vigente.
 * @param {object} tenant  linha de tenants (não precisa ter segredos decriptados)
 */
export function getTenantUsage(tenant) {
  const sub = subscriptionState(tenant);
  const limits = getPlanLimits(tenant.plan, sub.status);
  const { start: cycleStart, end: cycleEnd } = ensureBillingCycle(tenant);

  const aiUsed = aiUsageQueries.countByTenantSince.get(tenant.id, cycleStart).calls || 0;
  const audioSeconds = audioTranscriptionQueries.sumSecondsSince.get(tenant.id, cycleStart).total_seconds || 0;
  const audioMinutesUsed = Math.round((audioSeconds / 60) * 10) / 10;
  const storageUsedMb = Math.round((storageUsedBytes(tenant.id) / MB) * 10) / 10;
  const extraDocsUsed = extraDocumentQueries.countByTenant.get(tenant.id).n || 0;
  const knowledgeUsage = knowledgeDocumentQueries.activeUsageByTenant.get(tenant.id) || {};
  const knowledgePages = knowledgeUsage.pages || 0;
  const knowledgeChunks = knowledgeUsage.chunks || 0;

  return {
    plan: tenant.plan || 'essencial',
    effectivePlan: effectivePlanId(tenant.plan, sub.status),
    subscriptionStatus: sub.status,
    cycleStart,
    cycleEnd,
    limits,
    ai: { used: aiUsed, limit: limits.aiCallsMonth, ...usageStatus(aiUsed, limits.aiCallsMonth) },
    audio: {
      usedMinutes: audioMinutesUsed,
      limitMinutes: limits.audioMinutesMonth,
      enabled: limits.audioTranscriptionEnabled,
      ...usageStatus(audioMinutesUsed, limits.audioMinutesMonth),
    },
    storage: { usedMb: storageUsedMb, limitMb: limits.storageLimitMb, ...usageStatus(storageUsedMb, limits.storageLimitMb) },
    extraDocs: { used: extraDocsUsed, limit: limits.extraDocsMax, ...usageStatus(extraDocsUsed, limits.extraDocsMax) },
    knowledge: {
      usedPages: knowledgePages,
      limitPages: limits.knowledgePagesTotal,
      usedChunks: knowledgeChunks,
      limitChunks: limits.knowledgeChunksTotal,
      documentsReady: knowledgeUsage.ready || 0,
      documentsProcessing: knowledgeUsage.processing || 0,
      ...usageStatus(knowledgePages, limits.knowledgePagesTotal),
    },
  };
}

/** true se o tenant já esgotou as respostas de IA do mês (bloqueia novo turno). */
export function isAiMonthlyLimitReached(tenant) {
  return getTenantUsage(tenant).ai.status === 'blocked';
}

/** true se o tenant pode transcrever mais áudio (plano habilita E ainda há minutos no mês). */
export function canTranscribeAudio(tenant) {
  const u = getTenantUsage(tenant);
  return u.audio.enabled && u.audio.status !== 'blocked';
}

/**
 * Verifica se cabe mais `addBytes` no armazenamento do tenant.
 * @returns {{ok:boolean, usedMb:number, limitMb:number}}
 */
export function hasStorageRoom(tenant, addBytes) {
  const u = getTenantUsage(tenant);
  const addMb = addBytes / MB;
  return { ok: u.storage.usedMb + addMb <= u.storage.limitMb, usedMb: u.storage.usedMb, limitMb: u.storage.limitMb };
}

export const STORAGE_LIMIT_MESSAGE =
  'Seu plano atingiu o limite de armazenamento. Apague arquivos antigos ou faça upgrade para continuar enviando arquivos.';
