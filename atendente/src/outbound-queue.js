/**
 * Fila persistente de envios em massa (campanhas, avisos de reposição).
 *
 * Diferente da fila de IA (src/queue.js), esta é lastreada em SQLite:
 *  - a rota HTTP cria o job + itens e responde 202 imediatamente;
 *  - o worker aqui, num interval() em background, reserva itens atomicamente
 *    (UPDATE ... RETURNING) e chama o handler cadastrado por tipo;
 *  - concorrência global e por-tenant limitada (justiça entre lojistas);
 *  - retentativa com backoff exponencial + jitter;
 *  - 429 respeita Retry-After;
 *  - erros permanentes (número inválido, template não aprovado, permissão)
 *    marcam o item como falha definitiva sem novas tentativas;
 *  - reinício do servidor não perde envios: itens em "processing" com
 *    locked_at expirado voltam para "pending" no boot.
 *
 * Nunca gravamos o texto integral da mensagem em logs; só o telefone
 * abreviado (últimos 4 dígitos) e o tipo/id do job.
 */
import {
  db,
  outboundJobQueries,
  outboundJobItemQueries,
  tenantQueries,
  decryptTenant,
} from './db.js';
import { sendAlert } from './alerts.js';

// ── Config via env com padrões seguros ──────────────────────────────────────
export const outboundConfig = {
  concurrency:       Math.max(1, Number(process.env.OUTBOUND_CONCURRENCY)      || 3),
  maxPerTenant:      Math.max(1, Number(process.env.OUTBOUND_MAX_PER_TENANT)   || 1),
  minIntervalMs:     Math.max(0, Number(process.env.OUTBOUND_MIN_INTERVAL_MS)  || 500),
  maxAttempts:       Math.max(1, Number(process.env.OUTBOUND_MAX_ATTEMPTS)     || 5),
  lockTimeoutMs:     Math.max(10_000, Number(process.env.OUTBOUND_LOCK_TIMEOUT_MS) || 120_000),
  retryBaseMs:       Math.max(500, Number(process.env.OUTBOUND_RETRY_BASE_MS)  || 5_000),
  pollIntervalMs:    Math.max(200, Number(process.env.OUTBOUND_POLL_INTERVAL_MS) || 1_000),
};

// Handlers por tipo — cada rota (campanha, reposição, etc.) registra o dela
// para desacoplar o worker das integrações externas (facilita testes).
const handlers = new Map();
export function registerHandler(type, fn) {
  if (typeof fn !== 'function') throw new Error(`handler para ${type} deve ser função`);
  handlers.set(type, fn);
}
export function getHandler(type) { return handlers.get(type); }

// Cache de tenant enquanto o worker roda um job — evita fetch por item.
const tenantCache = new Map();
function loadTenant(tenantId) {
  if (tenantCache.has(tenantId)) return tenantCache.get(tenantId);
  const row = tenantQueries.byId.get(tenantId);
  const tenant = row ? decryptTenant(row) : null;
  tenantCache.set(tenantId, tenant);
  return tenant;
}
export function clearTenantCache() { tenantCache.clear(); }

// ── Estado do worker ────────────────────────────────────────────────────────
class Runner {
  constructor(config) {
    this.config = config;
    this.running = 0;              // itens em execução simultânea (global)
    this.perTenant = new Map();    // tenantId -> qtd em execução
    this.tenantCursor = 0;         // round-robin
    this.tenantPauseUntil = new Map(); // 429 Retry-After por tenant
    this.lastSendAt = new Map();   // tenantId -> ms do último envio (min interval)
    this.stats = { picked: 0, sent: 0, failed: 0, retried: 0, rejected: 0 };
    this.stopped = false;
  }

  metrics() {
    return {
      running:            this.running,
      per_tenant:         Object.fromEntries(this.perTenant),
      concurrency:        this.config.concurrency,
      max_per_tenant:     this.config.maxPerTenant,
      ...this.stats,
    };
  }

  stop() { this.stopped = true; }

  // Escolhe o próximo tenant elegível de forma round-robin.
  _nextTenant() {
    const rows = outboundJobItemQueries.distinctTenantsPending.all();
    const active = rows
      .map((r) => r.tenant_id)
      .filter((tid) => {
        const busy = (this.perTenant.get(tid) || 0) >= this.config.maxPerTenant;
        const pausedUntil = this.tenantPauseUntil.get(tid) || 0;
        const gap = (this.lastSendAt.get(tid) || 0) + this.config.minIntervalMs;
        return !busy && Date.now() >= pausedUntil && Date.now() >= gap;
      });
    if (!active.length) return null;
    // rotação estável: percorre a lista a partir de tenantCursor
    active.sort();
    const idx = this.tenantCursor % active.length;
    this.tenantCursor = (idx + 1) % Math.max(active.length, 1);
    return active[idx];
  }

