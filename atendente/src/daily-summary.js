import { db, tenantQueries, decryptTenant } from './db.js';
import { config } from './config.js';
import { normalizeBusiness } from './business.js';
import { sendText } from './whatsapp.js';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // verifica a cada 30 minutos

// A plataforma envia pelo número compartilhado (config.whatsapp), igual ao follow-up.
const platformWhatsappReady = Boolean(config.whatsapp.phoneNumberId && config.whatsapp.token);

function currencyBRL(cents) {
  return ((cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Monta o texto do resumo diário de um tenant com as estatísticas de hoje.
 * Isolada do scheduler para ser testável sem precisar mockar WhatsApp/tempo.
 */
export function buildDailySummaryMessage(tenant) {
  const tid = tenant.id;

  const novosContatos = db.prepare(`
    SELECT COUNT(*) AS n FROM contacts WHERE tenant_id = ? AND date(created_at) = date('now')
  `).get(tid).n;

  const respostasIa = db.prepare(`
    SELECT COUNT(*) AS n FROM messages m
    JOIN contacts c ON c.id = m.contact_id
    WHERE c.tenant_id = ? AND m.role = 'assistant' AND date(m.created_at) = date('now')
  `).get(tid).n;

  const vendasHoje = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(total_cents, CAST(amount * 100 AS INTEGER))), 0) AS valor_cents
    FROM sales WHERE tenant_id = ? AND status IN ('pago', 'paid') AND date(paid_at) = date('now')
  `).get(tid);

  const aguardandoPagamento = db.prepare(`
    SELECT COUNT(*) AS n FROM sales
    WHERE tenant_id = ? AND status IN ('checkout_enviado', 'aguardando_pagamento', 'pending')
  `).get(tid).n;

  const aguardandoHumano = db.prepare(`
    SELECT COUNT(*) AS n FROM contacts WHERE tenant_id = ? AND handoff_status = 'waiting'
  `).get(tid).n;

  const linhas = [
    `📊 *Resumo do dia — ${tenant.business_name || 'sua loja'}*`,
    '',
    `👥 Novos contatos: ${novosContatos}`,
    `🤖 Respostas da IA: ${respostasIa}`,
    `💰 Vendas fechadas: ${vendasHoje.n} (${currencyBRL(vendasHoje.valor_cents)})`,
  ];
  if (aguardandoPagamento > 0) linhas.push(`⏳ Aguardando pagamento: ${aguardandoPagamento}`);
  if (aguardandoHumano > 0) linhas.push(`🚨 Aguardando humano: ${aguardandoHumano}`);
  linhas.push('', `Acesse o painel: ${config.appUrl}/dashboard.html`);

  return linhas.join('\n');
}

async function runDailySummaries() {
  if (!platformWhatsappReady) return;
  const currentHour = new Date().getHours();
  const today = new Date().toISOString().slice(0, 10);

  const allTenants = tenantQueries.listAll.all().filter((t) => t.active).map(decryptTenant);

  for (const tenant of allTenants) {
    if (!tenant.notify_phone) continue;
    if (!tenant.plan || tenant.plan === 'essencial') continue;
    if (tenant.daily_summary_sent_date === today) continue;

    const biz = normalizeBusiness(tenant.business_json);
    const resumo = biz.resumoDiario;
    if (!resumo?.ativo || currentHour !== resumo.hora) continue;

    try {
      const mensagem = buildDailySummaryMessage(tenant);
      await sendText(tenant, tenant.notify_phone, mensagem);
      tenantQueries.setDailySummarySentDate.run(today, tenant.id);
      console.log(`[Resumo diário] ${tenant.business_name} → ${tenant.notify_phone}`);
    } catch (e) {
      console.warn(`[Resumo diário] Falha ao enviar para ${tenant.business_name}:`, e.message);
    }
  }
}

export function startDailySummaryScheduler() {
  // Primeira execução após 3 minutos do boot (não entupir o startup).
  setTimeout(() => {
    runDailySummaries().catch((e) => console.error('[Resumo diário] Erro:', e.message));
    setInterval(() => {
      runDailySummaries().catch((e) => console.error('[Resumo diário] Erro:', e.message));
    }, CHECK_INTERVAL_MS).unref();
  }, 3 * 60 * 1000).unref();
  console.log('Resumo diário automático iniciado (verifica a cada 30 min).');
}
