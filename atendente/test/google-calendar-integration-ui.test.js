import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'public', 'integrations.html'), 'utf8');
const js = readFileSync(join(root, 'public', 'js', 'pages', 'integrations.js'), 'utf8');

test('Google Calendar aparece aberto na aba Integrações sem depender de JavaScript', () => {
  assert.match(html, /class="category-card expanded" data-target="calendar-body"/);
  assert.match(html, /id="calendar-body" style="display:block;"/);
  assert.match(html, /> Conectar Google Calendar</);
});

test('guia de integrações inclui Google Calendar', () => {
  assert.match(js, /calendar:\{name:'Google Calendar'/);
  assert.match(js, /target:'integration-google-calendar',body:'calendar-body'/);
});

test('configuração OAuth ausente é explicada na própria tela', () => {
  assert.match(html, /GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET/);
  assert.match(js, /Configuração pendente/);
});
