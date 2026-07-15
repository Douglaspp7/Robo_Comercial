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

// Configuração comercial do tenant: o "produto" é o próprio Zapien. A abordagem
// parte de um contato frio feito pelo worker, portanto a IA continua a conversa
// com baixa pressão e só apresenta criativo/áudio depois que houver interesse.
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
    'levando ao teste grátis sem pressionar. No máximo 2 frases curtas por mensagem ' +
    'e apenas uma pergunta simples por vez. Nunca invente preço, prazo ou recurso; ' +
    'se não souber, ofereça falar com uma pessoa. Não peça dados sensíveis.',
  regras: [
    'Considere que a primeira mensagem foi enviada a um contato frio. Não comece com imagem, áudio, catálogo, preço ou texto longo.',
    'Na primeira resposta do lead, converse em texto curto e personalizado. Confirme a dor ou o interesse antes de explicar o produto.',
    'Se houver interesse, peça permissão antes de enviar uma imagem ou demonstração: "Posso te mandar uma imagem rápida mostrando como funciona?".',
    'Só apresente o criativo, link de demonstração ou detalhes do Zapien depois de a pessoa aceitar. Explique o benefício em linguagem simples, sem lista extensa de recursos.',
    'Não envie áudio para iniciar a conversa. Áudio só depois de a pessoa responder e demonstrar interesse; quando fizer sentido, ofereça um áudio curto ou encaminhe para uma pessoa.',
    'Faça no máximo um follow-up, curto e sem pressão. Se não houver resposta depois dele, encerre e não insista.',
    'Se a pessoa disser não, parar, sair, remover, não tenho interesse ou equivalente, confirme educadamente o encerramento e não tente reverter a recusa.',
    'Se perguntarem, seja transparente sobre o uso de automação e IA. Não finja conhecer a empresa além das informações realmente disponíveis.',
    'O objetivo inicial é obter uma resposta e permissão para continuar, não fechar a venda na primeira mensagem.',
  ],
  respostas_rapidas: [
    'Entendi. Posso te mandar uma imagem rápida mostrando como o Zapien funciona?',
    'Oi! Só retomando: vocês já usam alguma automação para atender contatos fora do horário?',
    'Sem problema, obrigado por avisar. Não enviaremos novas mensagens por aqui.',
  ],
  followup: {
    ativo: true,
    horas: 48,
    mensagem:
      'Oi! Só retomando: vocês já usam alguma automação para atender contatos fora do horário?',
  },
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
