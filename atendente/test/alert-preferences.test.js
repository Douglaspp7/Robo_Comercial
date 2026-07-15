import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAlertPhone } from '../src/alert-preferences.js';

test('normalizeAlertPhone mantém somente dígitos de um número válido', () => {
  assert.equal(normalizeAlertPhone('+55 (11) 99999-9999'), '5511999999999');
});

test('normalizeAlertPhone permite desativar avisos por WhatsApp', () => {
  assert.equal(normalizeAlertPhone(''), '');
});

test('normalizeAlertPhone rejeita números incompletos', () => {
  assert.throws(() => normalizeAlertPhone('119999'), /DDD e código do país/);
});
