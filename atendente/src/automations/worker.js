/**
 * Worker persistente das automações — segue o padrão do outbound-queue:
 * reserva atômica (UPDATE ... RETURNING) com lock_token, recuperação de locks
 * expirados no boot e periodicamente, retry com backoff, concorrência global
 * e por tenant, justiça round-robin e parada segura.
 *
 * Nota de retry: o dedupe do run (UNIQUE tenant+dedupe_key) fica DENTRO da
 * execução — um retry após crash anterior ao insert do run recomeça limpo;
 * um retry após o insert é bloqueado pelo dedupe (nunca executa ação 2x).
 */
import { randomUUID } from 'node:crypto';
import {
  automationJobQueries,
  automationQueries,
  automationEventQueries,
  automationRunQueries,
  tenantQueries,
  decryptTenant,
} from '../db.js';
import { runAutomationForEvent } from './engine.js';

export const automationWorkerConfig = {
  enabled: process.env.AUTOMATIONS_ENABLED !== 'false',
  concurrency: Math.max(1, Number(process.env.AUTOMATION_CONCURRENCY) || 3),
  maxPerTenant: Math.max(1, Number(process.env.AUTOMATION_MAX_PER_TENANT) || 1),
  maxAttempts: Math.max(1, Number(process.env.AUTOMATION_MAX_ATTEMPTS) || 5),
  lockTimeoutMs: Math.max(10_000, Number(process.env.AUTOMATION_LOCK_TIMEOUT_MS) || 120_000),
  pollIntervalMs: Math.max(200, Number(process.env.AUTOMATION_POLL_INTERVAL_MS) || 1_000),
  retryBaseMs: Math.max(500, Number(process.env.AUTOMATION_RETRY_BASE_MS) || 5_000),
};

class AutomationRunner {
  constructor(config) {
    this.config = config;
    this.running = 0;
    this.perTenant = new Map();
    this.tenantCursor = 0;
    this.stats = { picked: 0, succeeded: 0, skipped: 0, failed: 0, retried: 0 };
    this.stopped = false;
  }

  metrics() {
    return { running: this.running, ...this.stats };
  }

  stop() { this.stopped = true; }

  _nextTenant() {
    const rows = automationJobQueries.distinctTenantsDue.all();
    const active = rows
      .map((r) => r.tenant_id)
      .filter((tid) => (this.perTenant.get(tid) || 0) < this.config.maxPerTenant);
    if (!active.length) return null;
    active.sort();
    const idx = this.tenantCursor % active.length;
    this.tenantCursor = (idx + 1) % Math.max(active.length, 1);
    return active[idx];
  }

  tick() {
    if (this.stopped) return;
    while (this.running < this.config.concurrency) {
      const tenantId = this._nextTenant();
      if (!tenantId) return;
      const next = automationJobQueries.nextDueByTenant.get(tenantId);
      if (!next) return;
      const reserved = automationJobQueries.reserveById.get({
        id: next.id,
        lock_token: randomUUID(),
      });
      if (!reserved) continue; // outro worker levou
      this._dispatch(reserved);
    }
  }

  _dispatch(job) {
    this.running++;
    this.perTenant.set(job.tenant_id, (this.perTenant.get(job.tenant_id) || 0) + 1);
    this.stats.picked++;
    Promise.resolve()
      .then(() => this._run(job))
      .catch((err) => {
        console.error('[automations] job crashou:', err?.message || err);
        this._handleError(job, err);
      })
      .finally(() => {
        this.running--;
        this.perTenant.set(job.tenant_id, Math.max(0, (this.perTenant.get(job.tenant_id) || 1) - 1));
      });
  }

  async _run(job) {
    const automation = automationQueries.byId.get(job.automation_id, job.tenant_id);
    if (!automation || !automation.enabled) {
      automationJobQueries.markCancelled.run(job.id);
      this.stats.skipped++;
      return;
    }
    const event = automationEventQueries.byId.get(job.event_id);
    if (!event || event.tenant_id !== job.tenant_id) {
      automationJobQueries.markCancelled.run(job.id);
      this.stats.skipped++;
      return;
    }
    const tenantRow = tenantQueries.byId.get(job.tenant_id);
    if (!tenantRow || !tenantRow.active) {
      automationJobQueries.markCancelled.run(job.id);
      this.stats.skipped++;
      return;
    }
    const tenant = decryptTenant(tenantRow);

    const result = await runAutomationForEvent({ tenant, automation, event });
    automationJobQueries.markDone.run(job.id);
    if (result.status === 'success') this.stats.succeeded++;
    else if (result.status === 'skipped') this.stats.skipped++;
    else this.stats.failed++;
  }

