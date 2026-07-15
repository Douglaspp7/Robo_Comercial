import { config } from './config.js';

// Fila de IA JUSTA entre tenants, em memória.
//
// A versão anterior era uma lista global única: um tenant com 100 mensagens
// atrasava o atendimento de todas as outras lojas. Agora cada tenant tem a
// sua fila interna e o dispatch percorre os tenants em ROUND-ROBIN — o job
// de um tenant pequeno não espera o backlog inteiro de um tenant grande.
//
// Prioridades (high | normal | low) valem DENTRO de cada tenant, com aging:
// a cada `agingMs` de espera o job "sobe" um nível efetivo, então low nunca
// fica bloqueado para sempre atrás de um fluxo contínuo de high.
//
// Limites (com padrões seguros, configuráveis por env):
//   AI_CONCURRENCY            — jobs executando em paralelo (global);
//   AI_QUEUE_MAX_GLOBAL       — máximo de jobs aguardando no total;
//   AI_QUEUE_MAX_PER_TENANT   — máximo aguardando por tenant;
//   AI_QUEUE_MAX_WAIT_MS      — espera considerada crítica (gera alerta).
//
// Quando um limite é atingido, add() devolve { ok:false, reason } — NUNCA
// lança. O chamador registra o evento e deixa o turno marcado para a
// varredura de recuperação re-enfileirar depois (nada se perde em silêncio).

const PRIORITIES = ['high', 'normal', 'low'];
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

export class FairQueue {
  constructor({
    concurrency = 5,
    maxGlobal = 500,
    maxPerTenant = 50,
    maxWaitMs = 120_000,
    agingMs = 30_000,
    onReject = null,
  } = {}) {
    this.concurrency = Math.max(1, concurrency);
    this.maxGlobal = Math.max(1, maxGlobal);
    this.maxPerTenant = Math.max(1, maxPerTenant);
    this.maxWaitMs = Math.max(1_000, maxWaitMs);
    this.agingMs = Math.max(1, agingMs);
    this.onReject = onReject;

    this.buckets = new Map();   // tenantId -> { high: [], normal: [], low: [] }
    this.rotation = [];         // ordem de visita do round-robin
    this.rotationIndex = 0;
    this.running = 0;
    this.waiting = 0;

    this.stats = {
      completed: 0,
      errors: 0,
      rejected: 0,
      totalWaitMs: 0,
      dispatched: 0,
    };
  }

  /**
   * Enfileira um job.
   * @param {() => Promise<any>|any} job
   * @param {object} [meta]
   * @param {string|number} [meta.tenantId]  obrigatório para jobs de lojistas;
   *                                         'platform' para tarefas globais.
   * @param {string|number} [meta.contactId] opcional (observabilidade/log).
   * @param {string} [meta.type]   mensagem|recuperacao|resumo|follow-up|sincronizacao|outro
   * @param {'high'|'normal'|'low'} [meta.priority]
   * @returns {{ok: true} | {ok: false, reason: 'global_limit'|'tenant_limit'}}
   */
  add(job, meta = {}) {
    const tenantId = String(meta.tenantId ?? 'platform');
    const priority = PRIORITIES.includes(meta.priority) ? meta.priority : 'normal';
    const type = meta.type || 'outro';

    if (this.waiting >= this.maxGlobal) {
      return this._reject('global_limit', { tenantId, type });
    }

    let bucket = this.buckets.get(tenantId);
    if (!bucket) {
      bucket = { high: [], normal: [], low: [] };
      this.buckets.set(tenantId, bucket);
      this.rotation.push(tenantId);
    }
    const tenantPending = bucket.high.length + bucket.normal.length + bucket.low.length;
    if (tenantPending >= this.maxPerTenant) {
      return this._reject('tenant_limit', { tenantId, type });
    }

    bucket[priority].push({
      job,
      priority,
      type,
      contactId: meta.contactId ?? null,
      enqueuedAt: Date.now(),
    });
    this.waiting++;
    this._next();
    return { ok: true };
  }

  _reject(reason, { tenantId, type }) {
    this.stats.rejected++;
    // Sem dados pessoais: só id interno do tenant, tipo e motivo.
    console.warn(`[fila-ia] job recusado (${reason}) tenant=${tenantId} tipo=${type} aguardando=${this.waiting}`);
    try {
      this.onReject?.(reason, { tenantId, type });
    } catch (err) {
      console.error('[fila-ia] onReject falhou:', err.message);
    }
    return { ok: false, reason };
  }

