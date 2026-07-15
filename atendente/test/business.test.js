import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBusiness } from '../src/business.js';

test('normalizeBusiness mapeia chaves legadas do painel para canônicas', () => {
  const legacy = {
    name: 'Loja X',
    tom_de_voz: 'Amigável e direto',
    faqs: [{ pergunta: 'Prazo?', resposta: '3 dias' }],
    objecoes: [{ objecao: 'Caro', resposta: 'Vale a pena' }],
    descricao: 'Vende coisas',
    regras: ['Não invente'],
    produtos: [{ nome: 'A', preco: 'R$ 10' }],
  };
  const b = normalizeBusiness(legacy);
  assert.equal(b.tomDeVoz, 'Amigável e direto');
  assert.equal(b.perguntasFrequentes.length, 1);
  assert.equal(b.perguntasFrequentes[0].pergunta, 'Prazo?');
  assert.equal(b.objecoesComuns.length, 1);
  assert.equal(b.objecoesComuns[0].objecao, 'Caro');
  assert.equal(b.descricao, 'Vende coisas');
  assert.equal(b.produtos.length, 1);
});

test('normalizeBusiness aceita o formato canônico dos seeds sem perder dados', () => {
  const canonical = {
    tomDeVoz: 'Caloroso',
    perguntasFrequentes: [{ pergunta: 'P', resposta: 'R' }],
    objecoesComuns: [{ objecao: 'O', resposta: 'R' }],
  };
  const b = normalizeBusiness(canonical);
  assert.equal(b.tomDeVoz, 'Caloroso');
  assert.equal(b.perguntasFrequentes.length, 1);
  assert.equal(b.objecoesComuns.length, 1);
});

test('normalizeBusiness aceita business_json como string', () => {
  const b = normalizeBusiness('{"tom_de_voz":"X","faqs":[{"pergunta":"a","resposta":"b"}]}');
  assert.equal(b.tomDeVoz, 'X');
  assert.equal(b.perguntasFrequentes.length, 1);
});

test('normalizeBusiness não lança com entrada inválida', () => {
  assert.deepEqual(normalizeBusiness(null).produtos, []);
  assert.deepEqual(normalizeBusiness('não é json').perguntasFrequentes, []);
  assert.deepEqual(normalizeBusiness(undefined).objecoesComuns, []);
});

test('normalizeBusiness converte dias string "1,2,3" em array de números', () => {
  const b = normalizeBusiness({
    horario_atendimento: { ativo: true, inicio: '08:00', fim: '18:00', dias: '1,2,6', msg_fora: 'Fechado' },
  });
  assert.deepEqual(b.horario_atendimento.dias, [1, 2, 6]);
  assert.equal(b.horario_atendimento.mensagem_fora, 'Fechado');
});

test('normalizeBusiness aceita dias já como array e mensagem_fora canônica', () => {
  const b = normalizeBusiness({
    horario_atendimento: { ativo: true, inicio: '09:00', fim: '17:00', dias: [1, 2, 3], mensagem_fora: 'Volto amanhã' },
  });
  assert.deepEqual(b.horario_atendimento.dias, [1, 2, 3]);
  assert.equal(b.horario_atendimento.mensagem_fora, 'Volto amanhã');
});

test('normalizeBusiness usa seg-sex como padrão quando dias ausente', () => {
  const b = normalizeBusiness({ horario_atendimento: { ativo: true, inicio: '08:00', fim: '18:00' } });
  assert.deepEqual(b.horario_atendimento.dias, [1, 2, 3, 4, 5]);
});

test('normalizeBusiness normaliza resumoDiario com hora padrão 20h', () => {
  const b = normalizeBusiness({ resumoDiario: { ativo: true } });
  assert.equal(b.resumoDiario.ativo, true);
  assert.equal(b.resumoDiario.hora, 20);
});

test('normalizeBusiness aceita hora customizada dentro de 0-23 e rejeita fora do intervalo', () => {
  const b1 = normalizeBusiness({ resumoDiario: { ativo: true, hora: 9 } });
  assert.equal(b1.resumoDiario.hora, 9);
  const b2 = normalizeBusiness({ resumoDiario: { ativo: true, hora: 25 } });
  assert.equal(b2.resumoDiario.hora, 20);
});

test('normalizeBusiness não inclui resumoDiario quando ausente', () => {
  const b = normalizeBusiness({ name: 'Loja X' });
  assert.equal(b.resumoDiario, undefined);
});

test('normalizeBusiness preserva o campo esgotado de cada produto', () => {
  const b = normalizeBusiness({
    produtos: [{ nome: 'A', preco: 'R$ 10', esgotado: true }, { nome: 'B', preco: 'R$ 20' }],
  });
  assert.equal(b.produtos[0].esgotado, true);
  assert.equal(b.produtos[1].esgotado, undefined);
});

test('normalizeBusiness usa array vazio de whatsappTemplates quando ausente', () => {
  assert.deepEqual(normalizeBusiness({}).whatsappTemplates, []);
});

test('normalizeBusiness preserva os templates de WhatsApp cadastrados', () => {
  const b = normalizeBusiness({
    whatsappTemplates: [{ nome: 'recompra_v1', idioma: 'pt_BR', categoria: 'marketing', corpo: 'Oi {{1}}, que tal repor {{2}}?' }],
  });
  assert.equal(b.whatsappTemplates.length, 1);
  assert.equal(b.whatsappTemplates[0].nome, 'recompra_v1');
  assert.equal(b.whatsappTemplates[0].categoria, 'marketing');
});
