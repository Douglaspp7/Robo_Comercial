import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDigitalDeliveryItems } from '../src/digital-delivery.js';

test('getDigitalDeliveryItems retorna o link do produto digital comprado', () => {
  const produtos = [{ nome: 'Curso de Bolos', digital: true, link_entrega: 'https://drive.example.com/curso' }];
  const itemsJson = JSON.stringify([{ titulo: 'Curso de Bolos', quantidade: 1, valor_unitario: 97 }]);

  const entregas = getDigitalDeliveryItems(produtos, itemsJson);
  assert.equal(entregas.length, 1);
  assert.equal(entregas[0].nome, 'Curso de Bolos');
  assert.equal(entregas[0].link, 'https://drive.example.com/curso');
});

test('getDigitalDeliveryItems ignora produto físico (sem digital)', () => {
  const produtos = [{ nome: 'Camiseta', preco: '49.90' }];
  const itemsJson = JSON.stringify([{ titulo: 'Camiseta', quantidade: 1, valor_unitario: 49.9 }]);

  assert.deepEqual(getDigitalDeliveryItems(produtos, itemsJson), []);
});

test('getDigitalDeliveryItems ignora produto digital sem link_entrega configurado', () => {
  const produtos = [{ nome: 'Ebook', digital: true }];
  const itemsJson = JSON.stringify([{ titulo: 'Ebook', quantidade: 1, valor_unitario: 27 }]);

  assert.deepEqual(getDigitalDeliveryItems(produtos, itemsJson), []);
});

test('getDigitalDeliveryItems retorna múltiplos itens digitais de uma venda combinada', () => {
  const produtos = [
    { nome: 'Ebook A', digital: true, link_entrega: 'https://x.com/a' },
    { nome: 'Ebook B', digital: true, link_entrega: 'https://x.com/b' },
    { nome: 'Camiseta', preco: '49.90' },
  ];
  const itemsJson = JSON.stringify([
    { titulo: 'Ebook A', quantidade: 1, valor_unitario: 27 },
    { titulo: 'Camiseta', quantidade: 1, valor_unitario: 49.9 },
    { titulo: 'Ebook B', quantidade: 1, valor_unitario: 37 },
  ]);

  const entregas = getDigitalDeliveryItems(produtos, itemsJson);
  assert.equal(entregas.length, 2);
  assert.deepEqual(entregas.map((e) => e.nome).sort(), ['Ebook A', 'Ebook B']);
});

test('getDigitalDeliveryItems não lança com items_json inválido/ausente', () => {
  assert.deepEqual(getDigitalDeliveryItems([{ nome: 'X', digital: true, link_entrega: 'y' }], 'não é json'), []);
  assert.deepEqual(getDigitalDeliveryItems([], null), []);
  assert.deepEqual(getDigitalDeliveryItems(undefined, undefined), []);
});
