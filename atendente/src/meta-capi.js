import { createHash, randomUUID } from 'node:crypto';
import {
  db,
  tenantQueries,
  decryptTenant,
  marketingConversionQueries,
  conversionJobQueries,
  contactQueries,
  attributionClickQueries,
  marketingLinkQueries,
} from './db.js';
import { subscriptionState } from './db.js';
import { getPlanLimits } from './plans.js';
import { emitDomainEvent } from './domain-events.js';

// Configurações do worker
const workerConfig = {
  concurrency: Math.max(1, Number(process.env.CONVERSION_CONCURRENCY) || 2),
  maxPerTenant: Math.max(1, Number(process.env.CONVERSION_MAX_PER_TENANT) || 1),
  maxAttempts: Math.max(1, Number(process.env.CONVERSION_MAX_ATTEMPTS) || 6),
  lockTimeoutMs: Math.max(10000, Number(process.env.CONVERSION_LOCK_TIMEOUT_MS) || 120000),
  retryBaseMs: Math.max(1000, Number(process.env.CONVERSION_RETRY_BASE_MS) || 5000),
  pollIntervalMs: Math.max(500, Number(process.env.CONVERSION_POLL_INTERVAL_MS) || 1000),
};

const tenantCache = new Map();
const runningJobs = new Set(); // Evita reprocessar em paralelo no mesmo loop tick

function loadTenant(tenantId) {
  if (tenantCache.has(tenantId)) return tenantCache.get(tenantId);
  const row = tenantQueries.byId.get(tenantId);
  const tenant = row ? decryptTenant(row) : null;
  tenantCache.set(tenantId, tenant);
  return tenant;
}

export function clearTenantCache() {
  tenantCache.clear();
}

/**
 * Normaliza e gera o hash SHA-256 (hex) de uma string.
 */
export function hashValue(val) {
  if (!val) return null;
  return createHash('sha256').update(String(val).trim().toLowerCase()).digest('hex');
}

/**
 * Normaliza e gera o hash SHA-256 (hex) de um telefone.
 */
export function hashPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return createHash('sha256').update(digits).digest('hex');
}

class CapiRunner {
  constructor() {
    this.running = 0;
    this.perTenant = new Map();
    this.tenantCursor = 0;
    this.tenantPauseUntil = new Map();
    this.stats = { picked: 0, sent: 0, failed: 0, retried: 0 };
    this.stopped = false;
  }

  metrics() {
    return {
      running: this.running,
      per_tenant: Object.fromEntries(this.perTenant),
      concurrency: workerConfig.concurrency,
      ...this.stats,
    };
  }

  stop() {
    this.stopped = true;
  }

  _nextTenant() {
    const rows = conversionJobQueries.distinctTenantsPending.all();
    const active = rows
      .map((r) => r.tenant_id)
      .filter((tid) => {
        const busy = (this.perTenant.get(tid) || 0) >= workerConfig.maxPerTenant;
        const pausedUntil = this.tenantPauseUntil.get(tid) || 0;
        return !busy && Date.now() >= pausedUntil;
      });
    if (!active.length) return null;
    active.sort();
    const idx = this.tenantCursor % active.length;
    this.tenantCursor = (idx + 1) % Math.max(active.length, 1);
    return active[idx];
  }

