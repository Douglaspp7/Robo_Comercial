/**
 * Integração com a Nuvemshop/Tiendanube (API v1, OAuth2) — sincroniza produtos
 * e estoque, mesmo padrão do Bling (src/bling.js): reconciliação por NOME
 * exato do produto, sem estoque próprio duplicado.
 *
 * Diferente do Bling, o access_token da Nuvemshop não expira — não há
 * refresh_token nem renovação.
 */
import { config } from './config.js';
import { fetchWithTimeout } from './http.js';

const TOKEN_URL = 'https://www.tiendanube.com/apps/authorize/token';

/** Troca o `code` do redirect OAuth por um access_token de longa duração. */
export async function exchangeNuvemshopCode(code) {
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.nuvemshopOAuthAppId,
      client_secret: config.nuvemshopOAuthAppSecret,
      grant_type: 'authorization_code',
      code,
    }),
  }, 15000);
  const data = await res.json().catch(() => ({}));
  // Nunca logar o corpo (contém access_token) — mesmo cuidado do fluxo Bling.
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Nuvemshop OAuth ${res.status}`);
  }
  return data;
}

async function nuvemshopFetch(tenant, path) {
  return fetchWithTimeout(`https://api.tiendanube.com/v1/${tenant.nuvemshop_store_id}${path}`, {
    headers: {
      // A API da Nuvemshop usa o header "Authentication" (não "Authorization").
      Authentication: `bearer ${tenant.nuvemshop_access_token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Zapien (contato@zapien.app)',
    },
  }, 15000);
}

/** Busca produtos publicados da loja (paginado, 100 por página). */
export async function fetchNuvemshopProdutos(tenant, page = 1) {
  const res = await nuvemshopFetch(tenant, `/products?page=${page}&per_page=100&published=true`);
  if (!res.ok) throw new Error(`Nuvemshop products ${res.status}`);
  return res.json();
}

/**
 * Extrai { nome -> {id, sku, estoque} } dos produtos já carregados. Estoque
 * vem por variante (soma todas — o Zapien não modela variação de produto).
 */
export function extractNuvemshopEstoques(produtosNuvemshop, locale = 'pt') {
  const map = new Map();
  for (const p of produtosNuvemshop || []) {
    const nome = p.name?.[locale] || p.name?.pt || p.name?.es || p.name?.en;
    if (!nome) continue;
    const variantes = p.variants || [];
    const estoque = variantes.reduce((sum, v) => sum + (v.stock_management ? (Number(v.stock) || 0) : sum), 0);
    map.set(nome, { id: p.id, sku: variantes[0]?.sku || null, estoque });
  }
  return map;
}
