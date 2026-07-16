import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variavel de ambiente obrigatoria ausente: ${name}. ` +
        `Copie .env.example para .env e preencha os valores.`
    );
  }
  return value;
}

// Modo gateway: este atendente não fala com a Meta — envia/recebe pelo WORKER
// do Robo Comercial (dono do chip). Nesse modo as credenciais Meta deixam de
// ser obrigatórias no boot.
const gatewayEnabled = String(process.env.GATEWAY_MODE || '').trim() === '1';
function requiredUnlessGateway(name) {
  return gatewayEnabled ? (process.env[name] || '') : required(name);
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  appUrl: process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://zapien.app' : `http://localhost:${process.env.PORT || 3000}`),

  anthropic: {
    apiKey: required('ANTHROPIC_API_KEY'),
    // Padrao: Claude Haiku 4.5 — o modelo mais rapido e economico, ideal para
    // atendimento de vendas em alto volume. Troque por claude-sonnet-4-6 se
    // quiser respostas mais elaboradas.
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
  },

  whatsapp: {
    verifyToken: requiredUnlessGateway('WHATSAPP_VERIFY_TOKEN'),
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    // Número servidor da plataforma (um único número atende todos os tenants)
    phoneNumberId: process.env.WA_PHONE_NUMBER_ID || '',
    token: process.env.WA_TOKEN || '',
  },

  // Modo gateway (Robo Comercial): em vez da Meta, o atendente envia pelo WORKER
  // (POST /send) e recebe respostas em POST /inbound. É o que faz "qualquer
  // palavra ativar o robô" num número dedicado, sem código de tenant.
  gateway: {
    enabled: gatewayEnabled,
    // URL do worker do Robo Comercial (que é dono do chip).
    workerUrl: (process.env.WORKER_URL || '').replace(/\/$/, ''),
    // Token do worker (header x-worker-token ao chamar /send).
    workerToken: process.env.WORKER_API_TOKEN || '',
    // Tenant fixo que vende Zapien. Vazio = usa o único tenant existente.
    tenantId: process.env.ATTENDANT_TENANT_ID || '',
    // Segredo que valida o inbound vindo do worker (header x-worker-token).
    inboundToken: process.env.ATTENDANT_TOKEN || '',
  },

  sessionSecret: process.env.NODE_ENV === 'production'
    ? required('SESSION_SECRET')
    : (process.env.SESSION_SECRET || 'dev-only-insecure-secret'),
  databasePath: process.env.DATABASE_PATH || './data/zapien.db',

  // Escala: quantas respostas de IA processar em paralelo (protege o limite
  // de requisicoes da Anthropic) e quanto esperar para juntar mensagens
  // rapidas do mesmo contato (debounce).
  aiConcurrency: Number(process.env.AI_CONCURRENCY) || 5,
  debounceMs: Number(process.env.DEBOUNCE_MS) || 3000,

  // Conta de administrador da plataforma (voce, o dono).
  adminEmail: (process.env.ADMIN_EMAIL || '').toLowerCase().trim(),

  // Número WhatsApp do suporte (formato internacional sem +, ex: 5511999990000).
  // Exibido para clientes que clicam em "Suporte" na tela de configurações.
  // Um único contato oficial: o número dedicado em que a Zapi atende qualquer
  // mensagem. ATTENDANT_PHONE substitui o legado SUPPORT_PHONE.
  supportPhone: (process.env.ATTENDANT_PHONE || process.env.SUPPORT_PHONE || '').replace(/\D/g, ''),

  // Stripe (assinaturas). Se a chave nao for definida, o billing fica
  // desativado e todos os clientes podem usar livremente.
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    priceId: process.env.STRIPE_PRICE_ID || '',
    // Alinhado à promessa da UI/landing ("7 dias grátis, sem cartão").
    trialDays: Number(process.env.TRIAL_DAYS) || 7,
  },

  // Meta Embedded Signup (conectar WhatsApp com 1 clique). Opcional.
  meta: {
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    configId: process.env.META_CONFIG_ID || '',
  },

  // OpenAI (transcricao de audio e organizacao da configuracao por voz). Opcional.
  openaiApiKey: process.env.OPENAI_API_KEY || '',

  // Google Sheets OAuth — planilha automatica por tenant. Opcional.
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || '',
  },

  // Mercado Pago — token da plataforma Zapien (para cobrar assinaturas dos tenants).
  // Diferente do mp_access_token do tenant (que é para a loja deles).
  mpPlatformToken: process.env.MP_PLATFORM_TOKEN || '',
  mpWebhookSecret: process.env.MP_WEBHOOK_SECRET || '',

  // Mercado Pago OAuth — permite que lojistas conectem sua conta MP com 1 clique.
  // Obtenha em mercadopago.com.br/developers → Suas aplicações → (seu app) → Credenciais.
  mpOAuthAppId: process.env.MP_OAUTH_APP_ID || '',
  mpOAuthAppSecret: process.env.MP_OAUTH_APP_SECRET || '',

  // Melhor Envio — token da plataforma Zapien.
  // Lojistas Elite usam este token automaticamente; não precisam ter conta própria no ME.
  // Obtenha em melhorenvio.com.br → Configurações → Tokens (permissão: shipping.calculate).
  mePlatformToken: process.env.MELHOR_ENVIO_PLATFORM_TOKEN || '',

  // Bling ERP — OAuth2 (conectar conta do lojista com 1 clique, sincroniza
  // produtos/estoque e envia pedidos pagos para emissão de nota fiscal).
  // Obtenha em bling.com.br → Aplicativos → (seu app) → Client ID/Secret.
  blingOAuthAppId: process.env.BLING_OAUTH_CLIENT_ID || '',
  blingOAuthAppSecret: process.env.BLING_OAUTH_CLIENT_SECRET || '',

  // Nuvemshop (Tiendanube) — OAuth2 (conectar loja com 1 clique, sincroniza
  // produtos/estoque). Obtenha em nuvemshop.com.br/developers → seu app.
  nuvemshopOAuthAppId: process.env.NUVEMSHOP_CLIENT_ID || '',
  nuvemshopOAuthAppSecret: process.env.NUVEMSHOP_CLIENT_SECRET || '',

  // Tray — OAuth2 (conectar loja com 1 clique, sincroniza produtos/estoque).
  // Obtenha em dev.tray.com.br → seu app (Consumer Key/Secret).
  trayOAuthAppId: process.env.TRAY_CLIENT_ID || '',
  trayOAuthAppSecret: process.env.TRAY_CLIENT_SECRET || '',

  // Limites de chamadas/tokens de IA agora vêm do PLANO do tenant (ver src/plans.js).
  // offTopicMuteMinutes continua global — não é um limite de custo por plano.
  ai: {
    offTopicMuteMinutes: Number(process.env.AI_OFF_TOPIC_MUTE_MINUTES) || 30,
  },
};

