import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAnthropicCreditError,
  checkOpenAiQuota,
  checkMetaBillingError,
  getRecentAlerts,
} from '../src/alerts.js';

test('checkAnthropicCreditError detecta saldo baixo (mensagem)', () => {
  assert.equal(checkAnthropicCreditError({ status: 400, message: 'Your credit balance is too low to access the API' }), true);
  assert.equal(checkAnthropicCreditError({ status: 402, message: 'payment required' }), true);
});

test('checkAnthropicCreditError ignora erros não relacionados a crédito', () => {
  assert.equal(checkAnthropicCreditError({ status: 429, message: 'rate limit exceeded' }), false);
  assert.equal(checkAnthropicCreditError({ status: 500, message: 'overloaded' }), false);
  assert.equal(checkAnthropicCreditError({ message: 'network error' }), false);
});

test('checkOpenAiQuota detecta insufficient_quota em 429', () => {
  assert.equal(checkOpenAiQuota(429, '{"error":{"code":"insufficient_quota"}}'), true);
  assert.equal(checkOpenAiQuota(429, 'rate limit reached'), false); // 429 mas não é quota
  assert.equal(checkOpenAiQuota(400, 'insufficient_quota'), false); // status errado
});

test('checkMetaBillingError detecta código 131042 e menções de pagamento', () => {
  assert.equal(checkMetaBillingError(400, '{"error":{"code":131042,"message":"payment issue"}}'), true);
  assert.equal(checkMetaBillingError(400, 'account has reached its spending limit'), true);
  assert.equal(checkMetaBillingError(400, '{"error":{"code":131047}}'), false); // re-engajamento, não pagamento
  assert.equal(checkMetaBillingError(400, 'invalid phone number'), false);
});

test('alertas recentes ficam disponíveis para o /health', () => {
  checkAnthropicCreditError({ status: 402, message: 'credit balance too low' });
  const recent = getRecentAlerts();
  assert.ok(Array.isArray(recent));
  assert.ok(recent.some(a => a.type === 'anthropic'));
});
