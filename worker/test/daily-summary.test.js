import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailySummary } from '../src/daily-summary.js';

test('buildDailySummary mostra saúde, operação e conversão sem dados pessoais', () => {
  const text = buildDailySummary({ day: '15/07/2026', numbers: [{ connected: true }, { connected: false }], campaigns: [{ sent_today: 12, failed_today: 1, pending: 7 }], leads: { total: 40 }, today: { replied: 5, interested: 2, opted_out: 1 }, suppressed: 3 });
  assert.match(text, /Chips: 1\/2/);
  assert.match(text, /Enviadas hoje: 12/);
  assert.match(text, /Interessados hoje: 2/);
  assert.doesNotMatch(text, /telefone|cliente@/i);
});
