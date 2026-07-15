/**
 * Integração com o Bling ERP (API v3, OAuth2) — sincroniza produtos/estoque
 * e envia pedidos pagos para emissão de nota fiscal.
 *
 * Diferente do Mercado Pago (cujo access_token é tratado como de longa duração
 * neste app), o token do Bling expira em ~6h e PRECISA de renovação via
 * refresh_token — por isso toda chamada passa por getValidBlingToken(), que
 * renova de forma preguiçosa (só quando perto de expirar) antes de usar.
 */
import { config } from './config.js';
import { fetchWithTimeout } from './http.js';
import { encryptSecret } from './crypto.js';
import { tenantQueries, saleQueries, notificationQueries, blingProductMapQueries } from './db.js';

const BLING_API = 'https://www.bling.com.br/Api/v3';
const BLING_TOKEN_URL = `${BLING_API}/oauth/token`;
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // renova se faltar menos de 5 min para expirar

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${config.blingOAuthAppId}:${config.blingOAuthAppSecret}`).toString('base64');
}

async function requestBlingToken(bodyParams) {
  const res = await fetchWithTimeout(BLING_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(bodyParams),
  }, 15000);
  const data = await res.json().catch(() => ({}));
  // Nunca logar o corpo (contém access_token/refresh_token) — mesmo cuidado do fluxo MP.
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Bling OAuth ${res.status}`);
  }
  return data;
}