  // Uma passada do loop: tenta ocupar todos os slots livres.
  tick() {
    if (this.stopped) return;
    while (this.running < this.config.concurrency) {
      const tenantId = this._nextTenant();
      if (!tenantId) return;
      const next = outboundJobItemQueries.nextByTenant.get(tenantId);
      if (!next) return;
      // Reserva atomicamente. Se outro processo pegou primeiro, item vira null.
      const reserved = outboundJobItemQueries.reserveById.get(next.id);
      if (!reserved) continue;
      this._dispatch(reserved);
    }
  }

  _dispatch(item) {
    this.running++;
    this.perTenant.set(item.tenant_id, (this.perTenant.get(item.tenant_id) || 0) + 1);
    this.lastSendAt.set(item.tenant_id, Date.now());
    this.stats.picked++;
    outboundJobQueries.markStarted.run(item.job_id);

    Promise.resolve()
      .then(() => this._run(item))
      .catch((err) => {
        // Guard-rail: qualquer erro não-tratado vira falha permanente.
        console.error('[outbound] handler crashou:', err?.message || err);
        outboundJobItemQueries.markFailed.run(String(err?.message || err).slice(0, 500), item.id);
        this.stats.failed++;
      })
      .finally(() => {
        this.running--;
        this.perTenant.set(item.tenant_id, Math.max(0, (this.perTenant.get(item.tenant_id) || 1) - 1));
        this._checkJobDone(item.job_id);
        // acorda o loop no próximo tick — não recursivo pra evitar stack overflow
      });
  }

  async _run(item) {
    const job = outboundJobQueries.getById.get(item.job_id, item.tenant_id);
    if (!job || job.status === 'cancelled' || job.status === 'paused') {
      // Alguém pausou/cancelou entre a reserva e o dispatch. Devolve pra fila.
      outboundJobItemQueries.markRetry.run(new Date().toISOString(), null, item.id);
      return;
    }
    const handler = handlers.get(job.type);
    if (!handler) {
      outboundJobItemQueries.markFailed.run(`handler_not_registered:${job.type}`, item.id);
      this.stats.failed++;
      return;
    }
    const tenant = loadTenant(item.tenant_id);
    if (!tenant) {
      outboundJobItemQueries.markFailed.run('tenant_not_found', item.id);
      this.stats.failed++;
      return;
    }

    const payload = safeJson(item.payload_json);
    const jobPayload = safeJson(job.payload_json);
    try {
      const result = await handler({ tenant, item, job, payload, jobPayload });
      const providerId = result?.provider_message_id || result?.messages?.[0]?.id || null;
      outboundJobItemQueries.markSent.run(providerId, item.id);
      this.stats.sent++;
    } catch (err) {
      this._handleError(item, job, err);
    }
  }

  _handleError(item, job, err) {
    const detail = String(err?.message || err || 'erro').slice(0, 500);
    const status = err?.httpStatus || parseHttpStatus(detail);
    const retryAfter = err?.retryAfterMs || parseRetryAfter(detail);
    const permanent = err?.permanent === true || isPermanentError(detail);

    if (permanent) {
      outboundJobItemQueries.markFailed.run(detail, item.id);
      this.stats.failed++;
      return;
    }

    const attempts = (item.attempts || 0) + 1;
    if (attempts >= this.config.maxAttempts) {
      outboundJobItemQueries.markFailed.run(detail, item.id);
      this.stats.failed++;
      // Alerta operacional quando um lote inteiro está falhando.
      if (job && job.failed_items > 3) {
        sendAlert('queue', `disparo do tipo ${job.type} com muitas falhas (job=${job.id.slice(0, 8)})`).catch(() => {});
      }
      return;
    }

    // 429 → pausa o tenant respeitando Retry-After.
    if (status === 429 && retryAfter) {
      this.tenantPauseUntil.set(item.tenant_id, Date.now() + retryAfter);
    }

    // Backoff exponencial com jitter (±25%). Retry-After tem precedência.
    const base = retryAfter || this.config.retryBaseMs * Math.pow(2, attempts - 1);
    const jitter = base * 0.25 * (Math.random() * 2 - 1);
    const delay = Math.max(this.config.retryBaseMs, Math.round(base + jitter));
    const next = new Date(Date.now() + delay).toISOString().replace('T', ' ').slice(0, 19);
    outboundJobItemQueries.markRetry.run(next, detail, item.id);
    this.stats.retried++;
  }

  // Verifica se o job pode fechar (todos itens em estado terminal).
  _checkJobDone(jobId) {
    outboundJobQueries.refreshCounters.run(jobId);
    const rows = outboundJobItemQueries.countByJobStatus.all(jobId);
    const counts = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    const pending = (counts.pending || 0) + (counts.retry || 0) + (counts.processing || 0);
    if (pending > 0) return;
    const failed = counts.failed || 0;
    const cancelled = counts.cancelled || 0;
    const status = cancelled > 0 && !failed && !(counts.sent || 0)
      ? 'cancelled'
      : failed > 0
        ? 'completed_with_errors'
        : 'completed';
    outboundJobQueries.markCompleted.run({ id: jobId, status, last_error: null });
  }
}

