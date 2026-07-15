/**
 * Sincronização periódica de produtos/estoque da Nuvemshop — mesmo formato de
 * scheduler de src/bling-sync.js.
 */
import { tenantQueries, decryptTenant, nuvemshopProductMapQueries, saveBusinessJson } from './db.js';
import { normalizeBusiness } from './business.js';
import { planAtLeast } from './plans.js';
import { fetchNuvemshopProdutos, extractNuvemshopEstoques } from './nuvemshop.js';

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const INITIAL_DELAY_MS = 5 * 60 * 1000; // depois do Bling (4min)

async function syncTenant(tenant) {
  const produtosNuvemshop = await fetchNuvemshopProdutos(tenant);
  if (!produtosNuvemshop.length) return;

  const estoquesPorNome = extractNuvemshopEstoques(produtosNuvemshop);

  const biz = normalizeBusiness(tenant.business_json);
  let changed = false;
  for (const produto of biz.produtos) {
    const match = estoquesPorNome.get(produto.nome);
    if (!match) continue;

    nuvemshopProductMapQueries.upsert.run({
      tenant_id: tenant.id,
      produto_nome: produto.nome,
      nuvemshop_produto_id: String(match.id),
      nuvemshop_sku: match.sku,
      product_id: produto.product_id || null,
    });

    if (Number(produto.estoque_qtd) !== match.estoque) {
      produto.estoque_qtd = match.estoque;
      produto.esgotado = match.estoque <= 0;
      changed = true;
    }
  }

  if (changed) {
    saveBusinessJson(tenant.id, biz);
  }
}

async function runNuvemshopSync() {
  const tenants = tenantQueries.listAll.all()
    .filter((t) => t.active)
    .map(decryptTenant)
    .filter((t) => t.nuvemshop_access_token && planAtLeast(t.plan, 'elite'));

  for (const tenant of tenants) {
    try {
      await syncTenant(tenant);
    } catch (err) {
      console.warn(`[Nuvemshop Sync] Falha ao sincronizar tenant ${tenant.id}:`, err.message);
    }
  }
}

export function startNuvemshopSyncScheduler() {
  setTimeout(() => {
    runNuvemshopSync().catch((e) => console.error('[Nuvemshop Sync] Erro:', e.message));
    setInterval(() => {
      runNuvemshopSync().catch((e) => console.error('[Nuvemshop Sync] Erro:', e.message));
    }, CHECK_INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();
  console.log('Sincronização Nuvemshop iniciada (verifica a cada 15 min).');
}