  tick() {
    if (this.stopped) return;
    while (this.running < workerConfig.concurrency) {
      const tenantId = this._nextTenant();
      if (!tenantId) return;
      const next = conversionJobQueries.nextByTenant.get(tenantId);
      if (!next) return;
      if (runningJobs.has(next.id)) return;

      const lockToken = randomUUID();
      const reserved = conversionJobQueries.reserveById.get(lockToken, next.id);
      if (!reserved) continue;

      runningJobs.add(reserved.id);
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
        console.error('[CAPI] Handler crash:', err.message);
        this._handleError(job, err, 'CRASH');
      })
      .finally(() => {
        runningJobs.delete(job.id);
        this.running--;
        this.perTenant.set(job.tenant_id, Math.max(0, (this.perTenant.get(job.tenant_id) || 1) - 1));
      });
  }

  async _run(job) {
    const tenant = loadTenant(job.tenant_id);
    if (!tenant || !tenant.active) {
      this._handleError(job, new Error('Tenant inativo ou não encontrado'), 'TENANT_INACTIVE', true);
      return;
    }

    const sub = subscriptionState(tenant);
    const limits = getPlanLimits(tenant.plan, sub.status);
    if (!limits.metaCapiEnabled || !tenant.capi_enabled) {
      this._handleError(job, new Error('CAPI desativada no plano ou nas configurações'), 'DISABLED', true);
      return;
    }

    const pixelId = tenant.capi_pixel_id;
    const accessToken = tenant.capi_access_token;
    if (!pixelId || !accessToken) {
      this._handleError(job, new Error('Pixel ID ou Access Token ausente nas configurações'), 'CONFIG_MISSING', true);
      return;
    }

    // Carrega detalhes do evento de conversão e contato
    const event = marketingConversionQueries.byId.get(job.conversion_event_id, tenant.id);
    if (!event) {
      this._handleError(job, new Error('Evento de conversão não encontrado'), 'EVENT_NOT_FOUND', true);
      return;
    }

    const contact = contactQueries.byId.get(event.contact_id);
    if (!contact) {
      this._handleError(job, new Error('Contato não encontrado'), 'CONTACT_NOT_FOUND', true);
      return;
    }

    // Hashing de dados do usuário
    const userData = {};
    const hashedPhone = hashPhone(contact.wa_phone);
    if (hashedPhone) userData.ph = [hashedPhone];

    // Busca e normaliza email se houver
    if (contact.email) {
      const hashedEmail = hashValue(contact.email);
      if (hashedEmail) userData.em = [hashedEmail];
    }

    // Busca cookies de atribuição e clids do último clique
    let fbc = null;
    let userAgent = null;
    let referrer = null;

    const click = event.marketing_link_id ? db.prepare(`
      SELECT ac.* FROM attribution_clicks ac
      JOIN contact_attributions ca ON ca.last_touch_click_id = ac.id
      WHERE ca.contact_id = ? AND ca.tenant_id = ?
    `).get(contact.id, tenant.id) : null;

    if (click) {
      userAgent = click.user_agent_summary || null;
      referrer = click.referrer || null;
      if (click.fbclid) {
        const clickedTime = Math.round(new Date(click.clicked_at).getTime() / 1000);
        fbc = `fb.1.${clickedTime}.${click.fbclid}`;
      }
    }

    if (fbc) userData.fbc = fbc;
    if (userAgent) userData.client_user_agent = userAgent;

    // Constrói payload da Meta CAPI
    const customData = {};
    if (event.value_cents != null) {
      customData.value = Number((event.value_cents / 100).toFixed(2));
      customData.currency = event.currency || 'BRL';
    }

    const payloadEvent = {
      event_name: event.event_name,
      event_time: event.event_time,
      event_id: event.event_id,
      action_source: 'chat',
      user_data: userData,
      custom_data: Object.keys(customData).length ? customData : undefined,
      opt_out: false,
    };

    if (referrer) {
      payloadEvent.event_source_url = referrer;
    }

    const body = {
      data: [payloadEvent],
    };

    if (tenant.capi_test_code) {
      body.test_event_code = tenant.capi_test_code;
    }

    const version = tenant.capi_graph_version || 'v21.0';
    const url = `https://graph.facebook.com/${version}/${pixelId}/events`;

    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });

      const resJson = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errCode = resJson.error?.code || 'META_API_ERROR';
        const errMsg = resJson.error?.message || `Status HTTP ${res.status}`;
        throw new MetaCapiError(errMsg, errCode, res.status === 429);
      }

      conversionJobQueries.markCompleted.run(job.id);
      db.prepare(`UPDATE conversion_events SET status = 'completed' WHERE id = ?`).run(job.conversion_event_id);
      this.stats.sent++;
      console.log(`[CAPI] Evento ${event.event_name} (${event.event_id}) enviado com sucesso para ${tenant.business_name} em ${Date.now() - start}ms.`);
    } catch (err) {
      this._handleError(job, err, err.code || 'HTTP_ERROR');
    }
  }

  _handleError(job, err, code, permanent = false) {
    const attempts = job.attempts + 1;
    const isRateLimit = err instanceof MetaCapiError && err.isRateLimit;
    const isPermanent = permanent || (!isRateLimit && attempts >= workerConfig.maxAttempts);

    if (isPermanent) {
      conversionJobQueries.markFailed.run(code, String(err.message).slice(0, 500), job.id);
      db.prepare(`UPDATE conversion_events SET status = 'failed' WHERE id = ?`).run(job.conversion_event_id);
      this.stats.failed++;
      console.error(`[CAPI] Job ${job.id} falhou permanentemente (tentativa ${attempts}/${workerConfig.maxAttempts}): ${err.message}`);

      // Emitir evento de domínio sobre falha crítica na entrega
      emitDomainEvent({
        tenantId: job.tenant_id,
        type: 'conversion_delivery_failed',
        entityType: 'contact',
        entityId: null,
        payload: {
          job_id: job.id,
          conversion_event_id: job.conversion_event_id,
          error_code: code,
          error_message: err.message,
        },
      });
    } else {
      // Re-agenda com backoff exponencial + jitter
      const jitter = 0.75 + Math.random() * 0.5; // ±25%
      const backoff = Math.round(workerConfig.retryBaseMs * Math.pow(2, attempts) * jitter);
      const nextRun = new Date(Date.now() + backoff).toISOString().replace('T', ' ').slice(0, 19);

      conversionJobQueries.markRetry.run(nextRun, code, String(err.message).slice(0, 500), job.id);
      this.stats.retried++;
      console.warn(`[CAPI] Job ${job.id} falhou temporariamente (tentativa ${attempts}/${workerConfig.maxAttempts}): ${err.message}. Remarcado para ${nextRun}`);

      if (isRateLimit) {
        // Pausa temporária do tenant por 1 minuto
        this.tenantPauseUntil.set(job.tenant_id, Date.now() + 60000);
      }
    }
  }
}

