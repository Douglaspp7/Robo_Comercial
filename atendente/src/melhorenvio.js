import { fetchWithTimeout } from './http.js';
import { saleQueries } from './db.js';

const ME_API = 'https://melhorenvio.com.br/api/v2';
const UA = 'Zapien/2.0 (douglaspp7@gmail.com)';

// Escopos que o Zapien pede no token do Melhor Envio para gerar etiqueta.
// - shipping-generate: adicionar item ao carrinho de etiquetas (/me/cart)
// - shipping-checkout: comprar a etiqueta usando o saldo (/me/shipment/checkout)
// - shipping-print:    baixar o PDF pronto (/me/shipment/print)
// (shipping-calculate é separado — só cotação de frete, o token pode ter só ele.)
export const ME_REQUIRED_SCOPES_LABEL = ['shipping-generate', 'shipping-checkout', 'shipping-print'];

/**
 * Extrai os escopos declarados no JWT do Melhor Envio SEM verificar assinatura.
 * O token pertence ao próprio lojista — não estamos autenticando terceiros;
 * só queremos saber se ele marcou 'shipping-generate' e 'shipping-checkout' na
 * hora de gerar o token. Se o payload for inválido, devolve array vazio.
 *
 * @param {string} token
 * @returns {string[]} lista de escopos (ex: ['shipping-calculate', 'shipping-generate'])
 */
export function parseTokenScopes(token) {
  if (!token || typeof token !== 'string') return [];
  const parts = token.split('.');
  if (parts.length < 2) return [];
  try {
    // base64url → base64
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    // padding
    const padded = b64 + '=='.slice(0, (4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    const payload = JSON.parse(json);
    if (Array.isArray(payload.scopes)) return payload.scopes;
    if (typeof payload.scope === 'string') return payload.scope.split(/\s+/).filter(Boolean);
    return [];
  } catch {
    return [];
  }
}

/**
 * Diagnóstico do token: o que ele consegue fazer no Zapien?
 * Retorno usado pelo endpoint /api/settings/melhor-envio/status e como
 * pré-check pelo /api/sales/:id/etiqueta antes de gastar uma chamada Meta.
 */
export function tokenCapabilities(token) {
  const scopes = parseTokenScopes(token);
  return {
    scopes,
    can_calculate: scopes.includes('shipping-calculate') || scopes.includes('*'),
    can_generate_label:
      (scopes.includes('shipping-generate') || scopes.includes('*')) &&
      (scopes.includes('shipping-checkout') || scopes.includes('*')) &&
      (scopes.includes('shipping-print') || scopes.includes('*')),
    missing_for_label: ME_REQUIRED_SCOPES_LABEL.filter((s) => !scopes.includes(s) && !scopes.includes('*')),
  };
}

function meHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': UA,
    Accept: 'application/json',
  };
}

async function mePost(path, token, body, timeoutMs = 20000) {
  const res = await fetchWithTimeout(`${ME_API}${path}`, {
    method: 'POST',
    headers: meHeaders(token),
    body: JSON.stringify(body),
  }, timeoutMs);
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { /* raw pode não ser JSON em erro */ }
  if (!res.ok) {
    const msg = data?.message || data?.error || raw.slice(0, 200) || `HTTP ${res.status}`;
    const err = new Error(`Melhor Envio ${res.status}: ${msg}`);
    err.statusCode = res.status;
    err.responseBody = data ?? raw;
    throw err;
  }
  return data;
}

/**
 * Calcula opcoes de frete via Melhor Envio.
 * @param {string} token  - Bearer token do tenant no Melhor Envio
 * @param {string} cepOrigem  - CEP do remetente (apenas digitos)
 * @param {string} cepDestino - CEP do destinatario (apenas digitos)
 * @param {number} pesoKg - Peso estimado do pacote em kg
 * @returns {Promise<Array<{nome,empresa,preco,prazo_dias}>>}
 */
