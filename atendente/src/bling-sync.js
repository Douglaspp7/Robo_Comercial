/**
 * Sincronização periódica de produtos/estoque do Bling — mesmo formato de
 * scheduler de src/followup.js e src/daily-summary.js (setTimeout inicial
 * escalonado + setInterval, iterando tenants ativos).
 *
 * Reconcilia por NOME exato do produto (bling_product_map), a mesma
 * limitação já aceita pelo controle de estoque em src/stock.js — produtos do
 * Zapien não têm ID estável. Se o lojista renomear um produto no Bling ou no
 * Zapien, a reconciliação para até re-sincronizar manualmente.
 */
import { tenantQueries, decryptTenant, blingProductMapQueries, saveBusinessJson } from './db.js';
import { normalizeBusiness } from './business.js';
import { planAtLeast } from './plans.js';
import { fetchBlingProdutos, fetchBlingEstoques } from './bling.js';

function productCode(produto) {
  return String(produto?.codigo || produto?.sku || produto?.produto_codigo || '').trim();
}

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutos — estoque é sensível a atraso
const INITIAL_DELAY_MS = 4 * 60 * 1000; // depois do follow-up (2min) e resumo diário (3min)

async function syncTenant(tenant) {
  const produtosBling = await fetchBlingProdutos(tenant);
  if (!produtosBling.length) return;

  const idsPorCodigo = new Map();
  const idsPorNome = new Map();
  for (const p of produtosBling) {
    const codigo = productCode(p);
    const match = { id: p.id, sku: codigo || null };
    if (codigo) idsPorCodigo.set(codigo, match);
    if (p?.nome) idsPorNome.set(p.nome, match);
  }

  const saldos = await fetchBlingEstoques(tenant, produtosBling.map((p) => p.id));

  const biz = normalizeBusiness(tenant.business_json);
  let changed = false;
  for (const produto of biz.produtos) {
    const codigo = productCode(produto);
    const match = (codigo && idsPorCodigo.get(codigo)) || idsPorNome.get(produto.nome);
    if (!match) continue;

    const mapPayload = {
      tenant_id: tenant.id,
      produto_nome: produto.nome,
      produto_codigo: codigo || match.sku || null,
      bling_produto_id: String(match.id),
      bling_sku: match.sku,
      product_id: produto.product_id || null,
    };
    if (mapPayload.produto_codigo) blingProductMapQueries.upsertByCodigo.run(mapPayload);
    else blingProductMapQueries.upsert.run(mapPayload);

    const saldo = saldos[match.id];
    if (saldo !== undefined && Number(produto.estoque_qtd) !== saldo) {
      produto.estoque_qtd = saldo;
      produto.esgotado = saldo <= 0;
      changed = true;
    }
  }

  if (changed) {
    saveBusinessJson(tenant.id, biz);
  }
}

async function runBlingSync() {
  const tenants = tenantQueries.listAll.all()
    .filter((t) => t.active)
    .map(decryptTenant)
    .filter((t) => t.bling_access_token && planAtLeast(t.plan, 'elite'));

  for (const tenant of tenants) {
    try {
      await syncTenant(tenant);
    } catch (err) {
      // getValidBlingToken() já notifica e desconecta o tenant sozinho se o
      // refresh_token for rejeitado; aqui só logamos falhas transitórias
      // (rate limit, timeout) sem gerar aviso a cada ciclo de 15 min.
      console.warn(`[Bling Sync] Falha ao sincronizar tenant ${tenant.id}:`, err.message);
    }
  }
}

export function startBlingSyncScheduler() {
  setTimeout(() => {
    runBlingSync().catch((e) => console.error('[Bling Sync] Erro:', e.message));
    setInterval(() => {
      runBlingSync().catch((e) => console.error('[Bling Sync] Erro:', e.message));
    }, CHECK_INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();
  console.log('Sincronização Bling iniciada (verifica a cada 15 min).');
}