/** Troca o `code` do redirect OAuth por tokens (chamado do callback em api.js). */
export async function exchangeBlingCode(code, redirectUri) {
  return requestBlingToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

function persistBlingTokens(tenantId, data) {
  const expiresAt = new Date(Date.now() + (Number(data.expires_in) || 21600) * 1000).toISOString();
  tenantQueries.setBlingCredentials.run({
    id: tenantId,
    bling_access_token: encryptSecret(data.access_token),
    bling_refresh_token: encryptSecret(data.refresh_token),
    bling_token_expires_at: expiresAt,
  });
}

/** Persiste os tokens obtidos na troca inicial do código OAuth. */
export function saveBlingTokens(tenantId, data) {
  persistBlingTokens(tenantId, data);
}

/**
 * Retorna um access_token válido para o tenant, renovando via refresh_token
 * se estiver perto de expirar (o Bling roda o refresh_token a cada uso —
 * sempre persistimos o novo par). Se o refresh for rejeitado (token revogado/
 * expirado), limpa as credenciais do tenant e notifica o lojista a reconectar
 * — nunca fica tentando de novo contra um refresh_token morto.
 */
export async function getValidBlingToken(tenant) {
  if (!tenant.bling_access_token) throw new Error('Tenant não conectado ao Bling.');

  const expiresAtMs = tenant.bling_token_expires_at ? new Date(tenant.bling_token_expires_at).getTime() : 0;
  const needsRefresh = !expiresAtMs || (expiresAtMs - Date.now()) < REFRESH_MARGIN_MS;
  if (!needsRefresh) return tenant.bling_access_token;

  try {
    const data = await requestBlingToken({ grant_type: 'refresh_token', refresh_token: tenant.bling_refresh_token });
    persistBlingTokens(tenant.id, data);
    return data.access_token;
  } catch (err) {
    tenantQueries.clearBlingCredentials.run(tenant.id);
    notificationQueries.create.run({
      tenant_id: tenant.id,
      type: 'bling_desconectado',
      title: 'Conexão com o Bling perdida',
      message: 'Não foi possível renovar o acesso ao Bling. Reconecte em Configurações → Integrações.',
      contact_id: null,
    });
    throw err;
  }
}

async function blingFetch(tenant, path, options = {}) {
  const token = await getValidBlingToken(tenant);
  return fetchWithTimeout(`${BLING_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  }, 15000);
}

/** Busca produtos ativos do Bling (paginado, 100 por página). */
export async function fetchBlingProdutos(tenant, pagina = 1) {
  const res = await blingFetch(tenant, `/produtos?pagina=${pagina}&limite=100&situacao=Ativo`);
  if (!res.ok) throw new Error(`Bling produtos ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export async function fetchAllBlingProdutos(tenant, maxPages = 50) {
  const todos = [];
  for (let pagina = 1; pagina <= maxPages; pagina += 1) {
    const produtos = await fetchBlingProdutos(tenant, pagina);
    todos.push(...produtos);
    if (produtos.length < 100) break;
  }
  return todos;
}

/** Busca saldo de estoque (soma de todos os depósitos) de um conjunto de IDs de produto do Bling. */
export async function fetchBlingEstoques(tenant, produtoIds) {
  if (!produtoIds.length) return {};
  const params = produtoIds.map((id) => `idsProdutos[]=${encodeURIComponent(id)}`).join('&');
  const res = await blingFetch(tenant, `/estoques/saldos?${params}`);
  if (!res.ok) throw new Error(`Bling estoques ${res.status}`);
  const data = await res.json();
  const saldos = {};
  for (const item of data.data || []) {
    const total = (item.depositos || []).reduce((sum, d) => sum + (Number(d.saldoFisicoTotal) || 0), 0);
    saldos[item.produto?.id] = total;
  }
  return saldos;
}

/**
 * Resolve o "codigo" (SKU) do Bling para um item vendido, na ordem:
 * 1) o próprio item já traz codigo/sku/produto_codigo (fluxo ideal);
 * 2) o mapa Bling ↔ catálogo (populado pelo scheduler de sincronização)
 *    tem entrada para esse nome de produto — usa produto_codigo dali;
 * 3) sem nenhum dos dois: o pedido vai sem codigo (item de texto livre no
 *    Bling — a UI já avisa que o SKU é importante para NF/estoque).
 * O parâmetro tenantId é opcional só para facilitar testes existentes
 * que chamam buildBlingPedidoPayload direto sem tenant.
 */
function resolveCodigoFromMap(tenantId, item) {
  if (!tenantId || !item?.titulo && !item?.nome) return null;
  const nome = String(item.titulo || item.nome);
  try {
    const row = blingProductMapQueries.byTenantAndNome.get(tenantId, nome);
    return row?.produto_codigo || null;
  } catch {
    return null;
  }
}

export function buildBlingPedidoPayload(sale, tenantId = null) {
  let items = [];
  try { items = JSON.parse(sale.items_json || sale.items || '[]'); } catch { /* mantém vazio */ }
  return {
    numeroLoja: sale.id,
    itens: items
      .filter((i) => i && (i.titulo || i.nome))
      .map((i) => {
        const codigoDireto = i.codigo || i.sku || i.produto_codigo;
        const codigo = codigoDireto || resolveCodigoFromMap(tenantId, i);
        return {
          ...(codigo ? { codigo: String(codigo) } : {}),
          descricao: String(i.titulo || i.nome).slice(0, 120),
          quantidade: Math.max(1, Math.round(Number(i.quantidade) || 1)),
          valor: Number(Number(i.valor_unitario || 0).toFixed(2)),
        };
      }),
  };
}

/**
 * Envia um pedido pago para o Bling (pedido de venda, base para emitir NF).
 * Idempotente por venda — pula silenciosamente se `sale.bling_pedido_id` já
 * estiver preenchido. Nunca lança: uma falha aqui não pode derrubar a
 * confirmação de pagamento que já foi (ou está sendo) enviada ao cliente —
 * o erro fica registrado em sales.bling_push_error para o lojista ver.
 */
export async function pushOrderToBling(tenant, sale) {
  if (!tenant?.bling_access_token || !sale || sale.bling_pedido_id) return;
  try {
    const payload = buildBlingPedidoPayload(sale, tenant.id);
    if (!payload.itens.length) return;
    const res = await blingFetch(tenant, '/pedidos/vendas', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.description || `Bling pedido ${res.status}`);
    saleQueries.setBlingPushSuccess.run(String(data.data?.id || ''), sale.id);
  } catch (err) {
    console.error('[Bling] Falha ao enviar pedido:', err.message);
    saleQueries.setBlingPushError.run(String(err.message).slice(0, 500), sale.id);
  }
}
