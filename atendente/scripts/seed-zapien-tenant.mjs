/**
 * Semeia o tenant "Zapien vende Zapien" — o atendente que, no número dedicado
 * do disparo, vende o próprio Zapien. Idempotente: se o e-mail já existe,
 * atualiza o conteúdo comercial e preserva personalizações. Rodar no atendente:
 *
 *   ATTENDANT_SEED_EMAIL=vende@zapien.app ATTENDANT_SEED_PASSWORD='troque-isto' \
 *   node scripts/seed-zapien-tenant.mjs
 *
 * Depois, copie o TENANT_ID impresso para a env ATTENDANT_TENANT_ID e ajuste o
 * texto de venda no painel (Configurações → Negócio) — este é só um rascunho.
 */
import { createTenant } from '../src/auth.js';
import { tenantQueries, db } from '../src/db.js';
import { mergeZapienSalesSeed } from '../src/seeds/merge-zapien-seed.js';
import { ZAPIEN_SALES_SEED_VERSION } from '../src/seeds/zapien-business.js';

const email = (process.env.ATTENDANT_SEED_EMAIL || 'vende@zapien.app').toLowerCase().trim();
const password = process.env.ATTENDANT_SEED_PASSWORD || '';
const existing = tenantQueries.byEmail.get(email);
if (existing) {
  const business = mergeZapienSalesSeed(existing.business_json);
  db.prepare('UPDATE tenants SET business_name = ?, atendente_name = ?, business_json = ? WHERE id = ?')
    .run('Zapien', 'Zapi', JSON.stringify(business), existing.id);
  console.log(`Tenant atualizado para o seed comercial v${ZAPIEN_SALES_SEED_VERSION}. TENANT_ID=${existing.id}`);
  process.exit(0);
}

if (password.length < 12) {
  console.error('Defina ATTENDANT_SEED_PASSWORD com pelo menos 12 caracteres para criar um tenant novo.');
  process.exit(1);
}

const tenant = createTenant(email, password);
const business = mergeZapienSalesSeed({});
db.prepare('UPDATE tenants SET business_name = ?, atendente_name = ? WHERE id = ?').run('Zapien', 'Zapi', tenant.id);
tenantQueries.updateBusinessJson.run(JSON.stringify(business), tenant.id);
tenantQueries.markEmailVerified.run(tenant.id);

console.log(`Tenant "Zapien vende Zapien" criado com o seed comercial v${ZAPIEN_SALES_SEED_VERSION}.`);
console.log(`TENANT_ID=${tenant.id}`);
console.log(`login: ${email}  (troque a senha depois no painel)`);
console.log('Ajuste o texto de venda em Configurações → Negócio.');
