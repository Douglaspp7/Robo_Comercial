/**
 * Fonte única de verdade dos limites por plano — protege custo de IA
 * (Anthropic), transcrição (OpenAI), envio (Meta/WhatsApp) e armazenamento.
 *
 * Regra de negócio: o app NÃO é vendido como ilimitado. Ao atingir 100% de
 * qualquer limite, o recurso é bloqueado (nunca cobrança automática de
 * excedente) — o lojista precisa fazer upgrade para continuar.
 */

export const PLAN_IDS = ['essencial', 'pro', 'elite', 'especial'];
export const PLAN_ORDER = { essencial: 1, pro: 2, elite: 3, especial: 4 };

export function planAtLeast(plan, required) {
  return (PLAN_ORDER[plan] || 1) >= (PLAN_ORDER[required] || 1);
}

/**
 * Limites por plano. Todos os nomes espelham as variáveis técnicas do
 * planejamento de negócio (AI_MAX_CALLS_PER_TENANT_MONTH etc.) em camelCase.
 */
export const PLAN_LIMITS = {
  essencial: {
    label: 'Essencial',
    price: 97.0,
    aiCallsMonth: 1000,
    aiCallsDay: 40,
    aiCallsContactDay: 10,
    aiCallsContact10Min: 4,
    aiMaxOutputTokens: 350,
    storageLimitMb: 50,
    catalogPdfMb: 5,
    catalogPdfPages: 25,
    productImageMb: 2,        // referência (produto usa URL externa; não consome storage do Zapien)
    maxProdutos: 30,
    extraDocsMax: 0,
    extraDocMb: 5,
    extraDocPages: 25,
    knowledgePagesTotal: 25,
    knowledgeChunksTotal: 100,
    automationMaxActive: 2,
    catalogProductExtractionBatches: 4,
    mediaRetentionDays: 7,
    audioTranscriptionEnabled: false,
    audioMinutesMonth: 0,
    melhorEnvio: false,
    blingEnabled: false,
    nuvemshopEnabled: false,
    trayEnabled: false,
    hotmartEnabled: false,
    marketingLinksMax: 3,
    attributionRetentionDays: 30,
    metaCapiEnabled: false,
  },
  pro: {
    label: 'Pro',
    price: 149.0,
    aiCallsMonth: 2000,
    aiCallsDay: 80,
    aiCallsContactDay: 15,
    aiCallsContact10Min: 5,
    aiMaxOutputTokens: 350,
    storageLimitMb: 150,
    catalogPdfMb: 5,
    catalogPdfPages: 25,
    productImageMb: 3,
    maxProdutos: 100,
    extraDocsMax: 5,
    extraDocMb: 5,
    extraDocPages: 25,
    knowledgePagesTotal: 50,
    knowledgeChunksTotal: 200,
    automationMaxActive: 10,
    catalogProductExtractionBatches: 8,
    mediaRetentionDays: 15,
    audioTranscriptionEnabled: true,
    audioMinutesMonth: 200,
    melhorEnvio: false,
    blingEnabled: false,
    nuvemshopEnabled: false,
    trayEnabled: false,
    hotmartEnabled: false,
    marketingLinksMax: 20,
    attributionRetentionDays: 90,
    metaCapiEnabled: true,
  },
  elite: {
    label: 'Elite',
    price: 297.0,
    aiCallsMonth: 5000,
    aiCallsDay: 180,
    aiCallsContactDay: 20,
    aiCallsContact10Min: 6,
    aiMaxOutputTokens: 450,
    storageLimitMb: 500,
    catalogPdfMb: 5,
    catalogPdfPages: 25,
    productImageMb: 5,
    maxProdutos: 300,
    extraDocsMax: 20,
    extraDocMb: 5,
    extraDocPages: 25,
    knowledgePagesTotal: 100,
    knowledgeChunksTotal: 400,
    automationMaxActive: 30,
    catalogProductExtractionBatches: 16,
    mediaRetentionDays: 30,
    audioTranscriptionEnabled: true,
    audioMinutesMonth: 1000,
    melhorEnvio: true,
    blingEnabled: true,
    nuvemshopEnabled: true,
    trayEnabled: true,
    hotmartEnabled: true,
    marketingLinksMax: 100,
    attributionRetentionDays: 180,
    metaCapiEnabled: true,
  },
  especial: {
    label: 'Especial',
    price: 497.0, // "a partir de" — condições sob consulta, plano de contato
    contactOnly: true, // assinatura não é self-service via MP; fluxo é contato comercial
    aiCallsMonth: 10000,
    aiCallsDay: 350,
    aiCallsContactDay: 25,
    aiCallsContact10Min: 8,
    aiMaxOutputTokens: 500,
    storageLimitMb: 1024,
    catalogPdfMb: 5,
    catalogPdfPages: 25,
    productImageMb: 8,
    maxProdutos: 1000,
    extraDocsMax: 50,
    extraDocMb: 5,
    extraDocPages: 25,
    knowledgePagesTotal: 150,
    knowledgeChunksTotal: 600,
    automationMaxActive: 100,
    catalogProductExtractionBatches: 24,
    mediaRetentionDays: 60,
    audioTranscriptionEnabled: true,
    audioMinutesMonth: 5000, // "personalizado" — teto generoso padrão até renegociação manual
    melhorEnvio: true,
    blingEnabled: true,
    nuvemshopEnabled: true,
    trayEnabled: true,
    hotmartEnabled: true,
    prioritySupport: true,
    marketingLinksMax: 1000,
    attributionRetentionDays: 365,
    metaCapiEnabled: true,
  },
};

