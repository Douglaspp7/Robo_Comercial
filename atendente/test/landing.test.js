/**
 * Testes estáticos da landing (public/xlander/index.html): integridade das
 * referências, ausência de plugins removidos, CTAs, acessibilidade básica.
 * Não sobe servidor — só análise dos arquivos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const landingDir = join(publicDir, 'xlander');
const html = readFileSync(join(landingDir, 'index.html'), 'utf8');
const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, '');
const customJs = readFileSync(join(landingDir, 'js', 'custom.js'), 'utf8');

function localRefs(re, group = 1) {
  const refs = [];
  for (const match of htmlNoComments.matchAll(re)) {
    const ref = match[group];
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:') || ref.startsWith('#') || ref.startsWith('mailto:')) continue;
    refs.push(ref.split(/[?#]/)[0]);
  }
  return refs;
}

function resolveLocal(ref) {
  return ref.startsWith('/') ? join(publicDir, ref) : join(landingDir, ref);
}

test('todos os scripts referenciados existem em disco', () => {
  const refs = localRefs(/<script[^>]+src="([^"]+)"/g);
  assert.ok(refs.length >= 5, `scripts locais encontrados: ${refs.length}`);
  for (const ref of refs) {
    assert.ok(existsSync(resolveLocal(ref)), `script inexistente: ${ref}`);
  }
});

test('todos os CSS referenciados existem em disco', () => {
  const refs = localRefs(/<link[^>]+href="([^"]+\.css[^"]*)"/g);
  assert.ok(refs.length >= 4);
  for (const ref of refs) {
    assert.ok(existsSync(resolveLocal(ref)), `css inexistente: ${ref}`);
  }
});

test('imagens críticas referenciadas existem em disco', () => {
  const refs = [
    ...localRefs(/<img[^>]+src="([^"]+)"/g),
    ...localRefs(/srcset="([^",\s]+)/g),
  ];
  assert.ok(refs.length >= 10, `imagens locais encontradas: ${refs.length}`);
  for (const ref of refs) {
    assert.ok(existsSync(resolveLocal(ref)), `imagem inexistente: ${ref}`);
  }
});

test('nenhuma referência aos plugins removidos permanece (HTML e custom.js)', () => {
  const removed = [
    'flexslider', 'prettyPhoto', 'owl.carousel', 'mixitup', 'stellar',
    'waypoints', 'count-to', 'retina.js', 'modernizr', 'jquery.easing',
    'jquery.validate', 'easypiechart', 'gmap',
  ];
  // Só tags efetivas (src/href), não comentários explicativos.
  const activeRefs = [
    ...localRefs(/<script[^>]+src="([^"]+)"/g),
    ...localRefs(/<link[^>]+href="([^"]+)"/g),
  ].join('\n').toLowerCase();
  for (const plugin of removed) {
    assert.ok(!activeRefs.includes(plugin.toLowerCase()), `plugin removido ainda referenciado: ${plugin}`);
  }
  // custom.js sem inicializações órfãs.
  for (const orphan of ['stellar(', 'prettyPhoto(', 'mixitup(', 'owlCarousel(', 'countTo(', '.validate({', 'newsletter_form']) {
    assert.ok(!customJs.includes(orphan), `init órfã em custom.js: ${orphan}`);
  }
});

test('apenas um <h1> na página', () => {
  const h1s = htmlNoComments.match(/<h1[\s>]/g) || [];
  assert.equal(h1s.length, 1);
});

test('CTAs principais apontam para destinos válidos', () => {
  assert.ok(htmlNoComments.includes('href="/login.html#signup"'), 'CTA de teste grátis');
  assert.ok(htmlNoComments.includes('href="/login.html"'), 'CTA de login');
  assert.ok(/js-plan-cta/.test(htmlNoComments), 'CTAs de plano');
  assert.ok(/href="https:\/\/wa\.me\//.test(htmlNoComments), 'link de suporte WhatsApp');
  assert.ok(existsSync(join(publicDir, 'login.html')), 'login.html existe');
});

test('todas as imagens têm atributo alt', () => {
  const imgs = htmlNoComments.match(/<img[^>]*>/g) || [];
  assert.ok(imgs.length >= 10);
  for (const img of imgs) {
    assert.ok(/\salt="/.test(img), `img sem alt: ${img.slice(0, 100)}`);
  }
});

test('sem marcadores de conflito Git na landing', () => {
  assert.ok(!/^(<{7}|={7}|>{7})/m.test(html));
});

test('analytics: script existe e eventos essenciais estão instrumentados', () => {
  const analyticsPath = join(publicDir, 'js', 'zapien-analytics.js');
  assert.ok(existsSync(analyticsPath));
  const analytics = readFileSync(analyticsPath, 'utf8');
  assert.ok(analytics.includes('zapienTrack'));
  assert.ok(analytics.includes('utm_source'));
  assert.ok(analytics.includes('largest-contentful-paint'), 'mede LCP');
  assert.ok(analytics.includes('layout-shift'), 'mede CLS');
  // Nada de dados sensíveis no payload (ignora comentários do próprio arquivo).
  const analyticsCode = analytics.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['cpf', 'password', 'senha', 'token', 'document.cookie']) {
    assert.ok(!analyticsCode.toLowerCase().includes(banned), `analytics não deve tocar em: ${banned}`);
  }

  for (const event of [
    'landing_view', 'hero_trial_click', 'hero_login_click', 'pricing_plan_click',
    'whatsapp_support_click', 'sources_expanded', 'footer_trial_click',
  ]) {
    assert.ok(html.includes(event), `evento não instrumentado na landing: ${event}`);
  }
  const loginJs = readFileSync(join(publicDir, 'js', 'pages', 'login.js'), 'utf8');
  for (const event of ['signup_view', 'signup_started', 'signup_completed', 'login_completed']) {
    assert.ok(loginJs.includes(event), `evento não instrumentado no login: ${event}`);
  }
  assert.ok(html.includes('zapien-analytics.js'), 'landing carrega o script de analytics');
});

test('scripts com dependência de jQuery usam defer (ordem preservada) e não async', () => {
  const scriptTags = htmlNoComments.match(/<script[^>]+src="[^"]*js\/[^"]+"[^>]*>/g) || [];
  assert.ok(scriptTags.length >= 5);
  const jqueryIndex = scriptTags.findIndex((tag) => tag.includes('jquery-2.1.1'));
  assert.equal(jqueryIndex, 0, 'jQuery é o primeiro script');
  for (const tag of scriptTags) {
    assert.ok(!/\basync\b/.test(tag), `script com async quebraria a ordem: ${tag}`);
    assert.ok(/\bdefer\b/.test(tag), `script sem defer: ${tag}`);
  }
});

test('CSS/JS locais são versionados com hash de cache (?v=)', () => {
  const versionable = [
    ...htmlNoComments.matchAll(/(?:src|href)="([^"]+\.(?:css|js)(?:\?[^"]*)?)"/g),
  ]
    .map((m) => m[1])
    .filter((ref) => !/^(https?:)?\/\//.test(ref));
  assert.ok(versionable.length >= 8);
  for (const ref of versionable) {
    assert.match(ref, /\?v=[0-9a-f]{8}$/, `sem hash de cache: ${ref}`);
  }
});