// ── Auxiliares para classificar erros do WhatsApp/HTTP ──────────────────────
function parseHttpStatus(msg) {
  const m = String(msg).match(/\((\d{3})\)/);
  return m ? Number(m[1]) : null;
}
function parseRetryAfter(msg) {
  const m = String(msg).match(/retry-?after[":\s]+(\d+)/i);
  return m ? Number(m[1]) * 1000 : null;
}
function isPermanentError(msg) {
  const s = String(msg).toLowerCase();
  return (
    /invalid.*(phone|number|to)|number.*not.*whatsapp|not.*a.*valid.*whatsapp/i.test(s) ||
    /template.*(disapproved|paused|invalid|not.*found)|no.*such.*template/i.test(s) ||
    /permission|not.*authorized|forbidden|401|403/.test(s) ||
    /"code"\s*:\s*(131026|132001|132000|132007|132015|132016)/.test(s)
  );
}
function safeJson(s) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }

// ── Singleton ──────────────────────────────────────────────────────────────
export const runner = new Runner(outboundConfig);
export function outboundMetrics() { return runner.metrics(); }

let tickTimer = null;
let reclaimTimer = null;

export function startOutboundWorker() {
  reclaimStaleLocks();
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    try { runner.tick(); } catch (e) { console.error('[outbound] tick falhou:', e.message); }
  }, outboundConfig.pollIntervalMs);
  tickTimer.unref?.();
  // Sweep periódico: itens travados por >lockTimeoutMs voltam pra pending.
  reclaimTimer = setInterval(() => {
    try { reclaimStaleLocks(); } catch (e) { console.error('[outbound] reclaim falhou:', e.message); }
  }, Math.max(30_000, outboundConfig.lockTimeoutMs / 2));
  reclaimTimer.unref?.();
  console.log(`[outbound] worker iniciado (concurrency=${outboundConfig.concurrency}, per_tenant=${outboundConfig.maxPerTenant}).`);
}

export function stopOutboundWorker() {
  runner.stop();
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (reclaimTimer) { clearInterval(reclaimTimer); reclaimTimer = null; }
}

export function reclaimStaleLocks() {
  const window = `-${Math.round(outboundConfig.lockTimeoutMs / 1000)} seconds`;
  outboundJobItemQueries.reclaimStale.run(window);
  outboundJobQueries.reclaimStale.run(window);
}

// Força uma passada — usado nos testes pra não precisar esperar o setInterval.
export async function drainForTesting({ ticks = 20, delayMs = 5 } = {}) {
  for (let i = 0; i < ticks; i++) {
    runner.tick();
    if (runner.running === 0) {
      // dá uma respiração pro microtask fila terminar
      await new Promise((r) => setTimeout(r, delayMs));
      const rows = outboundJobItemQueries.distinctTenantsPending.all();
      if (!rows.length) return;
    } else {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// Reset completo — útil em testes; não usar em produção.
export function _resetForTesting() {
  runner.running = 0;
  runner.perTenant.clear();
  runner.tenantPauseUntil.clear();
  runner.lastSendAt.clear();
  runner.stats = { picked: 0, sent: 0, failed: 0, retried: 0, rejected: 0 };
  runner.stopped = false;
  clearTenantCache();
}

// ── Criação de jobs pela API ────────────────────────────────────────────────
import { randomUUID } from 'node:crypto';

/**
 * Cria um job de outbound + os itens correspondentes.
 * @returns {{ job_id, status, total, deduped? }}
 */
export function createOutboundJob({
  tenantId, type, payload = {}, items = [], idempotencyKey = null, scheduledAt = null,
}) {
  if (!tenantId) throw new Error('tenantId obrigatório');
  if (!type) throw new Error('type obrigatório');
  if (!Array.isArray(items) || !items.length) throw new Error('items vazio');

  // Idempotência: se o mesmo tenant já criou um job com essa chave, devolve o
  // existente em vez de duplicar. Evita reenvio quando o front tenta 2x.
  if (idempotencyKey) {
    const existing = outboundJobQueries.findByIdempotency.get(tenantId, idempotencyKey);
    if (existing) {
      return { job_id: existing.id, status: existing.status, total: existing.total_items, duplicated: true };
    }
  }

  const jobId = 'obj_' + randomUUID().replace(/-/g, '').slice(0, 24);
  const total = items.length;

  const insertTx = db.transaction(() => {
    outboundJobQueries.insert.run({
      id: jobId,
      tenant_id: tenantId,
      type,
      total_items: total,
      pending_items: total,
      payload_json: JSON.stringify(payload || {}),
      idempotency_key: idempotencyKey || null,
      scheduled_at: scheduledAt || null,
      next_run_at: scheduledAt || null,
    });
    for (const it of items) {
      outboundJobItemQueries.insert.run({
        id: 'obi_' + randomUUID().replace(/-/g, '').slice(0, 24),
        job_id: jobId,
        tenant_id: tenantId,
        contact_id: it.contact_id != null ? Number(it.contact_id) : null,
        destination: it.destination || null,
        payload_json: it.payload ? JSON.stringify(it.payload) : null,
      });
    }
    outboundJobQueries.refreshCounters.run(jobId);
  });
  insertTx();
  return { job_id: jobId, status: 'pending', total };
}
