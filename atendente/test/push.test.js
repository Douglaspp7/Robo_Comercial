import './_setup.js';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, tenantQueries, pushSubscriptionQueries, decryptTenant } from '../src/db.js';
import {
  webPushEnabled,
  getPushPreferences,
  setPushPreferences,
  saveSubscription,
  removeSubscription,
  claimPushDedupe,
  clearPushDedupe,
  sendPushEvent,
  PUSH_CATEGORIES,
  _setSenderForTesting,
  _resetSenderForTesting,
} from '../src/push.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeTenant() {
  const id = randomUUID();
  db.prepare(`INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, 'h')`).run(id, `${id}@test.com`);
  return decryptTenant(tenantQueries.byId.get(id));
}

function subscribe(tenantId, n = 1) {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}-${n}`;
  saveSubscription(tenantId, { endpoint, keys: { p256dh: 'BPabc123-_', auth: 'authkey123' } }, 'test-agent');
  return endpoint;
}

afterEach(() => _resetSenderForTesting());

// ── Sem VAPID configurado (padrão nos testes) ────────────────────────────────

test('sem VAPID configurado, webPushEnabled=false e sendPushEvent vira no-op', async () => {
  assert.equal(webPushEnabled, false);
  const t = makeTenant();
  subscribe(t.id);
  const result = await sendPushEvent({
    tenantId: t.id, event: 'sale_paid', title: 'Venda confirmada', body: 'x', url: '/vendas.html',
  });
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 'disabled');
});

// ── Assinaturas ──────────────────────────────────────────────────────────────

test('saveSubscription valida endpoint https e chaves; upsert reativa endpoint', () => {
  const t = makeTenant();
  assert.throws(() => saveSubscription(t.id, { endpoint: 'http://inseguro.com/x', keys: { p256dh: 'a', auth: 'b' } }));
  assert.throws(() => saveSubscription(t.id, { endpoint: 'https://ok.com/x', keys: { p256dh: '', auth: 'b' } }));
  assert.throws(() => saveSubscription(t.id, { endpoint: 'https://ok.com/x', keys: { p256dh: 'tem espaço', auth: 'b' } }));

  const endpoint = subscribe(t.id);
  const subs = pushSubscriptionQueries.listActiveByTenant.all(t.id);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].endpoint, endpoint);

  // Re-assinar o mesmo endpoint (mesmo aparelho) não duplica e reativa.
  pushSubscriptionQueries.disableById.run(subs[0].id);
  saveSubscription(t.id, { endpoint, keys: { p256dh: 'BPnovo', auth: 'novoauth' } }, 'agent2');
  const after = pushSubscriptionQueries.listActiveByTenant.all(t.id);
  assert.equal(after.length, 1);
  assert.equal(after[0].p256dh, 'BPnovo');
  assert.equal(after[0].failure_count, 0);
});

test('removeSubscription só remove do próprio tenant (isolamento)', () => {
  const a = makeTenant();
  const b = makeTenant();
  const endpoint = subscribe(a.id);
  assert.equal(removeSubscription(b.id, endpoint).removed, false); // outro tenant não remove
  assert.equal(pushSubscriptionQueries.listActiveByTenant.all(a.id).length, 1);
  assert.equal(removeSubscription(a.id, endpoint).removed, true);
  assert.equal(pushSubscriptionQueries.listActiveByTenant.all(a.id).length, 0);
});

// ── Preferências ─────────────────────────────────────────────────────────────

test('preferências: padrão tudo ligado, PUT respeita allowlist e persiste', () => {
  const t = makeTenant();
  const defaults = getPushPreferences(tenantQueries.byId.get(t.id));
  for (const cat of PUSH_CATEGORIES) assert.equal(defaults[cat], true);

  const saved = setPushPreferences(t.id, { vendas: false, meta: false, invasor: true, atendimento: 'sim' });
  assert.equal(saved.vendas, false);
  assert.equal(saved.meta, false); // 'meta' pode ser desligada pelo usuário
  assert.equal(saved.atendimento, true); // valor não-booleano ignorado → padrão
  assert.equal('invasor' in saved, false);

  const reloaded = getPushPreferences(tenantQueries.byId.get(t.id));
  assert.equal(reloaded.vendas, false);
  assert.equal(reloaded.campanhas, true);
});

// ── Dedupe/cooldown ──────────────────────────────────────────────────────────

test('claimPushDedupe: segunda tentativa dentro do cooldown é negada; clear reabre', () => {
  const t = makeTenant();
  assert.equal(claimPushDedupe(t.id, 'meta_critical:token_invalid', 60), true);
  assert.equal(claimPushDedupe(t.id, 'meta_critical:token_invalid', 60), false);
  // Código de problema diferente → chave diferente → passa.
  assert.equal(claimPushDedupe(t.id, 'meta_critical:quality_red', 60), true);
  // Problema resolvido → clear por prefixo → novo alerta passa.
  clearPushDedupe(t.id, 'meta_critical:');
  assert.equal(claimPushDedupe(t.id, 'meta_critical:token_invalid', 60), true);
  // Dedupe é por tenant: outro tenant não é afetado.
  const other = makeTenant();
  assert.equal(claimPushDedupe(other.id, 'meta_critical:token_invalid', 60), true);
});

// ── Envio (sender injetado; simula webPushEnabled via módulo com env) ────────
// Como webPushEnabled é resolvido no load do módulo, os testes de envio usam
// um import isolado com as chaves setadas.

async function loadPushWithVapid() {
  process.env.VAPID_PUBLIC_KEY = 'B'.repeat(87);
  process.env.VAPID_PRIVATE_KEY = 'k'.repeat(43);
  process.env.WEB_PUSH_ENABLED = 'true';
  const mod = await import('../src/push.js?vapid=' + Date.now());
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_ENABLED;
  return mod;
}

test('sendPushEvent envia para assinaturas ativas e respeita preferências', async () => {
  const push = await loadPushWithVapid();
  const t = makeTenant();
  subscribe(t.id, 1);
  subscribe(t.id, 2);

  const sentPayloads = [];
  push._setSenderForTesting(async (sub, payload) => { sentPayloads.push({ sub, payload }); });

  const r1 = await push.sendPushEvent({
    tenantId: t.id, event: 'handoff_requested',
    title: 'Cliente aguardando atendimento', body: 'Uma conversa precisa da sua equipe.',
    url: '/dashboard.html?focus=handoff', dedupeKey: 'handoff:1', cooldownMinutes: 30,
  });
  assert.equal(r1.sent, 2);

  // Payload não carrega dados sensíveis (telefone/CPF/conteúdo).
  for (const { payload } of sentPayloads) {
    const parsed = JSON.parse(payload);
    assert.ok(!/\d{10,}/.test(parsed.title + parsed.body), 'sem telefone no push');
    assert.deepEqual(Object.keys(parsed).sort(), ['body', 'tag', 'title', 'url']);
  }

  // Categoria desligada → skip.
  push.setPushPreferences(t.id, { atendimento: false });
  const r2 = await push.sendPushEvent({
    tenantId: t.id, event: 'handoff_requested', title: 'x', body: 'y',
    url: '/dashboard.html', dedupeKey: 'handoff:2',
  });
  assert.equal(r2.skipped, 'preference_off');
});

test('sendPushEvent: dedupe bloqueia repetição da mesma chave', async () => {
  const push = await loadPushWithVapid();
  const t = makeTenant();
  subscribe(t.id);
  push._setSenderForTesting(async () => {});
  const r1 = await push.sendPushEvent({ tenantId: t.id, event: 'sale_paid', title: 'Venda confirmada', body: 'x', url: '/vendas.html', dedupeKey: 'sale_paid:abc', cooldownMinutes: 60 });
  const r2 = await push.sendPushEvent({ tenantId: t.id, event: 'sale_paid', title: 'Venda confirmada', body: 'x', url: '/vendas.html', dedupeKey: 'sale_paid:abc', cooldownMinutes: 60 });
  assert.equal(r1.sent, 1);
  assert.equal(r2.skipped, 'deduped');
});

test('sendPushEvent: 410/404 desativa a assinatura na hora', async () => {
  const push = await loadPushWithVapid();
  const t = makeTenant();
  subscribe(t.id);
  push._setSenderForTesting(async () => {
    const e = new Error('Gone');
    e.statusCode = 410;
    throw e;
  });
  const r = await push.sendPushEvent({ tenantId: t.id, event: 'sale_paid', title: 'Venda', body: 'x', url: '/vendas.html', dedupeKey: `gone:${randomUUID()}` });
  assert.equal(r.sent, 0);
  assert.equal(pushSubscriptionQueries.listActiveByTenant.all(t.id).length, 0);
});

test('sendPushEvent: falhas repetidas (não-410) desativam após o limite', async () => {
  const push = await loadPushWithVapid();
  const t = makeTenant();
  subscribe(t.id);
  push._setSenderForTesting(async () => { throw new Error('boom'); });
  for (let i = 0; i < 5; i++) {
    await push.sendPushEvent({ tenantId: t.id, event: 'sale_paid', title: 'V', body: 'x', url: '/', dedupeKey: `f:${i}` });
  }
  assert.equal(pushSubscriptionQueries.listActiveByTenant.all(t.id).length, 0);
});

test('sendPushEvent: isolamento — assinatura de um tenant nunca recebe evento de outro', async () => {
  const push = await loadPushWithVapid();
  const a = makeTenant();
  const b = makeTenant();
  subscribe(a.id);
  const delivered = [];
  push._setSenderForTesting(async (sub) => { delivered.push(sub.endpoint); });
  await push.sendPushEvent({ tenantId: b.id, event: 'sale_paid', title: 'V', body: 'x', url: '/', dedupeKey: `iso:${randomUUID()}` });
  assert.equal(delivered.length, 0);
});

// ── Service worker: nunca cachear /api/* ─────────────────────────────────────

test('service worker nunca cacheia /api/* nem HTML autenticado', () => {
  const sw = readFileSync(join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert.ok(sw.includes(`url.pathname.startsWith('/api/')`), 'sw.js deve excluir /api/ do cache');
  assert.ok(sw.includes(`url.pathname.endsWith('.html')`), 'sw.js deve excluir HTML do cache');
  assert.ok(!sw.includes(`'/api/'`) || sw.includes('isNeverCache'), 'exclusão deve estar no caminho do fetch');
  // O manifest não aponta start_url para fora do painel.
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.start_url.startsWith('/'));
});

// ── Endpoints: toda rota nova exige autenticação ─────────────────────────────

test('rotas /api/meta/* e /api/push/* declaram requireAuth (e CSRF nas mutações)', () => {
  const api = readFileSync(join(__dirname, '..', 'src', 'api.js'), 'utf8');
  const routes = api.match(/apiRouter\.(get|post|put|delete)\('\/api\/(meta|push)\/[^']*'[^\n]*/g) || [];
  assert.ok(routes.length >= 7, `esperava >=7 rotas novas, achei ${routes.length}`);
  for (const route of routes) {
    assert.ok(route.includes('requireAuth'), `rota sem requireAuth: ${route}`);
    if (/apiRouter\.(post|put|delete)/.test(route)) {
      assert.ok(route.includes('requireCsrf'), `mutação sem requireCsrf: ${route}`);
    }
  }
  // A verificação manual tem rate limit.
  const checkRoute = routes.find((r) => r.includes('/api/meta/health/check'));
  assert.ok(checkRoute.includes('metaHealthLimiter'), 'verificação manual deve ter rate limit');
});
