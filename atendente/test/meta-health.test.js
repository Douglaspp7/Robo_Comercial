import './_setup.js';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, metaHealthQueries, decryptTenant } from '../src/db.js';
import { encryptSecret } from '../src/crypto.js';
import {
  checkCredentials,
  checkTenantMetaHealth,
  getTenantMetaHealthView,
  resolveMetaCredentials,
  recordInbound,
  recordOutboundSuccess,
  recordOutboundError,
  summarizeMetaError,
  maskPhoneNumberId,
  metaHealthAggregates,
  _setFetchForTesting,
  _resetFetchForTesting,
} from '../src/meta-health.js';

function makeTenant(extra = {}) {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(id, `${id}@test.com`);
  if (extra.wa_phone_number_id) {
    db.prepare(`UPDATE tenants SET wa_phone_number_id = ?, wa_token = ? WHERE id = ?`)
      .run(extra.wa_phone_number_id, encryptSecret(extra.wa_token || 'tok-teste'), id);
  }
  return decryptTenant(tenantQueries.byId.get(id));
}

function fakeResponse(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: { get: (k) => headers[k.toLowerCase()] || null },
  };
}

afterEach(() => _resetFetchForTesting());

// ── Mapeamento de respostas da Graph API ─────────────────────────────────────

test('checkCredentials: 200 com campos completos → healthy', async () => {
  _setFetchForTesting(async (url) => {
    if (url.includes('whatsapp_business_account')) return fakeResponse(400, { error: { code: 100, message: 'campo' } });
    return fakeResponse(200, {
      display_phone_number: '+55 11 99999-0000',
      verified_name: 'Loja Teste',
      quality_rating: 'GREEN',
      messaging_limit_tier: 'TIER_1K',
    });
  });
  const r = await checkCredentials({ phoneNumberId: '123456789012345', token: 't' });
  assert.equal(r.status, 'healthy');
  assert.equal(r.token.valid, true);
  assert.equal(r.phone.verified_name, 'Loja Teste');
  assert.equal(r.phone.messaging_limit, 'TIER_1K');
  assert.equal(r.issues.length, 0);
});

test('checkCredentials: 401 → token inválido, critical', async () => {
  _setFetchForTesting(async () => fakeResponse(401, { error: { code: 190, message: 'Invalid OAuth access token' } }));
  const r = await checkCredentials({ phoneNumberId: '123', token: 'ruim' });
  assert.equal(r.status, 'critical');
  assert.equal(r.token.valid, false);
  assert.ok(r.issues.some((i) => i.code === 'token_invalid'));
});

test('checkCredentials: timeout → unknown (nunca critical)', async () => {
  _setFetchForTesting(async () => {
    const e = new Error('Timeout (10000ms) ao chamar graph.facebook.com');
    e.code = 'ETIMEDOUT';
    throw e;
  });
  const r = await checkCredentials({ phoneNumberId: '123', token: 't' });
  assert.equal(r.status, 'unknown');
  assert.ok(r.issues.some((i) => i.code === 'timeout'));
});

test('checkCredentials: 429 com Retry-After → unknown + retry_after_ms', async () => {
  _setFetchForTesting(async () =>
    fakeResponse(429, { error: { code: 4, message: 'rate limit' } }, { 'retry-after': '120' }));
  const r = await checkCredentials({ phoneNumberId: '123', token: 't' });
  assert.equal(r.status, 'unknown');
  assert.equal(r.retry_after_ms, 120_000);
  assert.ok(r.issues.some((i) => i.code === 'rate_limited'));
});

test('checkCredentials: 5xx → unknown (Meta instável)', async () => {
  _setFetchForTesting(async () => fakeResponse(500, 'Internal Server Error'));
  const r = await checkCredentials({ phoneNumberId: '123', token: 't' });
  assert.equal(r.status, 'unknown');
  assert.ok(r.issues.some((i) => i.code === 'meta_unavailable'));
});

test('checkCredentials: campo não suportado (code 100) degrada para conjunto menor', async () => {
  let calls = 0;
  _setFetchForTesting(async (url) => {
    if (url.includes('whatsapp_business_account')) return fakeResponse(400, { error: { code: 100 } });
    calls++;
    if (url.includes('messaging_limit_tier')) {
      return fakeResponse(400, { error: { code: 100, message: 'nonexisting field messaging_limit_tier' } });
    }
    return fakeResponse(200, { display_phone_number: '+55 11 98888-0000', verified_name: 'Loja', quality_rating: 'GREEN' });
  });
  const r = await checkCredentials({ phoneNumberId: '123', token: 't' });
  assert.equal(r.status, 'healthy');
  assert.equal(r.phone.messaging_limit, null); // campo ausente ≠ problema
  assert.ok(calls >= 2, 'deve ter tentado o fallback de campos');
});

test('checkCredentials: qualidade RED → critical; YELLOW → warning', async () => {
  _setFetchForTesting(async (url) => {
    if (url.includes('whatsapp_business_account')) return fakeResponse(400, { error: { code: 100 } });
    return fakeResponse(200, { display_phone_number: 'x', verified_name: 'x', quality_rating: 'RED' });
  });
  assert.equal((await checkCredentials({ phoneNumberId: '1', token: 't' })).status, 'critical');
  _setFetchForTesting(async (url) => {
    if (url.includes('whatsapp_business_account')) return fakeResponse(400, { error: { code: 100 } });
    return fakeResponse(200, { display_phone_number: 'x', verified_name: 'x', quality_rating: 'YELLOW' });
  });
  assert.equal((await checkCredentials({ phoneNumberId: '1', token: 't' })).status, 'warning');
});