class MetaCapiError extends Error {
  constructor(message, code, isRateLimit = false) {
    super(message);
    this.name = 'MetaCapiError';
    this.code = code;
    this.isRateLimit = isRateLimit;
  }
}

let tickTimer = null;
let reclaimTimer = null;
const runner = new CapiRunner();

export function startConversionWorker() {
  reclaimStaleLocks();
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    try {
      runner.tick();
    } catch (e) {
      console.error('[CAPI] Worker tick falhou:', e.message);
    }
  }, workerConfig.pollIntervalMs);
  tickTimer.unref?.();

  reclaimTimer = setInterval(() => {
    try {
      reclaimStaleLocks();
    } catch (e) {
      console.error('[CAPI] Reclaim falhou:', e.message);
    }
  }, Math.max(30000, workerConfig.lockTimeoutMs / 2));
  reclaimTimer.unref?.();

  console.log(`[CAPI] Worker persistente de entrega iniciado (concurrency=${workerConfig.concurrency}, per_tenant=${workerConfig.maxPerTenant}).`);
}

export function stopConversionWorker() {
  runner.stop();
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (reclaimTimer) {
    clearInterval(reclaimTimer);
    reclaimTimer = null;
  }
}

export function reclaimStaleLocks() {
  const window = `-${Math.round(workerConfig.lockTimeoutMs / 1000)} seconds`;
  conversionJobQueries.reclaimStale.run(window);
}

export function conversionMetrics() {
  return runner.metrics();
}

/**
 * Envia um evento de teste imediato para CAPI para validar credenciais.
 * Retorna { ok: true } ou lança erro.
 */
export async function sendTestEvent(tenant, testCode) {
  const pixelId = tenant.capi_pixel_id;
  const accessToken = tenant.capi_access_token;
  if (!pixelId || !accessToken) {
    throw new Error('Pixel ID ou Access Token ausente nas configurações');
  }

  const payloadEvent = {
    event_name: 'Lead',
    event_time: Math.round(Date.now() / 1000),
    event_id: 'test_' + randomUUID().replace(/-/g, '').slice(0, 12),
    action_source: 'chat',
    user_data: {
      ph: [hashPhone('5511999999999')],
    },
    opt_out: false,
  };

  const body = {
    data: [payloadEvent],
  };
  if (testCode) {
    body.test_event_code = testCode;
  }

  const version = tenant.capi_graph_version || 'v21.0';
  const url = `https://graph.facebook.com/${version}/${pixelId}/events`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const resJson = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = resJson.error?.message || `Status HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  return { ok: true, metaResponse: resJson };
}

// Força execução para testes
export async function drainConversionsForTesting({ ticks = 20, delayMs = 5 } = {}) {
  for (let i = 0; i < ticks; i++) {
    runner.tick();
    if (runner.running === 0) {
      await new Promise((r) => setTimeout(r, delayMs));
      const rows = conversionJobQueries.distinctTenantsPending.all();
      if (!rows.length) return;
    } else {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export function _resetForTesting() {
  runner.running = 0;
  runner.perTenant.clear();
  runner.tenantPauseUntil.clear();
  runner.stats = { picked: 0, sent: 0, failed: 0, retried: 0 };
  runningJobs.clear();
}