export async function calcularFrete(token, cepOrigem, cepDestino, pesoKg = 0.5) {
  const body = JSON.stringify({
    from: { postal_code: cepOrigem.replace(/\D/g, '') },
    to:   { postal_code: cepDestino.replace(/\D/g, '') },
    package: { height: 10, width: 15, length: 20, weight: pesoKg },
    options: { receipt: false, own_hand: false },
  });

  const res = await fetchWithTimeout(`${ME_API}/me/shipment/calculate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Zapien/2.0 (douglaspp7@gmail.com)',
      Accept: 'application/json',
    },
    body,
  }, 15000);

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Melhor Envio ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  return data
    .filter((s) => s.price && !s.error)
    .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
    .map((s) => ({
      nome: s.name,
      empresa: s.company?.name || '',
      preco: parseFloat(s.price),
      prazo_dias: s.delivery_time,
    }));
}

// ─── Etiqueta / rastreio ─────────────────────────────────────────────────
//
// Fluxo Melhor Envio para gerar etiqueta:
//   1. POST /me/cart              → adiciona serviço + endereços + volumes
//   2. POST /me/shipment/checkout → paga o pedido (debita saldo do lojista)
//   3. POST /me/shipment/print    → devolve a URL do PDF pronto pra impressão
//
// Cada passo pode falhar (crédito insuficiente, endereço inválido, escopo
// OAuth faltando). O orquestrador generateLabel() abaixo trata cada erro,
// grava me_label_status='erro' e me_label_error='motivo' na sale — o front
// consegue mostrar a causa e permitir retry sem duplicar cobrança.

/**
 * Passo 1 — Adiciona um serviço de envio ao carrinho do Melhor Envio.
 * @param {string} token   OAuth token do tenant (escopo shipping-generate)
 * @param {object} params
 * @param {number} params.serviceId    ID do serviço (PAC=1, SEDEX=2, Jadlog=3, ...)
 * @param {{name,phone,email,document,address,city,state_abbr,postal_code,country_id,complement,number,district}} params.from
 * @param {{name,phone,email,document,address,city,state_abbr,postal_code,country_id,complement,number,district}} params.to
 * @param {Array<{name,quantity,unitary_value}>} params.products
 * @param {{height,width,length,weight}} params.volumes
 * @param {{insurance_value,receipt,own_hand,reverse,non_commercial}} [params.options]
 * @returns {Promise<{id: string, protocol: string}>}
 */
export async function addToCart(token, params) {
  const body = {
    service: params.serviceId,
    from: params.from,
    to: params.to,
    products: params.products,
    volumes: [params.volumes],
    options: {
      insurance_value: params.options?.insurance_value ?? 0,
      receipt: params.options?.receipt ?? false,
      own_hand: params.options?.own_hand ?? false,
      reverse: params.options?.reverse ?? false,
      non_commercial: params.options?.non_commercial ?? true,
    },
  };
  return mePost('/me/cart', token, body);
}

/**
 * Passo 2 — Paga um ou mais pedidos do carrinho (checkout).
 * @param {string} token
 * @param {string[]} orderIds  IDs retornados pelo addToCart
 * @returns {Promise<{purchase: {id, orders: Array<{id, protocol, status}>}}>}
 */
export async function checkoutCart(token, orderIds) {
  return mePost('/me/shipment/checkout', token, { orders: orderIds });
}

/**
 * Passo 3 — Gera a URL do PDF da etiqueta.
 * @param {string} token
 * @param {string[]} orderIds
 * @returns {Promise<{url: string}>}
 */
export async function printLabel(token, orderIds) {
  return mePost('/me/shipment/print', token, { mode: 'private', orders: orderIds });
}

/**
 * Orquestrador — encadeia cart → checkout → print e persiste o resultado na sale.
 * Não lança em falhas conhecidas (guarda no me_label_error da própria venda).
 * Só lança se a sale/tenant vier inválido — chamador precisa validar antes.
 *
 * @param {string} token
 * @param {object} sale      Venda (precisa ter .id)
 * @param {object} labelData Params já normalizados: serviceId, from, to, products, volumes, options
 * @returns {Promise<{ok: true, tracking: string, orderId: string, labelUrl: string}
 *                 | {ok: false, error: string, step: 'cart'|'checkout'|'print'}>}
 */
export async function generateLabel(token, sale, labelData) {
  let orderId = null;

  try {
    const cart = await addToCart(token, labelData);
    orderId = cart.id;
  } catch (err) {
    const msg = err.message || 'Falha ao adicionar ao carrinho';
    saleQueries.setMelhorEnvioError.run(msg, sale.id);
    return { ok: false, error: msg, step: 'cart' };
  }

  try {
    await checkoutCart(token, [orderId]);
  } catch (err) {
    const msg = err.message || 'Falha ao pagar a etiqueta';
    // Guarda o orderId mesmo em erro de checkout: chamador pode saber que
    // o carrinho ficou pendurado no Melhor Envio (o lojista pode limpar lá).
    saleQueries.setMelhorEnvioError.run(msg, sale.id);
    return { ok: false, error: msg, step: 'checkout', orderId };
  }

  let labelUrl = null;
  try {
    const printed = await printLabel(token, [orderId]);
    labelUrl = printed?.url || printed?.[orderId]?.url || null;
  } catch (err) {
    // Etiqueta comprada mas PDF falhou — a compra já debitou. Persistimos
    // rastreio (se veio) e o URL fica null: front mostra "regerar PDF".
    const msg = err.message || 'Etiqueta comprada, mas falhou ao gerar PDF';
    saleQueries.setMelhorEnvioError.run(msg, sale.id);
    return { ok: false, error: msg, step: 'print', orderId };
  }

  // Sucesso — o tracking_code oficial só sai depois da postagem, então
  // por ora salvamos o orderId como tracking provisório (o print costuma
  // já trazer o rastreio final, mas nem sempre). O worker de rastreio
  // (PR futuro) pode atualizar quando o Correios aceitar o pacote.
  const trackingCode = orderId; // provisório — atualizado pelo worker de rastreio
  saleQueries.setMelhorEnvioLabel.run({
    id: sale.id,
    me_order_id: orderId,
    me_tracking_code: trackingCode,
    me_label_url: labelUrl,
  });

  return { ok: true, orderId, tracking: trackingCode, labelUrl };
}