/**
 * Períodos de cobrança self-service (Mercado Pago Preapproval) — desconto
 * aplicado sobre o total do período (preço mensal × meses), nunca sobre o
 * preço mensal exibido isoladamente. Fonte única do desconto: mudar aqui
 * nunca em outro arquivo.
 */
export const BILLING_PERIODS = {
  mensal: { label: 'Mensal', months: 1, discount: 0 },
  semestral: { label: 'Semestral', months: 6, discount: 0.10 },
  anual: { label: 'Anual', months: 12, discount: 0.20 },
};
export const BILLING_PERIOD_IDS = Object.keys(BILLING_PERIODS);

/**
 * Calcula o valor total cobrado num ciclo de cobrança (já com desconto do
 * período) e o equivalente mensal (pra exibir "R$ X/mês" mesmo quando cobrado
 * de uma vez a cada 6/12 meses).
 * @param {number} monthlyPrice preço mensal cheio do plano (plans.js PLAN_LIMITS[id].price)
 * @param {string} periodId chave de BILLING_PERIODS
 */
export function getPeriodPricing(monthlyPrice, periodId) {
  const period = BILLING_PERIODS[periodId] || BILLING_PERIODS.mensal;
  const totalCheio = monthlyPrice * period.months;
  const totalComDesconto = Math.round(totalCheio * (1 - period.discount) * 100) / 100;
  const equivalenteMensal = Math.round((totalComDesconto / period.months) * 100) / 100;
  return {
    months: period.months,
    discount: period.discount,
    totalCheio,
    total: totalComDesconto,
    equivalenteMensal,
  };
}

/**
 * Resolve o plano efetivo de um tenant para fins de limite. Durante o trial
 * (7 dias grátis), o lojista tem acesso completo equivalente ao Elite — o
 * plano "especial" é sob consulta e nunca é o efetivo automático do trial.
 * @param {string} plan
 * @param {string} subStatus  'trial' | 'ativo' | ...
 */
export function effectivePlanId(plan, subStatus) {
  if (subStatus === 'trial') return 'elite';
  return PLAN_LIMITS[plan] ? plan : 'essencial';
}

/** @returns {object} limites efetivos (nunca null/undefined). */
export function getPlanLimits(plan, subStatus) {
  return PLAN_LIMITS[effectivePlanId(plan, subStatus)];
}

/** Tipos de arquivo permitidos por categoria (defesa contra upload malicioso). */
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const ALLOWED_DOCUMENT_MIME = ['application/pdf'];

/**
 * Classifica um percentual de uso em status para UI/alertas.
 * @param {number} used
 * @param {number} limit
 * @returns {{percent:number, status:'ok'|'warning'|'critical'|'blocked'}}
 */
export function usageStatus(used, limit) {
  if (!limit || limit <= 0) return { percent: 0, status: 'ok' };
  const ratio = used / limit;
  // Status decidido pela razão CRUA, nunca pelo percentual arredondado — 999/1000
  // (99.9%) não pode virar "blocked" só porque Math.round arredonda para 100.
  let status = 'ok';
  if (ratio >= 1) status = 'blocked';
  else if (ratio >= 0.8) status = 'critical';
  else if (ratio >= 0.7) status = 'warning';
  // Percentual de exibição: só mostra 100% quando REALMENTE atingiu/passou o
  // limite — evita a barra mostrar "100% usado" enquanto ainda está liberado.
  const percent = ratio >= 1 ? 100 : Math.min(99, Math.floor(ratio * 100));
  return { percent, status };
}