export const billingEnabled = Boolean(config.stripe.secretKey && config.stripe.priceId);
export const mpBillingEnabled = Boolean(config.mpPlatformToken);
export const mpOAuthEnabled = Boolean(config.mpOAuthAppId && config.mpOAuthAppSecret);
export const mePlatformEnabled = Boolean(config.mePlatformToken);
export const googleSheetsEnabled = Boolean(config.google.clientId && config.google.clientSecret);
export const blingOAuthEnabled = Boolean(config.blingOAuthAppId && config.blingOAuthAppSecret);
export const nuvemshopOAuthEnabled = Boolean(config.nuvemshopOAuthAppId && config.nuvemshopOAuthAppSecret);
export const trayOAuthEnabled = Boolean(config.trayOAuthAppId && config.trayOAuthAppSecret);
export const embeddedSignupEnabled = Boolean(
  config.meta.appId && config.meta.appSecret && config.meta.configId
);
export const audioTranscriptionEnabled = Boolean(config.openaiApiKey);

// As etapas do funil de atendimento, usadas em todo o sistema.
export const STAGES = [
  { id: 'novo_contato', label: 'Contato inicial', color: '#94a3b8' },
  { id: 'duvida', label: 'Tirando dúvidas', color: '#38bdf8' },
  { id: 'orcamento', label: 'Orçamento', color: '#a78bfa' },
  { id: 'negociacao', label: 'Negociação', color: '#fbbf24' },
  { id: 'checkout', label: 'No checkout', color: '#fb923c' },
  { id: 'fechado', label: 'Venda fechada', color: '#22c55e' },
  { id: 'perdido', label: 'Perdido', color: '#ef4444' },
];

export const STAGE_IDS = STAGES.map((s) => s.id);
