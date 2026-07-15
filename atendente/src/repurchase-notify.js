import { tenantQueries, decryptTenant, notificationQueries } from './db.js';
import { normalizeBusiness } from './business.js';
import { getRepurchaseSuggestions } from './repurchase.js';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // verifica a cada 30 minutos

/**
 * Cria um aviso agrupado na Central de Avisos quando existir pelo menos uma
 * sugestão de recompra pendente — no máximo um aviso por tenant por dia
 * (guarda em tenants.repurchase_notice_sent_date), pra não repetir a cada
 * verificação enquanto a mesma sugestão continuar valendo.
 */
export function runRepurchaseNotifications() {
  const today = new Date().toISOString().slice(0, 10);
  const allTenants = tenantQueries.listAll.all().filter((t) => t.active).map(decryptTenant);

  for (const tenant of allTenants) {
    if (tenant.repurchase_notice_sent_date === today) continue;

    const biz = normalizeBusiness(tenant.business_json);
    let suggestions;
    try {
      suggestions = getRepurchaseSuggestions(tenant.id, biz.produtos);
    } catch (e) {
      console.warn(`[Recompra] Falha ao calcular sugestões de ${tenant.business_name}:`, e.message);
      continue;
    }
    if (!suggestions.length) continue;

    const message = suggestions.length === 1
      ? `${suggestions[0].name} está no ciclo de recompra de "${suggestions[0].produto}" — dá uma olhada no Início.`
      : `${suggestions.length} clientes estão no ciclo de recompra — dá uma olhada no Início.`;

    notificationQueries.create.run({
      tenant_id: tenant.id,
      type: 'recompra',
      title: 'Hora de recompra',
      message,
      contact_id: null,
    });
    tenantQueries.setRepurchaseNoticeSentDate.run(today, tenant.id);
    console.log(`[Recompra] ${tenant.business_name} → ${suggestions.length} sugestão(ões)`);
  }
}

export function startRepurchaseNoticeScheduler() {
  // Primeira execução após 4 minutos do boot (não entupir o startup).
  setTimeout(() => {
    try { runRepurchaseNotifications(); } catch (e) { console.error('[Recompra] Erro:', e.message); }
    setInterval(() => {
      try { runRepurchaseNotifications(); } catch (e) { console.error('[Recompra] Erro:', e.message); }
    }, CHECK_INTERVAL_MS).unref();
  }, 4 * 60 * 1000).unref();
  console.log('Aviso automático de recompra iniciado (verifica a cada 30 min).');
}