  // Próximo tenant (round-robin) que tenha job aguardando. Remove da rotação
  // tenants que ficaram vazios (voltam quando enfileirarem de novo).
  _nextTenant() {
    let scanned = 0;
    while (scanned < this.rotation.length) {
      if (this.rotationIndex >= this.rotation.length) this.rotationIndex = 0;
      const tenantId = this.rotation[this.rotationIndex];
      const bucket = this.buckets.get(tenantId);
      const size = bucket ? bucket.high.length + bucket.normal.length + bucket.low.length : 0;
      if (size > 0) {
        this.rotationIndex++;
        return tenantId;
      }
      this.rotation.splice(this.rotationIndex, 1);
      this.buckets.delete(tenantId);
      scanned = 0; // lista mudou; recomeça a contagem de segurança
      if (this.rotation.length === 0) return null;
    }
    return null;
  }

  // Escolhe o próximo job de um tenant: menor prioridade efetiva vence
  // (rank - níveis de aging); empate vai para o mais antigo (FIFO).
  _takeJob(tenantId) {
    const bucket = this.buckets.get(tenantId);
    if (!bucket) return null;
    const now = Date.now();
    let best = null;
    let bestPriority = null;
    for (const priority of PRIORITIES) {
      const head = bucket[priority][0];
      if (!head) continue;
      const aged = PRIORITY_RANK[priority] - Math.floor((now - head.enqueuedAt) / this.agingMs);
      if (
        !best ||
        aged < best.aged ||
        (aged === best.aged && head.enqueuedAt < best.entry.enqueuedAt)
      ) {
        best = { entry: head, aged };
        bestPriority = priority;
      }
    }
    if (!best) return null;
    return bucket[bestPriority].shift();
  }

  _next() {
    while (this.running < this.concurrency && this.waiting > 0) {
      const tenantId = this._nextTenant();
      if (!tenantId) return;
      const entry = this._takeJob(tenantId);
      if (!entry) continue;

      this.waiting--;
      this.running++;
      this.stats.dispatched++;
      this.stats.totalWaitMs += Date.now() - entry.enqueuedAt;

      Promise.resolve()
        .then(entry.job)
        .then(() => {
          this.stats.completed++;
        })
        .catch((err) => {
          this.stats.errors++;
          console.error('Erro na fila de IA:', err);
        })
        .finally(() => {
          this.running--;
          this._next();
        });
    }
  }

  /** Compatibilidade: profundidade total (aguardando + executando). */
  get pending() {
    return this.waiting + this.running;
  }

  /**
   * Métricas agregadas — sem nenhum dado pessoal (nem ids de tenant).
   * Usadas pelo /health e pelo monitor de alertas.
   */
  metrics() {
    let largestTenantQueue = 0;
    let tenantsWaiting = 0;
    let oldestEnqueuedAt = null;
    for (const bucket of this.buckets.values()) {
      const size = bucket.high.length + bucket.normal.length + bucket.low.length;
      if (size === 0) continue;
      tenantsWaiting++;
      if (size > largestTenantQueue) largestTenantQueue = size;
      for (const priority of PRIORITIES) {
        const head = bucket[priority][0];
        if (head && (oldestEnqueuedAt === null || head.enqueuedAt < oldestEnqueuedAt)) {
          oldestEnqueuedAt = head.enqueuedAt;
        }
      }
    }
    return {
      pending: this.waiting,
      running: this.running,
      tenants_waiting: tenantsWaiting,
      largest_tenant_queue: largestTenantQueue,
      oldest_wait_ms: oldestEnqueuedAt === null ? 0 : Date.now() - oldestEnqueuedAt,
      avg_wait_ms: this.stats.dispatched
        ? Math.round(this.stats.totalWaitMs / this.stats.dispatched)
        : 0,
      rejected_total: this.stats.rejected,
      completed_total: this.stats.completed,
      errors_total: this.stats.errors,
    };
  }
}

export const queueLimits = {
  maxGlobal: Number(process.env.AI_QUEUE_MAX_GLOBAL) || 500,
  maxPerTenant: Number(process.env.AI_QUEUE_MAX_PER_TENANT) || 50,
  maxWaitMs: Number(process.env.AI_QUEUE_MAX_WAIT_MS) || 120_000,
};

export const aiQueue = new FairQueue({
  concurrency: config.aiConcurrency,
  ...queueLimits,
});
