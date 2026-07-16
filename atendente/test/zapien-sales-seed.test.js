import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeZapienSalesSeed } from '../src/seeds/merge-zapien-seed.js';
import { ZAPIEN_BUSINESS, ZAPIEN_SALES_SEED_VERSION } from '../src/seeds/zapien-business.js';

test('seed comercial novo contém oferta, demos, FAQs e objeções', () => {
  const result = mergeZapienSalesSeed({});
  assert.ok(result.produtos.some((p) => p.nome === 'Teste grátis do Zapien'));
  assert.ok(result.produtos.some((p) => p.nome === 'Ver demo do CRM e conversas'));
  assert.ok(result.perguntasFrequentes.length >= 10);
  assert.ok(result.objecoesComuns.length >= 8);
  assert.equal(result.followup.horas, 48);
  assert.deepEqual(result.seed_meta, { id: 'zapien-sales', version: ZAPIEN_SALES_SEED_VERSION });
});

test('seed v2 ensina a UI real e centraliza suporte na Zapi', () => {
  const result = mergeZapienSalesSeed({});
  const answers = result.perguntasFrequentes.map((item) => `${item.pergunta} ${item.resposta}`).join(' ');
  assert.match(answers, /Configurações/);
  assert.match(answers, /Integrações → Agenda → Google Calendar/);
  assert.match(answers, /botão Suporte/);
  assert.ok(result.regras.some((rule) => rule.includes('especialista também na interface atual')));
  assert.equal(ZAPIEN_SALES_SEED_VERSION, 2);
});

test('migração preserva personalizações e adiciona conteúdo oficial sem duplicar', () => {
  const current = {
    descricao: 'Descrição personalizada do administrador.',
    produtos: [{ nome: 'Consultoria própria', preco: 'R$ 10' }],
    regras: ['Regra personalizada.'],
    checkout_url: 'https://exemplo.test/checkout',
  };
  const once = mergeZapienSalesSeed(current);
  const twice = mergeZapienSalesSeed(once);

  assert.equal(once.descricao, current.descricao);
  assert.equal(once.checkout_url, current.checkout_url);
  assert.ok(once.produtos.some((p) => p.nome === 'Consultoria própria'));
  assert.ok(once.regras.includes('Regra personalizada.'));
  assert.equal(twice.produtos.length, once.produtos.length);
  assert.equal(twice.regras.length, once.regras.length);
});

test('migração substitui a descrição curta do seed legado', () => {
  const result = mergeZapienSalesSeed({
    descricao: 'Zapien — atendente de vendas com IA no WhatsApp para pequenos vendedores.',
  });
  assert.equal(result.descricao, ZAPIEN_BUSINESS.descricao);
});
