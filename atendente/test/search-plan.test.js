import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSearchPlan } from '../src/search-plan.js';

test('sanitizeSearchPlan valida, deduplica, ordena e limita sugestões', () => {
  const result = sanitizeSearchPlan({ suggestions: [
    { source: 'instagram', query: '#petshopsp', score: 70, reason: 'Agenda por WhatsApp' },
    { source: 'google', query: 'clínica de estética', score: 95, reason: 'Muitos orçamentos' },
    { source: 'google', query: 'clínica de estética', score: 10 },
    { source: 'email', query: 'inválido', score: 100 },
  ] }, 'São Paulo, SP');
  assert.equal(result.length, 2);
  assert.equal(result[0].query, 'clínica de estética');
  assert.equal(result[0].location, 'São Paulo, SP');
  assert.equal(result[1].query, 'petshopsp');
  assert.equal(result[1].mode, 'hashtag');
});
