import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestNextAction } from '../src/next-action.js';

function hoursAgo(h) {
  return new Date(Date.now() - h * 3600000).toISOString().replace('T', ' ').slice(0, 19);
}

test('handoff waiting tem prioridade sobre qualquer outra regra', () => {
  const r = suggestNextAction({
    stage: 'checkout', handoff_status: 'waiting', handoff_reason: 'reclamacao',
    tags: [], last_message_at: hoursAgo(0), aguardandoPagamento: true,
  });
  assert.equal(r.acao, 'Assumir a conversa');
  assert.match(r.motivo, /reclamação/);
  assert.equal(r.mensagem, null);
});

test('handoff waiting por solicitação de dados (LGPD) tem mensagem específica com prazo', () => {
  const r = suggestNextAction({
    stage: 'duvida', handoff_status: 'waiting', handoff_reason: 'solicitacao_dados',
    tags: [], last_message_at: hoursAgo(0),
  });
  assert.equal(r.acao, 'Assumir a conversa');
  assert.match(r.motivo, /LGPD/);
  assert.match(r.motivo, /15 dias/);
});

test('handoff waiting sem motivo mapeado usa mensagem genérica', () => {
  const r = suggestNextAction({ stage: 'duvida', handoff_status: 'waiting', handoff_reason: null, tags: [], last_message_at: hoursAgo(0) });
  assert.equal(r.acao, 'Assumir a conversa');
  assert.match(r.motivo, /aguardando atendimento humano/);
});

test('tag "pediu desconto" sugere avaliar condição especial', () => {
  const r = suggestNextAction({ stage: 'negociacao', handoff_status: 'none', tags: ['pediu desconto'], last_message_at: hoursAgo(0) });
  assert.equal(r.acao, 'Avaliar desconto ou condição especial');
  assert.ok(r.mensagem);
});

test('tag "frete caro" sugere oferecer alternativa de frete', () => {
  const r = suggestNextAction({ stage: 'orcamento', handoff_status: 'none', tags: ['frete caro'], last_message_at: hoursAgo(0) });
  assert.equal(r.acao, 'Oferecer alternativa de frete');
});

test('checkout com pagamento pendente há mais de 2h sugere lembrete de pagamento', () => {
  const r = suggestNextAction({
    stage: 'checkout', handoff_status: 'none', tags: [], last_message_at: hoursAgo(3), aguardandoPagamento: true,
  });
  assert.equal(r.acao, 'Enviar lembrete de pagamento');
  assert.match(r.motivo, /3h/);
});

test('checkout com pagamento pendente recente (< 2h) não sugere lembrete ainda', () => {
  const r = suggestNextAction({
    stage: 'checkout', handoff_status: 'none', tags: [], last_message_at: hoursAgo(1), aguardandoPagamento: true,
  });
  assert.notEqual(r.acao, 'Enviar lembrete de pagamento');
});

test('orçamento parado há mais de 24h sugere recuperação', () => {
  const r = suggestNextAction({ stage: 'orcamento', handoff_status: 'none', tags: [], last_message_at: hoursAgo(30) });
  assert.equal(r.acao, 'Recuperar orçamento parado');
  assert.match(r.motivo, /1 dia/);
});

test('venda fechada sugere pós-venda', () => {
  const r = suggestNextAction({ stage: 'fechado', handoff_status: 'none', tags: [], last_message_at: hoursAgo(1) });
  assert.equal(r.acao, 'Fazer pós-venda');
});

test('venda perdida sugere tentativa de recuperação', () => {
  const r = suggestNextAction({ stage: 'perdido', handoff_status: 'none', tags: [], last_message_at: hoursAgo(48) });
  assert.equal(r.acao, 'Tentar recuperar a venda');
});

test('alta intenção em etapa inicial sugere avançar para orçamento', () => {
  const r = suggestNextAction({ stage: 'duvida', handoff_status: 'none', tags: [], buy_intent: 'alta', last_message_at: hoursAgo(0) });
  assert.equal(r.acao, 'Avançar para orçamento');
});

test('sem sinais especiais e sem atraso sugere continuar o atendimento', () => {
  const r = suggestNextAction({ stage: 'duvida', handoff_status: 'none', tags: [], buy_intent: 'baixa', last_message_at: hoursAgo(1) });
  assert.equal(r.acao, 'Continuar o atendimento');
});

test('contato ativo sem resposta há mais de 24h sugere retorno genérico', () => {
  const r = suggestNextAction({ stage: 'negociacao', handoff_status: 'none', tags: [], last_message_at: hoursAgo(50) });
  assert.equal(r.acao, 'Enviar um retorno');
});
