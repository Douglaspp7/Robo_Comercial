import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/automations.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/js/pages/automations.js', import.meta.url), 'utf8');

test('Automações mostra uso, barra contextual e acesso aos planos', () => {
  assert.match(html, /id="automation-usage-card"/);
  assert.match(html, /id="automation-usage-bar"/);
  assert.match(html, /href="\/plans\.html"/);
});

test('indicador contextual distingue aviso e limite atingido', () => {
  assert.match(js, /percent >= 70 && percent < 100/);
  assert.match(js, /classList\.toggle\('is-full', percent >= 100\)/);
  assert.match(js, /limitActive - activeCount/);
});
