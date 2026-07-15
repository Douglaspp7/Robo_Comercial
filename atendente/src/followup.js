import { contactQueries, tenantQueries, decryptTenant } from './db.js';
import { config } from './config.js';
import { normalizeBusiness } from './business.js';
import { sendText } from './whatsapp.js';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // verifica a cada 30 minutos

// A plataforma envia pelo número compartilhado (config.whatsapp). O follow-up só
// faz sentido se esse número estiver configurado — não depende de credenciais
// WhatsApp por tenant (que ficam vazias no modelo de número único).
const platformWhatsappReady = Boolean(config.whatsapp.phoneNumberId && config.whatsapp.token);

async function runFollowUps() {
  if (!platformWhatsappReady) return; // sem número da plataforma, nada a enviar
  // Coleta configurações de follow-up de todos os tenants ativos
  const allTenants = tenantQueries.listAll.all().filter((t) => t.active).map(decryptTenant);

  for (const tenant of allTenants) {
    const biz = normalizeBusiness(tenant.business_json);
    const followup = biz.followup;
    if (!followup?.ativo || !followup?.mensagem) continue;
    if (!tenant.plan || tenant.plan === 'essencial') continue;

    const horas = Number(followup.horas) || 24;
    const offset = `-${horas} hours`;

    let candidates;
    try {
      candidates = contactQueries.followUpCandidates.all(offset).filter(
        (c) => c.tenant_id === tenant.id
      );
    } catch { continue; }

    for (const contact of candidates) {
      if (contact.wa_phone.startsWith('_sandbox_')) continue;
      try {
        await sendText(tenant, contact.wa_phone, followup.mensagem);
        contactQueries.setFollowUpSent.run(contact.id);
        console.log(`[Follow-up] ${tenant.business_name} → ${contact.wa_phone}`);
      } catch (e) {
        console.warn(`[Follow-up] Falha ao enviar para ${contact.wa_phone}:`, e.message);
      }
    }
  }
}

export function startFollowUpScheduler() {
  // Primeira execução após 2 minutos do boot (não entupir o startup)
  setTimeout(() => {
    runFollowUps().catch((e) => console.error('[Follow-up] Erro:', e.message));
    setInterval(() => {
      runFollowUps().catch((e) => console.error('[Follow-up] Erro:', e.message));
    }, CHECK_INTERVAL_MS).unref();
  }, 2 * 60 * 1000).unref();
  console.log('Follow-up automático iniciado (verifica a cada 30 min).');
}
