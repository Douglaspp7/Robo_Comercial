import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, tenantQueries, aiUsageQueries, audioTranscriptionQueries, extraDocumentQueries, subscriptionState } from '../src/db.js';
import { getTenantUsage, isAiMonthlyLimitReached, canTranscribeAudio, hasStorageRoom } from '../src/usage.js';

function makeTenant(overrides = {}) {
  const id = randomUUID();
  const plan = overrides.plan || 'essencial';
  const status = overrides.subscription_status || 'active';
  const createdAt = overrides.created_at || `datetime('now', '-1 day')`;
  db.prepare(
    `INSERT INTO tenants (id, email, password_hash, plan, subscription_status, created_at)
     VALUES (?, ?, 'h', ?, ?, ${createdAt})`
  ).run(id, `${id}@test.com`, plan, status);
  return tenantQueries.byId.get(id);
}

test('getTenantUsage retorna estrutura completa para tenant novo', () => {
  const t = makeTenant({ plan: 'pro' });
  const u = getTenantUsage(t);
  assert.equal(u.plan, 'pro');
  assert.equal(u.ai.used, 0);
  assert.equal(u.ai.limit, 2000);
  assert.equal(u.audio.enabled, true);
  assert.equal(u.storage.limitMb, 150);
});

test('isAiMonthlyLimitReached fica true só ao atingir o limite mensal do plano', () => {
  const t = makeTenant({ plan: 'essencial' });
  assert.equal(isAiMonthlyLimitReached(t), false);
  for (let i = 0; i < 999; i++) aiUsageQueries.insert.run(t.id, null, 'test', 1, 1, 0, 0);
  assert.equal(isAiMonthlyLimitReached(t), false); // 999/1000
  aiUsageQueries.insert.run(t.id, null, 'test', 1, 1, 0, 0);
  assert.equal(isAiMonthlyLimitReached(t), true); // 1000/1000
});

test('canTranscribeAudio: essencial nunca pode; pro pode até esgotar os minutos', () => {
  const essencial = makeTenant({ plan: 'essencial' });
  assert.equal(canTranscribeAudio(essencial), false);

  const pro = makeTenant({ plan: 'pro' });
  assert.equal(canTranscribeAudio(pro), true);
  audioTranscriptionQueries.insert.run(pro.id, null, 200 * 60); // 200 min = limite do Pro
  assert.equal(canTranscribeAudio(pro), false);
});

test('hasStorageRoom respeita o limite do plano e considera documentos extras', () => {
  const t = makeTenant({ plan: 'essencial' }); // 50MB
  assert.equal(hasStorageRoom(t, 40 * 1024 * 1024).ok, true);
  assert.equal(hasStorageRoom(t, 60 * 1024 * 1024).ok, false);

  extraDocumentQueries.insert.run(
    randomUUID(), t.id, 'a.pdf', 'application/pdf', Buffer.alloc(45 * 1024 * 1024), 45 * 1024 * 1024
  );
  // Já usando 45MB de 50MB — mais 10MB não cabe.
  assert.equal(hasStorageRoom(t, 10 * 1024 * 1024).ok, false);
  assert.equal(hasStorageRoom(t, 3 * 1024 * 1024).ok, true);
});

test('trial usa limites do Elite mesmo com plano essencial salvo', () => {
  const t = makeTenant({ plan: 'essencial', subscription_status: 'trialing' });
  db.prepare(`UPDATE tenants SET trial_ends_at = datetime('now', '+5 days') WHERE id = ?`).run(t.id);
  const fresh = tenantQueries.byId.get(t.id);
  const u = getTenantUsage(fresh);
  assert.equal(u.effectivePlan, 'elite');
  assert.equal(u.ai.limit, 5000);
  assert.equal(u.audio.enabled, true);
});

test('admin pode liberar novo acesso temporario mesmo apos trial expirado', () => {
  const t = makeTenant({ plan: 'essencial', subscription_status: 'trialing' });
  db.prepare(`UPDATE tenants SET trial_ends_at = datetime('now', '-2 days') WHERE id = ?`).run(t.id);
  const expired = tenantQueries.byId.get(t.id);
  assert.equal(subscriptionState(expired).status, 'trial_expirado');
  assert.equal(subscriptionState(expired).canUseBot, false);

  tenantQueries.grantTemporaryAccess.run({ id: t.id, plan: 'elite', days: 10 });
  const fresh = tenantQueries.byId.get(t.id);
  assert.equal(fresh.active, 1);
  assert.equal(fresh.plan, 'elite');
  assert.equal(subscriptionState(fresh).status, 'trial');
  assert.equal(subscriptionState(fresh).canUseBot, true);
  assert.ok(new Date(fresh.trial_ends_at).getTime() > Date.now());
});
