import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotmartTokenMatches, normalizeHotmartPhone, parseHotmartEvent } from '../src/hotmart.js';

test('hotmartTokenMatches compara em tempo constante e rejeita tokens de tamanho diferente', () => {
  assert.equal(hotmartTokenMatches('abc123', 'abc123'), true);
  assert.equal(hotmartTokenMatches('abc123', 'abc1234'), false);
  assert.equal(hotmartTokenMatches('abc123', 'xyz789'), false);
  assert.equal(hotmartTokenMatches('', 'abc123'), false);
  assert.equal(hotmartTokenMatches('abc123', ''), false);
});

test('normalizeHotmartPhone monta o telefone com DDI 55 a partir de DDD + numero', () => {
  assert.equal(normalizeHotmartPhone('11', '999990000'), '5511999990000');
});

test('normalizeHotmartPhone aceita phoneFull ja completo e nao duplica o 55', () => {
  assert.equal(normalizeHotmartPhone(null, null, '+55 11 99999-0000'), '5511999990000');
});

test('normalizeHotmartPhone retorna null quando nao ha nenhum numero', () => {
  assert.equal(normalizeHotmartPhone(null, null, null), null);
});

test('parseHotmartEvent retorna null para eventos nao reconhecidos', () => {
  assert.equal(parseHotmartEvent({ event: 'PURCHASE_OUT_OF_SHOPPING_CART' }), null);
  assert.equal(parseHotmartEvent({}), null);
});

test('parseHotmartEvent extrai dados de PURCHASE_APPROVED', () => {
  const body = {
    event: 'PURCHASE_APPROVED',
    data: {
      purchase: { transaction: 'HP123', price: { value: 97.5 } },
      buyer: { name: 'Maria Compradora', checkout_phone_code: '11', checkout_phone: '999990000' },
      product: { name: 'Curso de Barista' },
    },
  };
  const evt = parseHotmartEvent(body);
  assert.equal(evt.status, 'pago');
  assert.equal(evt.transactionId, 'HP123');
  assert.equal(evt.phone, '5511999990000');
  assert.equal(evt.buyerName, 'Maria Compradora');
  assert.equal(evt.productName, 'Curso de Barista');
  assert.equal(evt.priceValue, 97.5);
});

test('parseHotmartEvent marca reembolso/chargeback/cancelamento como perdido', () => {
  for (const event of ['PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK', 'PURCHASE_CANCELED']) {
    const evt = parseHotmartEvent({ event, data: { purchase: { transaction: 'HP1' } } });
    assert.equal(evt.status, 'perdido');
    assert.equal(evt.transactionId, 'HP1');
  }
});
