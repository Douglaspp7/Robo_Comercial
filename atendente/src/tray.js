/**
 * Integração com a Tray (API v2, OAuth2) — sincroniza produtos e estoque,
 * mesmo padrão do Bling (src/bling.js): reconciliação por NOME exato do
 * produto, token com expiração e refresh_token.
 *
 * ATENÇÃO: diferente do Bling e da Nuvemshop, a Tray não tem uma URL de API
 * fixa — cada loja recebe um `api_address` próprio (algo como
 * "https://SEULOJA.commercesuite.com.br/web_api") devolvido no callback do
 * OAuth e retornado de novo a cada renovação de token. Os endpoints e o
 * formato exato do payload usados aqui seguem a documentação pública da Tray
 * no momento da escrita — antes de ativar em produção, valide contra um app
 * de teste cadastrado em https://dev.tray.com.br, pois a Tray já teve mais de
 * um formato de autenticação ao longo do tempo.
 */
import { fetchWithTimeout } from './http.js';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Troca o `code` do redirect OAuth por tokens. api_address vem do próprio callback. */
export async function exchangeTrayCode(code, apiAddress) {
  const url = `${String(apiAddress).replace(/\/$/, '')}/auth`;
  const res = await fetchWithTimeout(`${url}?code=${encodeURIComponent(code)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, 15000);
  const data = await res.json().catch(() => ({}));
  // Nunca logar o corpo (contém access_token/refresh_token) — mesmo cuidado do fluxo Bling.
  if (!res.ok || !data.access_token) {
    throw new Error(data.message || data.error || `Tray OAuth ${res.status}`);
  }
  return data;
}

async function requestTrayRefresh(apiAddress, refreshToken) {
  const url = `${String(apiAddress).replace(/\/$/, '')}/auth`;
  const res = await fetchWithTimeout(`${url}?refresh_token=${encodeURIComponent(refreshToken)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, 15000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.message || data.error || `Tray refresh ${res.status}`);
  }
  return data;
}

/**
 * Retorna um access_token válido, renovando via refresh_token se estiver
 * perto de expirar. Quem chama é responsável por persistir o novo par se o
 * retorno vier de uma renovação (compare com tenant.tray_access_token).
 */
export async function getValidTrayToken(tenant) {
  if (!tenant.tray_access_token) throw new Error('Tenant não conectado à Tray.');
  const expiresAtMs = tenant.tray_token_expires_at ? new Date(tenant.tray_token_expires_at).getTime() : 0;
  const needsRefresh = !expiresAtMs || (expiresAtMs - Date.now()) < REFRESH_MARGIN_MS;
  if (!needsRefresh) return { access_token: tenant.tray_access_token, refreshed: null };

  const data = await requestTrayRefresh(tenant.tray_api_address, tenant.tray_refresh_token);
  return { access_token: data.access_token, refreshed: data };
}

async function trayFetch(tenant, accessToken, path) {
  const base = String(tenant.tray_api_address).replace(/\/$/, '');
  const sep = path.includes('?') ? '&' : '?';
  return fetchWithTimeout(`${base}${path}${sep}access_token=${encodeURIComponent(accessToken)}`, {
    headers: { Accept: 'application/json' },
  }, 15000);
}

/** Busca produtos ativos da loja (paginado). */
export async function fetchTrayProdutos(tenant, accessToken, page = 1) {
  const res = await trayFetch(tenant, accessToken, `/products/list?page=${page}&limit=100`);
  if (!res.ok) throw new Error(`Tray products ${res.status}`);
  const data = await res.json();
  return data.Products?.map((p) => p.Product) || [];
}

/** Extrai { nome -> {id, sku, estoque} } dos produtos já carregados. */
export function extractTrayEstoques(produtosTray) {
  const map = new Map();
  for (const p of produtosTray || []) {
    if (!p?.name) continue;
    map.set(p.name, { id: p.id, sku: p.reference || null, estoque: Number(p.stock) || 0 });
  }
  return map;
}
