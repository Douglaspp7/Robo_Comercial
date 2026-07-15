import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_LIMITS, PLAN_IDS, planAtLeast, effectivePlanId, getPlanLimits, usageStatus, getPeriodPricing, BILLING_PERIODS, BILLING_PERIOD_IDS } from '../src/plans.js';

test('todos os 4 planos existem com números crescentes de limite', () => {
  assert.deepEqual(PLAN_IDS, ['essencial', 'pro', 'elite', 'especial']);
  for (const id of PLAN_IDS) assert.ok(PLAN_LIMITS[id], `plano ${id} ausente`);
  assert.ok(PLAN_LIMITS.essencial.aiCallsMonth < PLAN_LIMITS.pro.aiCallsMonth);
  assert.ok(PLAN_LIMITS.pro.aiCallsMonth < PLAN_LIMITS.elite.aiCallsMonth);
  assert.ok(PLAN_LIMITS.elite.aiCallsMonth < PLAN_LIMITS.especial.aiCallsMonth);
});

test('essencial não tem transcrição de áudio nem Melhor Envio', () => {
  assert.equal(PLAN_LIMITS.essencial.audioTranscriptionEnabled, false);
  assert.equal(PLAN_LIMITS.essencial.melhorEnvio, false);
  assert.equal(PLAN_LIMITS.pro.audioTranscriptionEnabled, true);
  assert.equal(PLAN_LIMITS.elite.melhorEnvio, true);
});

test('planAtLeast respeita a ordem essencial < pro < elite < especial', () => {
  assert.equal(planAtLeast('pro', 'essencial'), true);
  assert.equal(planAtLeast('essencial', 'pro'), false);
  assert.equal(planAtLeast('especial', 'elite'), true);
  assert.equal(planAtLeast('elite', 'especial'), false);
});

test('effectivePlanId: trial vira elite; plano desconhecido cai para essencial', () => {
  assert.equal(effectivePlanId('essencial', 'trial'), 'elite');
  assert.equal(effectivePlanId('pro', 'ativo'), 'pro');
  assert.equal(effectivePlanId('plano-inexistente', 'ativo'), 'essencial');
});

test('getPlanLimits nunca retorna undefined', () => {
  assert.ok(getPlanLimits(undefined, 'ativo'));
  assert.ok(getPlanLimits('essencial', 'trial').audioTranscriptionEnabled === true); // trial = elite
});

test('usageStatus classifica corretamente os limiares 70/80/100%', () => {
  assert.equal(usageStatus(0, 100).status, 'ok');
  assert.equal(usageStatus(69, 100).status, 'ok');
  assert.equal(usageStatus(70, 100).status, 'warning');
  assert.equal(usageStatus(79, 100).status, 'warning');
  assert.equal(usageStatus(80, 100).status, 'critical');
  assert.equal(usageStatus(99, 100).status, 'critical');
  assert.equal(usageStatus(100, 100).status, 'blocked');
  assert.equal(usageStatus(150, 100).status, 'blocked');
  assert.equal(usageStatus(150, 100).percent, 100); // nunca passa de 100%
});

test('usageStatus lida com limite zero/ausente sem dividir por zero', () => {
  assert.deepEqual(usageStatus(5, 0), { percent: 0, status: 'ok' });
  assert.deepEqual(usageStatus(5, null), { percent: 0, status: 'ok' });
});

test('BILLING_PERIOD_IDS lista mensal, semestral e anual nessa ordem', () => {
  assert.deepEqual(BILLING_PERIOD_IDS, ['mensal', 'semestral', 'anual']);
});

test('getPeriodPricing: mensal não tem desconto', () => {
  const p = getPeriodPricing(100, 'mensal');
  assert.equal(p.months, 1);
  assert.equal(p.total, 100);
  assert.equal(p.equivalenteMensal, 100);
});

test('getPeriodPricing: semestral aplica 10% sobre o total de 6 meses', () => {
  const p = getPeriodPricing(100, 'semestral');
  assert.equal(p.months, 6);
  assert.equal(p.totalCheio, 600);
  assert.equal(p.total, 540); // 600 * 0.9
  assert.equal(p.equivalenteMensal, 90);
});

test('getPeriodPricing: anual aplica 20% sobre o total de 12 meses', () => {
  const p = getPeriodPricing(97, 'anual');
  assert.equal(p.months, 12);
  assert.equal(p.totalCheio, 1164);
  assert.equal(p.total, 931.2); // 1164 * 0.8
  assert.equal(p.equivalenteMensal, 77.6);
});

test('getPeriodPricing: período desconhecido cai para mensal', () => {
  const p = getPeriodPricing(100, 'trimestral-nao-existe');
  assert.equal(p.months, 1);
  assert.equal(p.discount, 0);
});

test('BILLING_PERIODS tem descontos crescentes conforme o período aumenta', () => {
  assert.ok(BILLING_PERIODS.mensal.discount < BILLING_PERIODS.semestral.discount);
  assert.ok(BILLING_PERIODS.semestral.discount < BILLING_PERIODS.anual.discount);
});