  _handleError(job, err) {
    const detail = String(err?.message || err || 'erro').slice(0, 300);
    if (job.attempts >= this.config.maxAttempts) {
      automationJobQueries.markFailed.run(detail, job.id);
      this.stats.failed++;
      return;
    }
    const base = this.config.retryBaseMs * Math.pow(2, Math.max(0, job.attempts - 1));
    const jitter = base * 0.25 * (Math.random() * 2 - 1);
    const delayMs = Math.max(this.config.retryBaseMs, Math.round(base + jitter));
    const next = new Date(Date.now() + delayMs).toISOString().replace('T', ' ').slice(0, 19);
    automationJobQueries.markRetry.run(next, detail, job.id);
    this.stats.retried++;
  }
}

export const automationRunner = new AutomationRunner(automationWorkerConfig);

let tickTimer = null;
let reclaimTimer = null;

export function reclaimStaleAutomationLocks() {
  const window = `-${Math.round(automationWorkerConfig.lockTimeoutMs / 1000)} seconds`;
  automationJobQueries.reclaimStale.run(window);
}

export function startAutomationWorker() {
  if (!automationWorkerConfig.enabled) {
    console.log('[automations] worker desativado (AUTOMATIONS_ENABLED=false).');
    return;
  }
  reclaimStaleAutomationLocks();
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    try { automationRunner.tick(); } catch (e) { console.error('[automations] tick falhou:', e.message); }
  }, automationWorkerConfig.pollIntervalMs);
  tickTimer.unref?.();
  reclaimTimer = setInterval(() => {
    try {
      reclaimStaleAutomationLocks();
      automationEventQueries.cleanup.run();
      automationJobQueries.cleanup.run();
    } catch (e) { console.error('[automations] manutenção falhou:', e.message); }
  }, Math.max(30_000, automationWorkerConfig.lockTimeoutMs / 2));
  reclaimTimer.unref?.();
  console.log(`[automations] worker iniciado (concurrency=${automationWorkerConfig.concurrency}, per_tenant=${automationWorkerConfig.maxPerTenant}).`);
}

export function stopAutomationWorker() {
  automationRunner.stop();
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (reclaimTimer) { clearInterval(reclaimTimer); reclaimTimer = null; }
}

/** Métricas agregadas para o /health — nunca dados de clientes. */
export function automationHealthMetrics() {
  let counts = {};
  try {
    counts = Object.fromEntries(automationJobQueries.statusCounts.all().map((r) => [r.status, r.n]));
  } catch { /* noop */ }
  let eventsPending = 0;
  let runs24h = 0;
  try { eventsPending = automationEventQueries.countPending.get()?.n || 0; } catch { /* noop */ }
  try { runs24h = automationRunQueries.countLast24h.get()?.n || 0; } catch { /* noop */ }
  return {
    events_pending: eventsPending,
    jobs_pending: (counts.pending || 0) + (counts.retry || 0),
    jobs_processing: counts.processing || 0,
    jobs_failed: counts.failed || 0,
    runs_last_24h: runs24h,
  };
}

// Força passadas do worker — usado nos testes (sem esperar setInterval).
export async function drainAutomationsForTesting({ ticks = 30, delayMs = 5 } = {}) {
  for (let i = 0; i < ticks; i++) {
    automationRunner.tick();
    await new Promise((r) => setTimeout(r, delayMs));
    if (automationRunner.running === 0) {
      const due = automationJobQueries.distinctTenantsDue.all();
      if (!due.length) return;
    }
  }
}

export function _resetAutomationRunnerForTesting() {
  automationRunner.running = 0;
  automationRunner.perTenant.clear();
  automationRunner.stats = { picked: 0, succeeded: 0, skipped: 0, failed: 0, retried: 0 };
  automationRunner.stopped = false;
}
