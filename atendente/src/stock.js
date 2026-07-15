import { tenantQueries, saleQueries, saveBusinessJson } from './db.js';
import { normalizeBusiness } from './business.js';

/**
 * Controle de estoque — só produtos com "estoque_qtd" configurado (número)
 * são controlados; produtos sem esse campo continuam usando o "esgotado"
 * manual de sempre (ver ai.js/api.js da lista de espera). Casamento entre
 * item vendido e produto do catálogo é pelo nome exato — mesma limitação já
 * aceita nas demais features (produtos não têm ID estável).
 *
 * Sempre relê o tenant na hora (em vez de confiar num objeto já carregado
 * antes), pra reduzir a janela de leitura-e-escrita desatualizada quando
 * dois pedidos do mesmo tenant são processados quase ao mesmo tempo. Não
 * elimina 100% a corrida (business_json não é atualizado com lock), mas é
 * uma limitação aceitável na escala de um lojista pequeno — ver README do
 * módulo/PR pra detalhes.
 */

function loadProdutos(tenantId) {
  const tenant = tenantQueries.byId.get(tenantId);
  const biz = normalizeBusiness(tenant?.business_json);
  return { tenant, produtos: Array.isArray(biz.produtos) ? biz.produtos : [] };
}

function persistProdutos(tenant, produtos) {
  const biz = normalizeBusiness(tenant.business_json);
  biz.produtos = produtos;
  saveBusinessJson(tenant.id, biz);
}

function parseItems(sale) {
  try {
    const items = JSON.parse(sale.items_json || sale.items || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function productCode(value) {
  return String(value?.codigo || value?.sku || value?.produto_codigo || '').trim();
}

function findProdutoForItem(produtos, item) {
  const codigo = productCode(item);
  if (codigo) {
    const byCode = produtos.find((p) => productCode(p) === codigo);
    if (byCode) return byCode;
  }
  return produtos.find((p) => p.nome === item.titulo || p.nome === item.nome);
}

// "" (campo vazio no formulário), null e undefined significam "não controla
// estoque deste produto" — Number('') é 0 e passaria como válido sem este
// filtro, tratando erroneamente um produto sem controle como zerado.
function trackedQty(produto) {
  const raw = produto.estoque_qtd;
  if (raw === undefined || raw === null || raw === '') return null;
  const qtd = Number(raw);
  return Number.isFinite(qtd) ? qtd : null;
}

/**
 * Desconta o estoque dos produtos vendidos numa venda recém-criada/confirmada.
 * Idempotente por venda (marca stock_adjusted=1) — chamar de novo não desconta
 * duas vezes. Retorna os nomes dos produtos que chegaram a 0 nesta chamada.
 */
export function deductStockForSale(tenantId, sale) {
  if (sale.stock_adjusted) return [];

  const { tenant, produtos } = loadProdutos(tenantId);
  if (!tenant) return [];

  const items = parseItems(sale);
  const zeroedOut = [];
  let changed = false;

  for (const item of items) {
    const produto = findProdutoForItem(produtos, item);
    if (!produto) continue;
    const qtd = trackedQty(produto);
    if (qtd === null) continue; // produto sem controle de estoque

    const consumido = Math.max(0, Math.round(Number(item.quantidade) || 1));
    const novaQtd = Math.max(0, qtd - consumido);
    const jaEstavaZerado = qtd <= 0;
    produto.estoque_qtd = novaQtd;
    produto.esgotado = novaQtd <= 0;
    changed = true;
    if (novaQtd <= 0 && !jaEstavaZerado) zeroedOut.push(produto.nome);
  }

  if (changed) persistProdutos(tenant, produtos);
  saleQueries.setStockAdjusted.run(1, sale.id);
  return zeroedOut;
}

/**
 * Devolve ao estoque os produtos de uma venda que tinha sido descontada e
 * foi cancelada/recusada/perdida depois. Idempotente (só age se
 * stock_adjusted=1); zera a marca ao terminar.
 */
export function restoreStockForSale(tenantId, sale) {
  if (!sale.stock_adjusted) return;

  const { tenant, produtos } = loadProdutos(tenantId);
  if (!tenant) return;

  const items = parseItems(sale);
  let changed = false;

  for (const item of items) {
    const produto = findProdutoForItem(produtos, item);
    if (!produto) continue;
    const qtd = trackedQty(produto);
    if (qtd === null) continue;

    const devolvido = Math.max(0, Math.round(Number(item.quantidade) || 1));
    produto.estoque_qtd = qtd + devolvido;
    produto.esgotado = produto.estoque_qtd <= 0;
    changed = true;
  }

  if (changed) persistProdutos(tenant, produtos);
  saleQueries.setStockAdjusted.run(0, sale.id);
}
