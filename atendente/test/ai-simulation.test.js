import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSimulationResponse, sanitizeSimulationMessages } from '../src/ai-simulation.js';

test('sanitizeSimulationMessages aceita somente mensagens válidas e limita o histórico', () => {
  const messages = Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `mensagem-${index}`,
  }));
  messages.push({ role: 'system', content: 'ignorar' });
  messages.push({ role: 'user', content: 'x'.repeat(2100) });

  const result = sanitizeSimulationMessages(messages);

  assert.equal(result.length, 12);
  assert.equal(result[0].content, 'mensagem-3');
  assert.equal(result.at(-1).content.length, 2000);
  assert.ok(result.every((message) => ['user', 'assistant'].includes(message.role)));
});

test('sanitizeSimulationMessages devolve lista vazia para entrada inválida', () => {
  assert.deepEqual(sanitizeSimulationMessages(null), []);
  assert.deepEqual(sanitizeSimulationMessages({}), []);
});

test('buildSimulationResponse expõe decisões sem executar ações reais', () => {
  const result = buildSimulationResponse({
    mensagem: 'Posso ajudar com seu pedido.',
    etapa: 'negociacao',
    intencao_compra: 'alta',
    resumo: 'Cliente pronto para comprar.',
    produto_mencionado: 'Produto A',
    enviar_catalogo: true,
    precisa_humano: false,
    pedido: { itens: [{ titulo: 'Produto A', quantidade: 1, valor_unitario: 25 }] },
  });

  assert.equal(result.simulated, true);
  assert.equal(result.etapa, 'negociacao');
  assert.equal(result.produto_mencionado, 'Produto A');
  assert.equal(result.pedido.itens[0].valor_unitario, 25);
  assert.equal(result.precisa_humano, false);
});