test('checkCredentials: templates contados quando WABA disponível', async () => {
  _setFetchForTesting(async (url) => {
    if (url.includes('whatsapp_business_account')) {
      return fakeResponse(200, { whatsapp_business_account: { id: 'waba1' } });
    }
    if (url.includes('/waba1/message_templates')) {
      return fakeResponse(200, {
        data: [
          { status: 'APPROVED' }, { status: 'APPROVED' },
          { status: 'PENDING' }, { status: 'REJECTED' }, { status: 'WEIRD' },
        ],
      });
    }
    return fakeResponse(200, { display_phone_number: 'x', verified_name: 'x', quality_rating: 'GREEN' });
  });
  const r = await checkCredentials({ phoneNumberId: '1', token: 't' });
  assert.deepEqual(r.templates, { approved: 2, pending: 1, rejected: 1, unknown: 1 });
});

test('checkCredentials: sem credencial → not_configured', async () => {
  const r = await checkCredentials({});
  assert.equal(r.status, 'not_configured');
});

// ── Resumo seguro de erros ───────────────────────────────────────────────────

test('summarizeMetaError extrai código/mensagem sem vazar corpo inteiro nem token', () => {
  const body = JSON.stringify({
    error: { code: 131042, message: 'Payment issue. Bearer EAAtokenSecreto123 foo' },
    debug: 'x'.repeat(1000),
  });
  const { code, summary } = summarizeMetaError(400, body);
  assert.equal(code, '131042');
  assert.ok(summary.length <= 160);
  assert.ok(!summary.includes('EAAtokenSecreto123'));
});

test('maskPhoneNumberId nunca devolve o id inteiro', () => {
  assert.equal(maskPhoneNumberId('123456789012345'), '1234…2345');
  assert.ok(!maskPhoneNumberId('123456789012345').includes('56789'));
});

// ── Telemetria + isolamento entre tenants ────────────────────────────────────

test('telemetria de inbound/outbound é isolada por tenant', () => {
  const a = makeTenant();
  const b = makeTenant();
  recordInbound(a.id);
  recordOutboundSuccess(a.id);
  recordOutboundError(b.id, 400, JSON.stringify({ error: { code: 131026, message: 'not a valid whatsapp user' } }));

  const rowA = metaHealthQueries.get.get(a.id);
  const rowB = metaHealthQueries.get.get(b.id);
  assert.ok(rowA.last_inbound_at);
  assert.ok(rowA.last_outbound_success_at);
  assert.equal(rowA.last_error_code, null);
  assert.equal(rowB.last_inbound_at, null);
  assert.equal(rowB.last_error_code, '131026');
});

test('checkTenantMetaHealth persiste snapshot e a view devolve estados por tenant', async () => {
  const t = makeTenant({ wa_phone_number_id: '999888777666555', wa_token: 'tok' });
  _setFetchForTesting(async (url) => {
    if (url.includes('whatsapp_business_account')) return fakeResponse(400, { error: { code: 100 } });
    return fakeResponse(200, { display_phone_number: '+55 11 97777-0000', verified_name: 'Própria', quality_rating: 'GREEN' });
  });
  const view = await checkTenantMetaHealth(t);
  assert.equal(view.status, 'healthy');
  assert.equal(view.source, 'tenant');
  assert.equal(view.phone.verified_name, 'Própria');
  assert.equal(view.phone.phone_number_id_masked, '9998…6555');
  assert.ok(view.checked_at);

  // Outro tenant sem nada não herda o estado deste.
  const other = makeTenant();
  const otherView = getTenantMetaHealthView(other);
  assert.notEqual(otherView.phone.verified_name, 'Própria');
});

test('view nunca inclui token e ausência de tráfego não vira problema', async () => {
  const t = makeTenant({ wa_phone_number_id: '111222333444555', wa_token: 'segredo-token' });
  _setFetchForTesting(async (url) => {
    if (url.includes('whatsapp_business_account')) return fakeResponse(400, { error: { code: 100 } });
    return fakeResponse(200, { display_phone_number: 'x', verified_name: 'x', quality_rating: 'GREEN' });
  });
  const view = await checkTenantMetaHealth(t);
  const json = JSON.stringify(view);
  assert.ok(!json.includes('segredo-token'));
  // sem last_inbound_at (nunca recebeu mensagem) e mesmo assim healthy:
  assert.equal(view.webhook.last_inbound_at, null);
  assert.equal(view.status, 'healthy');
});

test('transição para critical registra evento; repetição não duplica', async () => {
  const t = makeTenant({ wa_phone_number_id: '222333444555666', wa_token: 'tok' });
  _setFetchForTesting(async () => fakeResponse(401, { error: { code: 190, message: 'invalid' } }));
  await checkTenantMetaHealth(t);
  await checkTenantMetaHealth(t); // mesmo estado — não deve inserir 2º evento
  const events = metaHealthQueries.recentEvents.all(t.id).filter((e) => e.event_type === 'status_critical');
  assert.equal(events.length, 1);
});

test('metaHealthAggregates devolve só contagens agregadas', async () => {
  const agg = metaHealthAggregates();
  assert.deepEqual(Object.keys(agg).sort(), ['critical_tenants', 'healthy_tenants', 'last_check_errors', 'warning_tenants']);
  for (const v of Object.values(agg)) assert.equal(typeof v, 'number');
});

test('resolveMetaCredentials prioriza credencial própria do tenant', () => {
  const own = makeTenant({ wa_phone_number_id: '777', wa_token: 'tok' });
  const creds = resolveMetaCredentials(own);
  assert.equal(creds.source, 'tenant');
  assert.equal(creds.phoneNumberId, '777');
});
