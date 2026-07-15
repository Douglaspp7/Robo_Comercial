/**
 * parseTokenScopes / tokenCapabilities do Melhor Envio.
 *
 * O token do Melhor Envio é um JWT contendo os escopos que o lojista marcou
 * na hora de gerar. O Zapien lê esses escopos SEM validar assinatura — a
 * intenção é só decidir se o token consegue gerar etiqueta (precisa de
 * shipping-generate + shipping-checkout) ou só calcular frete.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTokenScopes, tokenCapabilities } from '../src/melhorenvio.js';

// Helper: constroi um JWT (só header + payload assinados vazios) com o payload
// pedido — a assinatura é irrelevante porque o parser não valida.
function makeToken(payload) {
  const b64u = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(payload)}.assinatura-fake`;
}

test('parseTokenScopes: array em payload.scopes é usado direto', () => {
  const token = makeToken({ scopes: ['shipping-calculate', 'shipping-generate'] });
  assert.deepEqual(parseTokenScopes(token), ['shipping-calculate', 'shipping-generate']);
});

test('parseTokenScopes: string em payload.scope é split por espaço (formato OAuth clássico)', () => {
  const token = makeToken({ scope: 'shipping-calculate shipping-generate shipping-checkout' });
  assert.deepEqual(parseTokenScopes(token), ['shipping-calculate', 'shipping-generate', 'shipping-checkout']);
});

test('parseTokenScopes: token inválido/malformado devolve array vazio (não lança)', () => {
  assert.deepEqual(parseTokenScopes(''), []);
  assert.deepEqual(parseTokenScopes(null), []);
  assert.deepEqual(parseTokenScopes('não-é-jwt'), []);
  assert.deepEqual(parseTokenScopes('so.duas'), []);
  assert.deepEqual(parseTokenScopes('a.b.c'), [], 'payload base64 inválido → vazio');
});

test('tokenCapabilities: token só com shipping-calculate → só calcula frete', () => {
  const token = makeToken({ scopes: ['shipping-calculate'] });
  const caps = tokenCapabilities(token);
  assert.equal(caps.can_calculate, true);
  assert.equal(caps.can_generate_label, false);
  assert.deepEqual(caps.missing_for_label, ['shipping-generate', 'shipping-checkout', 'shipping-print']);
});

test('tokenCapabilities: token com os 4 escopos → calcula E gera etiqueta', () => {
  const token = makeToken({ scopes: ['shipping-calculate', 'shipping-generate', 'shipping-checkout', 'shipping-print'] });
  const caps = tokenCapabilities(token);
  assert.equal(caps.can_calculate, true);
  assert.equal(caps.can_generate_label, true);
  assert.deepEqual(caps.missing_for_label, []);
});

test('tokenCapabilities: escopo curinga "*" habilita tudo', () => {
  const token = makeToken({ scopes: ['*'] });
  const caps = tokenCapabilities(token);
  assert.equal(caps.can_calculate, true);
  assert.equal(caps.can_generate_label, true);
});

test('tokenCapabilities: escopo parcial de etiqueta (falta checkout e print) → não gera', () => {
  const token = makeToken({ scopes: ['shipping-calculate', 'shipping-generate'] });
  const caps = tokenCapabilities(token);
  assert.equal(caps.can_generate_label, false);
  assert.deepEqual(caps.missing_for_label, ['shipping-checkout', 'shipping-print']);
});
