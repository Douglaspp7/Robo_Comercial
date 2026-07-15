import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  onlyDigits, detectType, isValidCPF, isValidCNPJ, validateDocument,
  formatCPF, formatCNPJ, formatDocument, maskDocument,
} from '../src/cpf-cnpj.js';

test('onlyDigits remove tudo que não é número', () => {
  assert.equal(onlyDigits('123.456.789-09'), '12345678909');
  assert.equal(onlyDigits(''), '');
  assert.equal(onlyDigits(null), '');
});

test('detectType identifica CPF (11 dígitos) e CNPJ (14 dígitos)', () => {
  assert.equal(detectType('123.456.789-09'), 'cpf');
  assert.equal(detectType('12.345.678/0001-95'), 'cnpj');
  assert.equal(detectType('123'), null);
});

test('isValidCPF aceita CPF com dígitos verificadores corretos', () => {
  assert.equal(isValidCPF('12345678909'), true);
  assert.equal(isValidCPF('98765432100'), true);
});

test('isValidCPF rejeita dígito verificador errado, sequência repetida e tamanho errado', () => {
  assert.equal(isValidCPF('12345678900'), false);
  assert.equal(isValidCPF('11111111111'), false);
  assert.equal(isValidCPF('123456789'), false);
});

test('isValidCNPJ aceita CNPJ com dígitos verificadores corretos', () => {
  assert.equal(isValidCNPJ('12345678000195'), true);
  assert.equal(isValidCNPJ('11122233000183'), true);
});

test('isValidCNPJ rejeita dígito verificador errado e sequência repetida', () => {
  assert.equal(isValidCNPJ('12345678000199'), false);
  assert.equal(isValidCNPJ('11111111111111'), false);
});

test('validateDocument combina detecção de tipo e validação', () => {
  assert.deepEqual(validateDocument('123.456.789-09'), { valid: true, type: 'cpf' });
  assert.deepEqual(validateDocument('12.345.678/0001-95'), { valid: true, type: 'cnpj' });
  assert.deepEqual(validateDocument('12345678900'), { valid: false, type: 'cpf' });
  assert.deepEqual(validateDocument('abc'), { valid: false, type: null });
});

test('formatCPF e formatCNPJ aplicam a máscara completa', () => {
  assert.equal(formatCPF('12345678909'), '123.456.789-09');
  assert.equal(formatCNPJ('12345678000195'), '12.345.678/0001-95');
});

test('formatDocument detecta o tipo automaticamente', () => {
  assert.equal(formatDocument('12345678909'), '123.456.789-09');
  assert.equal(formatDocument('12345678000195'), '12.345.678/0001-95');
  assert.equal(formatDocument(''), '');
});

test('maskDocument nunca revela o documento completo', () => {
  const maskedCpf = maskDocument('12345678909');
  assert.equal(maskedCpf, '***.456.789-**');
  assert.equal(maskedCpf.includes('123'), false);

  const maskedCnpj = maskDocument('12345678000195');
  assert.equal(maskedCnpj, '**.345.678/0001-**');
  assert.equal(maskedCnpj.includes('12345678'), false);
});
