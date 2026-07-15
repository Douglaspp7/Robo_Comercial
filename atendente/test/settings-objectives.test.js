import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/settings.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/js/pages/settings.js', import.meta.url), 'utf8');

test('atalhos de Configurações cobrem os objetivos principais', () => {
  for (const label of [
    'Meu negócio',
    'Atendimento e IA',
    'Equipe',
    'Vendas e clientes',
    'Plano e cobrança',
    'Minha conta',
  ]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
});

test('todos os destinos internos da navegação por objetivo existem', () => {
  const targets = [...html.matchAll(/data-settings-target="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(targets.length > 0);
  for (const target of targets) {
    assert.match(html, new RegExp(`id="${target}"`));
  }
});

test('navegação por objetivo abre e desloca até seções internas', () => {
  assert.match(js, /querySelectorAll\('\[data-settings-target\]'\)/);
  assert.match(js, /target\.tagName === 'DETAILS'/);
  assert.match(js, /target\.scrollIntoView/);
});
