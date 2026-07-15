/**
 * Testes da tabela de eventos de conversão (medição first-party).
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversionEventQueries } from '../src/db.js';

test('grava e agrega eventos de conversão anônimos', () => {
  conversionEventQueries.insert.run(
    'landing_view', 'sid-abc', '/', 'https://google.com', 'google', 'cpc',
    'lancamento', null, null, null,
  );
  conversionEventQueries.insert.run(
    'signup_completed', 'sid-abc', '/login.html', null, 'google', 'cpc',
    'lancamento', null, null, JSON.stringify({ plan: 'pro' }),
  );
  conversionEventQueries.insert.run(
    'web_vitals', 'sid-abc', '/', null, null, null, null, null, null,
    JSON.stringify({ lcp_ms: 1200, cls: 0.02, inp_ms: 80 }),
  );

  const counts = Object.fromEntries(
    conversionEventQueries.countByName.all().map((r) => [r.name, r.n]),
  );
  assert.ok(counts.landing_view >= 1);
  assert.ok(counts.signup_completed >= 1);
  assert.ok(counts.web_vitals >= 1);
});

test('cleanup de eventos antigos não remove eventos recentes', () => {
  const before = conversionEventQueries.countByName.all()
    .reduce((sum, r) => sum + r.n, 0);
  conversionEventQueries.cleanupOld.run();
  const after = conversionEventQueries.countByName.all()
    .reduce((sum, r) => sum + r.n, 0);
  assert.equal(after, before);
});
