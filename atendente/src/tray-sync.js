/**
 * Sincronização periódica de produtos/estoque da Tray — mesmo formato de
 * scheduler de src/bling-sync.js. Ver aviso sobre a API da Tray em src/tray.js.
 */
import { tenantQueries, decryptTenant, trayProductMapQueries, notificationQueries, saveBusinessJson } from './db.js';
import { normalizeBusiness } from './business.js';
import { planAtLeast } from './plans.js';
import { encryptSecret } from './crypto.js';
import { getValidTrayToken, fetchTrayProdutos, extractTrayEstoques } from './tray.js';

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const INITIAL_DELAY_MS = 6 * 60 * 1000; // depois do Bling (4min) e Nuvemshop (5min)

async function syncTenant(tenant) {
  let accessToken;
  try {
    const result = await getValidTrayToken(tenant);
    accessToken = result.access_token;
    if (result.refreshed) {
      const expiresAt = new Date(Date.now() + (Number(result.refreshed.expires_in) || 14 * 24 * 60 * 60) * 1000).toISOString();
      tenantQueries.setTrayCredentials.run({
        id: tenant.id,
        tray_access_token: encryptSecret(result.refreshed.access_token),
        tray_refresh_token: encryptSecret(result.refreshed.refresh_token || tenant.tray_refresh_token),
        tray_token_expires_at: expiresAt,
        tray_api_address: tenant.tray_api_address,
      });
    }
  } catch (err) {
    tenantQueries.clearTrayCredentials.run(tenant.id);
    notificationQueries.create.run({
      tenant_id: tenant.id,
      type: 'tray_desconectado',
      title: 'Conexão com a Tray perdida',
      message: 'Não foi possível renovar o acesso à Tray. Reconecte em Configurações → Integrações.',
      contact_id: null,
    });
    throw err;
  }

  const produtosTray = await fetchTrayProdutos(tenant, accessToken);
  if (!produtosTray.length) return;

  const estoquesPorNome = extractTrayEstoques(produtosTray);

  const biz = normalizeBusiness(tenant.business_json);
  let changed = false;
  for (const produto of biz.produtos) {
    const match = estoquesPorNome.get(produto.nome);
    if (!match) continue;

    trayProductMapQueries.upsert.run({
      tenant_id: tenant.id,
      produto_nome: produto.nome,
      tray_produto_id: String(match.id),
      tray_sku: match.sku,
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

async function runTraySync() {
  const tenants = tenantQueries.listAll.all()
    .filter((t) => t.active)
    .map(decryptTenant)
    .filter((t) => t.tray_access_token && planAtLeast(t.plan, 'elite'));

  for (const tenant of tenants) {
    try {
      await syncTenant(tenant);
    } catch (err) {
      console.warn(`[Tray Sync] Falha ao sincronizar tenant ${tenant.id}:`, err.message);
    }
  }
}

export function startTraySyncScheduler() {
  setTimeout(() => {
    runTraySync().catch((e) => console.error('[Tray Sync] Erro:', e.message));
    setInterval(() => {
      runTraySync().catch((e) => console.error('[Tray Sync] Erro:', e.message));
    }, CHECK_INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();
  console.log('Sincronização Tray iniciada (verifica a cada 15 min).');
}
