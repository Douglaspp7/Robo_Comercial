/**
 * Semeia o tenant "Zapien vende Zapien" — o atendente que, no número dedicado
 * do disparo, vende o próprio Zapien. Idempotente: se o e-mail já existe, só
 * imprime o id. Rodar uma vez no ambiente do atendente (modo gateway):
 *
 *   ATTENDANT_SEED_EMAIL=vende@zapien.app ATTENDANT_SEED_PASSWORD='troque-isto' \
 *   node scripts/seed-zapien-tenant.mjs
 *
 * Depois, copie o TENANT_ID impresso para a env ATTENDANT_TENANT_ID e ajuste o
 * texto de venda no painel (Configurações → Negócio) — este é só um rascunho.
 */
import { createTenant } from '../src/auth.js';
import { tenantQueries, db } from '../src/db.js';
import { normalizeBusiness } from '../src/business.js';

const email = (process.env.ATTENDANT_SEED_EMAIL || 'vende@zapien.app').toLowerCase().trim();
const password = process.env.ATTENDANT_SEED_PASSWORD || '';
if (password.length < 12) {
  console.error('Defina ATTENDANT_SEED_PASSWORD com pelo menos 12 caracteres.');
  process.exit(1);
}

// Rascunho editável do negócio: o "produto" é o próprio Zapien.
const business = normalizeBusiness({
  tipo_negocio: 'servicos',
  descricao:
    'Zapien — atendente de vendas com IA no WhatsApp para pequenos vendedores, ' +
    'e-commerce e revenda. Centraliza atendimento, catálogo, frete, pagamento e ' +
    'clientes num único número e responde na hora, para não perder venda por ' +
    'demora. Teste grátis por 7 dias, sem cartão. Detalhes e cadastro em ' +
    'https://zapien.app.',
  tomDeVoz:
    'Direto, simpático e comercial, jeito brasileiro. Entenda a dor (perder venda ' +
    'no WhatsApp por demora ou por atender sozinho) e mostre como o Zapien resolve, ' +
    'levando ao teste grátis. No máximo 2 frases curtas por mensagem. Nunca invente ' +
    'preço, prazo ou recurso; se não souber, ofereça falar com uma pessoa. Não peça ' +
    'dados sensíveis.',
  produtos: [
    {
      nome: 'Zapien (atendente de vendas com IA)',
      descricao:
        'Atende no WhatsApp, tira dúvidas, monta orçamento e ajuda a fechar. ' +
        '7 dias grátis, sem cartão.',
      preco: '',
    },
  ],
});

const existing = tenantQueries.byEmail.get(email);
if (existing) {
  console.log(`Tenant já existe. TENANT_ID=${existing.id}`);
  process.exit(0);
}

const tenant = createTenant(email, password);
db.prepare('UPDATE tenants SET business_name = ? WHERE id = ?').run('Zapien', tenant.id);
tenantQueries.updateBusinessJson.run(JSON.stringify(business), tenant.id);
tenantQueries.markEmailVerified.run(tenant.id);

console.log('Tenant "Zapien vende Zapien" criado.');
console.log(`TENANT_ID=${tenant.id}`);
console.log(`login: ${email}  (troque a senha depois no painel)`);
console.log('Ajuste o texto de venda em Configurações → Negócio.');
