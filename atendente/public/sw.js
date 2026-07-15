/**
 * Service worker do painel Zapien (PWA + Web Push).
 *
 * REGRA DE OURO: nunca cachear /api/* nem qualquer resposta autenticada
 * (dashboard, conversas, contatos, vendas, configurações). Só o shell
 * estático (CSS/JS/ícones/fonts) entra no cache — HTML e API vão sempre
 * à rede. Dados privados nunca ficam gravados no aparelho por aqui.
 */
const CACHE_NAME = 'zapien-shell-v2';

// Prefixos de caminho que PODEM ser cacheados (shell estático).
const CACHEABLE_PREFIXES = ['/css/', '/js/', '/assets/', '/vendor/'];
// Extensões estáticas seguras (sem HTML — HTML nunca é cacheado aqui).
const CACHEABLE_EXT = /\.(css|js|svg|png|jpg|jpeg|webp|ico|woff2?)$/i;

// Caminhos que NUNCA passam pelo cache, nem por engano.
function isNeverCache(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/webhook') ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/' ||
    url.pathname === '/sw.js'
  );
}

function isCacheable(url) {
  if (isNeverCache(url)) return false;
  return (
    CACHEABLE_PREFIXES.some((p) => url.pathname.startsWith(p)) &&
    CACHEABLE_EXT.test(url.pathname)
  );
}

self.addEventListener('install', () => {
  // Atualização segura: o SW novo instala e espera; assume no próximo load
  // (sem skipWaiting agressivo — evita trocar código no meio de uma sessão).
});

self.addEventListener('activate', (event) => {
  // Remove caches de versões antigas do shell.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // mutações nunca são interceptadas
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // só same-origin
  if (!isCacheable(url)) return; // API/HTML/privado → rede direta (default)

  // Shell estático: prioriza a versão publicada e usa o cache apenas
  // como fallback offline. Assim um deploy nunca deixa CSS/JS antigos presos
  // no aparelho (por exemplo, HTML novo com um ui.js anterior).
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const res = await fetch(req);
        if (res.ok && (res.type === 'basic' || res.type === 'default')) {
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        throw new Error(`Recurso indisponível offline: ${url.pathname}`);
      }
    })
  );
});

// ── Web Push ────────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* payload inesperado */ }
  const title = data.title || 'Zapien';
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: '/assets/logo-mark.svg',
    badge: '/assets/logo-mark.svg',
    data: { url: data.url || '/dashboard.html' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        // Reaproveita uma aba do painel já aberta.
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
