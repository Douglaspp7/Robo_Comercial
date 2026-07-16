import { Router } from 'express';
import { ZAPIEN_BUSINESS } from './seeds/zapien-business.js';
import { randomBytes, randomUUID, createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { z } from 'zod';
import { join, dirname } from 'node:path';
import { upload, uploadGuard, requireMagicBytes, readUploadBuffer } from './upload.js';
import { storage } from './storage.js';
import {
  config,
  STAGES,
  STAGE_IDS,
  billingEnabled,
  mpBillingEnabled,
  mpOAuthEnabled,
  mePlatformEnabled,
  audioTranscriptionEnabled,
  blingOAuthEnabled,
  googleSheetsEnabled,
  nuvemshopOAuthEnabled,
  trayOAuthEnabled,
} from './config.js';
import {
  db,
  tenantQueries,
  contactQueries,
  messageQueries,
  saleQueries,
  bookingServiceQueries,
  appointmentQueries,
  bookingBlockQueries,
  noteQueries,
  catalogFileQueries,
  sessionQueries,
  mediaQueries,
  slugify,
  generateUniqueSlug,
  isValidAttendanceCode,
  subscriptionState,
  decryptTenant,
  extraDocumentQueries,
  contactTagQueries,
  decryptContactDocument,
  freteCalculoQueries,
  productWaitlistQueries,
  blingProductMapQueries,
  notificationQueries,
  logAudit,
  auditLogQueries,
  webhookLogQueries,
  pushSubscriptionQueries,
  automationQueries,
  automationRunQueries,
  campaignQueries,
  conversionEventQueries,
  marketingLinkQueries,
  attributionClickQueries,
  contactAttributionQueries,
  marketingConversionQueries,
  conversionJobQueries,
  outboundJobQueries,
  outboundJobItemQueries,
  saveBusinessJson,
  knowledgeDocumentQueries,
  knowledgeChunkQueries,
  knowledgeProductQueries,
  knowledgeJobQueries,
  userQueries,
  teamQueries,
  teamUserQueries,
  userInvitationQueries,
} from './db.js';
import { createOutboundJob } from './outbound-queue.js';
import { newProductId } from './products.js';
import { clampLimit, decodeCursor, paginate } from './pagination.js';
import { googleOAuthUrl, verifyGoogleOAuthState, connectGoogleSheets, googleSheetsStatus, syncGoogleSheets, disconnectGoogleSheets } from './google-sheets.js';
import { googleCalendarEnabled, googleCalendarOAuthUrl, verifyGoogleCalendarState, connectGoogleCalendar, googleCalendarStatus, syncGoogleCalendar, createGoogleCalendarEvent, cancelGoogleCalendarEvent, disconnectGoogleCalendar } from './google-calendar.js';
import { getRepurchaseSuggestions } from './repurchase.js';
import { getDemandSignals } from './demand-signals.js';
import { getRevenueRadar } from './opportunities.js';
import { restoreStockForSale } from './stock.js';
import { createBookingFeeLink } from './mercadopago.js';
import {
  getBookingSettings,
  saveBookingSettings,
  getAvailableBookingSlots,
  validateBookingSlot,
  formatBookingDateTime,
} from './booking-availability.js';
import { getDigitalDeliveryItems } from './digital-delivery.js';
import {
  createTenant,
  login,
  logout,
  hashPassword,
  comparePassword,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  isAdminTenant,
  optionalTenant,
  createPasswordResetToken,
  consumePasswordResetToken,
  createEmailVerificationToken,
  consumeEmailVerificationToken,
  requireRole,
  googleLoginEnabled,
  googleLoginUrl,
  exchangeGoogleCode,
  getGoogleUserInfo,
  loginOrCreateWithGoogle,
} from './auth.js';
import {
  createCheckoutSession,
  createPortalSession,
} from './billing.js';
import { parseCatalogImage, generateBusinessConfig, generateReply, analyzeBusinessSetup, calculateSetupReadiness } from './ai.js';
import { normalizeBusiness } from './business.js';
import { assertPublicUrl } from './ssrf.js';
import { signedQuery, verifySignedQuery } from './urlsign.js';
import { buildWhatsAppEntryMessage } from './entry.js';
import { calcularFrete, generateLabel as generateMeLabel, tokenCapabilities as meTokenCapabilities, ME_REQUIRED_SCOPES_LABEL } from './melhorenvio.js';
import { sendText, sendImage, sendDocument, sendVideo, sendContact } from './whatsapp.js';
import { exchangeBlingCode, saveBlingTokens, pushOrderToBling, fetchAllBlingProdutos, fetchBlingEstoques } from './bling.js';
import { hotmartTokenMatches, parseHotmartEvent } from './hotmart.js';
import { exchangeNuvemshopCode } from './nuvemshop.js';
import { exchangeTrayCode } from './tray.js';
import { dispatchWebhookEvent } from './webhook-dispatch.js';
import { listPrinters as listPrintNodePrinters, printComanda } from './printnode.js';

import { loginLimiter, signupLimiter, importLimiter, sandboxLimiter, passwordResetLimiter, eventsLimiter, metaHealthLimiter } from './limiters.js';
import { buildSimulationResponse, sanitizeSimulationMessages } from './ai-simulation.js';
import { normalizeAlertPhone } from './alert-preferences.js';
import { checkTenantMetaHealth, getTenantMetaHealthView } from './meta-health.js';
import {
  webPushEnabled, getVapidPublicKey, getPushPreferences, setPushPreferences,
  saveSubscription, removeSubscription, sendPushEvent,
} from './push.js';
import { emitDomainEvent, cancelPendingJobsForSale } from './domain-events.js';
import { validateAutomation, TRIGGER_TYPES, CONDITION_TYPES, ACTION_TYPES } from './automations/schema.js';
import { dryRunAutomation } from './automations/engine.js';
import { AUTOMATION_PRESETS } from './automations/presets.js';
import { sendPasswordResetEmail, sendEmailVerificationEmail, maskEmail, sendInvitationEmail } from './email.js';
import { sendAlert } from './alerts.js';
import { generateCsrfToken, requireCsrf } from './csrf.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import {
  validateDocument, maskDocument, formatDocument, hashDocument, lookupCnpj,
} from './cpf-cnpj.js';
import { applyTipoClienteTag, applyStageTag } from './auto-tags.js';
import { suggestNextAction } from './next-action.js';
import { NICHE_TEMPLATES, NICHE_IDS } from './niche-templates.js';
import { signupSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, validate } from './validators.js';
import { planAtLeast, getPlanLimits, effectivePlanId, ALLOWED_IMAGE_MIME, ALLOWED_DOCUMENT_MIME, PLAN_IDS, PLAN_LIMITS, BILLING_PERIODS, BILLING_PERIOD_IDS, getPeriodPricing } from './plans.js';
import { hasStorageRoom, STORAGE_LIMIT_MESSAGE, getTenantUsage } from './usage.js';
import { processSettingsVoiceIntake } from './voice-intake.js';
import { sha256Buffer } from './knowledge/text.js';
import { enqueueKnowledgeJob } from './knowledge/worker.js';
import { sendTestEvent, clearTenantCache } from './meta-capi.js';

// Upload centralizado em disco temporário (src/upload.js) — nada de
// memoryStorage: o arquivo só vira Buffer (readUploadBuffer) DEPOIS das
// validações de tipo/plano, e o temporário é limpo ao fim da resposta.

// Rejeita o upload se exceder o limite (MB) do plano do tenant autenticado
// para aquele tipo de arquivo. Deve rodar DEPOIS do multer (precisa de req.file)
// e depois de requireAuth (precisa de req.tenant).
function enforcePlanFileSize(limitKey) {
  return (req, res, next) => {
    if (!req.file) return next();
    const limits = getPlanLimits(req.tenant.plan, subscriptionState(req.tenant).status);
    const maxBytes = (limits[limitKey] || 0) * 1024 * 1024;
    if (req.file.size > maxBytes) {
      return res.status(413).json({
        error: `Arquivo muito grande para o plano ${limits.label} (máximo ${limits[limitKey]}MB). Faça upgrade para enviar arquivos maiores.`,
      });
    }
    next();
  };
}

function planLimitMessage(limits, sourceType) {
  if (sourceType === 'catalog') {
    return `Catalogo: ate ${limits.catalogPdfMb} MB e ${limits.catalogPdfPages} paginas.`;
  }
  return `Documento extra: ate ${limits.extraDocMb} MB e ${limits.extraDocPages} paginas.`;
}

function createKnowledgeDocumentFromUpload({ tenantId, sourceType, sourceId, file, buffer, active = 0 }) {
  const id = randomUUID();
  const sha256 = sha256Buffer(buffer);
  const duplicate = db.prepare(`
    SELECT id, status
    FROM knowledge_documents
    WHERE tenant_id = ?
      AND sha256 = ?
      AND status NOT IN ('failed', 'rejected_limit', 'disabled')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(tenantId, sha256);
  if (duplicate) return { duplicate: true, documentId: duplicate.id, status: duplicate.status };

  knowledgeDocumentQueries.insert.run({
    id,
    tenant_id: tenantId,
    source_type: sourceType,
    source_id: sourceId || null,
    filename: file.originalname || (sourceType === 'catalog' ? 'catalogo.pdf' : 'documento.pdf'),
    mime_type: file.mimetype || 'application/pdf',
    size_bytes: file.size,
    sha256,
    status: 'uploaded',
    active,
    progress_percent: 0,
  });
  const queued = enqueueKnowledgeJob({ tenantId, documentId: id, type: 'extract_text' });
  if (!queued.ok) {
    knowledgeDocumentQueries.markFailed.run({
      id,
      status: 'failed',
      active: 0,
      progress_percent: 100,
      error_code: queued.reason,
      error_message: 'Ha muitos documentos deste negocio em processamento. Tente novamente em instantes.',
    });
    return { queued: false, reason: queued.reason, documentId: id };
  }
  return { duplicate: false, queued: true, documentId: id, status: 'queued' };
}

function deleteKnowledgeDocumentRows(rows) {
  for (const row of rows) {
    knowledgeJobQueries.cancelPendingForDocument.run(row.id);
    knowledgeChunkQueries.deleteByDocument.run(row.id);
    knowledgeDocumentQueries.delete.run(row.id, row.tenant_id);
  }
}

const BACKUP_DIR = join(dirname(config.databasePath), 'backups');

// --- CSV injection prevention ---
function sanitizeCsvCell(value) {
  const s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

export const apiRouter = Router();

// --- Dados demo Amazônia Aromas (baseados no catálogo oficial da marca) ---
const AMAZONIA_AROMAS_BUSINESS = {
  descricao:
    'Amazônia Aromas é uma marca brasileira especializada em aromatizadores, difusores de ambiente, sabonetes líquidos e produtos de bem-estar olfativo. ' +
    'Alta qualidade com preço acessível. Atendemos todo o Brasil. ' +
    'Contato: @amazoniaaromas | (11) 99126-6405 | atendimento@amazoniaaromas.com.br',
  tomDeVoz:
    'Caloroso, próximo e prestativo. Use emojis com moderação 🌿. Fale como uma amiga que entende de aromas e quer ajudar o cliente a encontrar o produto certo para a casa dele.',
  frete:
    'Entregamos para todo o Brasil via Correios (PAC e SEDEX). ' +
    'Calculamos o frete pelo CEP do cliente. ' +
    'Pagamento em até 3x sem juros no cartão ou com desconto no boleto bancário.',
  peso_padrao_kg: 0.4,
  produtos: [
    {
      nome: 'Difusor Amazônia Aromas 270ml',
      preco: 'R$ 16,90',
      descricao: 'Difusor de varetas que exala aroma suave e persistente por até 30 dias. Ideal para salas, quartos e banheiros.',
      diferenciais: ['Aroma duradouro por até 30 dias', 'Varetas de bambu incluídas', 'Embalagem elegante', '25 fragrâncias disponíveis'],
      variacoes: ['Alecrim', 'Alfazema', 'Baby Azul', 'Baby Rosa', 'Bambu Fresh', 'Broto de Bambu', 'Citronela', 'Cravo e Canela', 'Erva Doce', 'Flor de Cerejeira', 'Flor de Laranjeira', 'Folhas Verdes', 'Frutas Vermelhas', 'Lavanda Francesa', 'Lavanda do Campo', 'Lavanda Inglesa', 'Limão Siciliano', 'Melancia', 'Morango com Champagne', 'Morango Silvestre', 'Orvalho', 'Provence', 'Sementes e Folhas', 'Vanilla', 'Zafira'],
    },
    {
      nome: 'Difusor Amazônia Premium 270ml',
      preco: 'R$ 22,80',
      descricao: 'Linha premium com fragrâncias sofisticadas e embalagem especial. Aroma mais intenso e duradouro. Ótima opção para presentes.',
      diferenciais: ['Fragrâncias exclusivas premium', 'Embalagem sofisticada', 'Aroma mais intenso e duradouro', '10 fragrâncias disponíveis'],
      variacoes: ['Acqua Marine', 'Capim Limão', 'Cereja e Avelã', 'Cravo e Canela', 'Lavanda do Campo', 'Lavanda Francesa', 'Morango Silvestre', 'Orvalho', 'Sementes de Girassol', 'Vanilla'],
    },
    {
      nome: 'Difusor Aromas Brasil 250ml',
      preco: 'R$ 16,90',
      descricao: 'Linha com fragrâncias inspiradas nos aromas do Brasil. Mesma qualidade do difusor clássico, com aromas tropicais exclusivos.',
      diferenciais: ['Fragrâncias inspiradas no Brasil', 'Aroma tropical e refrescante', 'Varetas de bambu incluídas', '12 fragrâncias disponíveis'],
      variacoes: ['Brisa', 'Coco e Baunilha', 'Erva Doce', 'Flores de Pitanga', 'Frutas Vermelhas', 'Lavanda do Campo', 'Melancia', 'Morango Silvestre', 'Orquídea', 'Sementes de Girassol', 'Ternury', 'Vanila'],
    },
    {
      nome: 'Blister Amazônia Aromas 120ml',
      preco: 'sob consulta',
      descricao: 'Difusor compacto de 120ml em embalagem blister. Ideal para ambientes menores como banheiros, quartos de hóspedes e escritórios.',
      diferenciais: ['Tamanho compacto', 'Embalagem blister', '12 fragrâncias disponíveis'],
      variacoes: ['Baby Azul', 'Baby Rosa', 'Capim Limão', 'Chá de Flores', 'Cravo e Canela', 'Flor de Cerejeira', 'Lavanda Inglesa', 'Limão Siciliano', 'Morango Silvestre', 'Oceano', 'Vanila', 'Verbena'],
    },
    {
      nome: 'Sabonete Líquido Amazônia Aromas 500ml (com refil)',
      preco: 'sob consulta',
      descricao: 'Sabonete líquido premium com fragrâncias exclusivas. Acompanha refil para uso sustentável e econômico.',
      diferenciais: ['Inclui refil', 'Fórmula suave para as mãos', 'Aroma prolongado', '10 fragrâncias disponíveis'],
      variacoes: ['Algodão', 'Ameixa Negra', 'Cereja e Avelã', 'Erva Doce', 'Lavanda', 'Maracujá', 'Melancia', 'Morango', 'Orquídea e Pêssego', 'Romã e Maçã'],
    },
    {
      nome: 'Sabonete Líquido Amazônia Aromas 1L',
      preco: 'sob consulta',
      descricao: 'Sabonete líquido em galão de 1 litro. Ideal para reabastecimento e uso intenso.',
      diferenciais: ['Maior rendimento', 'Fórmula suave', 'Econômico'],
      variacoes: ['Algodão', 'Ameixa Negra', 'Cereja e Avelã', 'Erva Doce', 'Lavanda', 'Maracujá', 'Melancia', 'Morango', 'Orquídea e Pêssego', 'Romã e Maçã'],
    },
    {
      nome: 'Odorizador de Tecidos 500ml',
      preco: 'R$ 15,99',
      descricao: 'Odorizador específico para tecidos. Perfuma roupas, sofás, estofados e cortinas, eliminando odores e deixando um aroma fresco e duradouro.',
      diferenciais: ['Específico para tecidos', 'Não mancha', 'Elimina odores', 'Frasco com 500ml', '9 fragrâncias disponíveis'],
      variacoes: ['Alecrim', 'Baby', 'Bambu', 'Clean', 'Flor de Cerejeira', 'Flor de Laranjeira', 'Lavanda Inglesa', 'Limão Siciliano', 'Oceano'],
    },
    {
      nome: 'Perfume de Ambientes 200ml',
      preco: 'sob consulta',
      descricao: 'Spray de ambiente com fragrâncias sofisticadas. Perfuma rapidamente qualquer cômodo com aroma elegante e duradouro.',
      diferenciais: ['Fragrâncias sofisticadas', 'Ação rápida', '15 fragrâncias disponíveis'],
      variacoes: ['Acqua Marine', 'Baby Azul', 'Baby Rosa', 'Capim Limão', 'Cereja e Avelã', 'Cravo e Canela', 'Flor de Cerejeira', 'Lavanda Francesa', 'Lavanda Inglesa', 'Limão Siciliano', 'Morango Silvestre', 'Oceano', 'Orvalho', 'Sementes de Girassol', 'Vanilla'],
    },
    {
      nome: 'Aromatizante de Ambiente 300ml',
      preco: 'R$ 9,90',
      descricao: 'Spray de ambiente de ação rápida. Basta um jato para perfumar o ambiente instantaneamente. Ideal para banheiros, quartos e escritórios.',
      diferenciais: ['Ação imediata', 'Frasco 300ml', '16 fragrâncias disponíveis'],
      variacoes: ['24 Horas', 'Baby Azul', 'Baby Rosa', 'Citronela', 'Flor de Cerejeira', 'Floral', 'Glamour', 'Lavanda', 'Lavanda Francesa', 'Limão Siciliano', 'Marine', 'Naturals', 'Oceano', 'Pureza', 'Sedução', 'Talco'],
    },
    {
      nome: 'Sachê Perfumado 25g',
      preco: 'sob consulta',
      descricao: 'Sachê perfumado para armários, gavetas e malas. Deixa as roupas com aroma suave por semanas.',
      diferenciais: ['Perfeito para armários e gavetas', 'Aroma duradouro', '4 fragrâncias disponíveis'],
      variacoes: ['Baby', 'Flor de Cerejeira', 'Lavanda Inglesa', 'Oceano'],
    },
    {
      nome: 'Aromatizante RedCar 3g',
      preco: 'sob consulta',
      descricao: 'Aromatizante para carro em gel compacto de 3g. Mantém o interior do veículo perfumado por semanas.',
      diferenciais: ['Específico para carro', 'Gel de longa duração', '8 fragrâncias disponíveis'],
      variacoes: ['Baby', 'Bambu Fresh', 'Capim Limão', 'Cereja e Avelã', 'Flor de Cerejeira', 'Lavanda Inglesa', 'Limão Siciliano', 'Oceano'],
    },
    {
      nome: 'Perfume RedCar 15ml',
      preco: 'sob consulta',
      descricao: 'Perfume líquido para carro em spray de 15ml. Perfuma instantaneamente o interior do veículo.',
      diferenciais: ['Spray prático para carro', 'Alta concentração', '8 fragrâncias disponíveis'],
      variacoes: ['Baby', 'Bambu Fresh', 'Capim Limão', 'Cereja e Avelã', 'Flor de Cerejeira', 'Lavanda Inglesa', 'Limão Siciliano', 'Oceano'],
    },
  ],
  perguntasFrequentes: [
    { pergunta: 'Quanto tempo dura o difusor de varetas?', resposta: 'O difusor de 270ml dura em média 30 dias, dependendo do ambiente e da quantidade de varetas usadas. Com todas as varetas o aroma é mais intenso e o líquido acaba mais rápido.' },
    { pergunta: 'Os difusores são seguros para crianças e pets?', resposta: 'Sim! Nossas essências são seguras. Para ambientes com bebês ou animais, recomendamos colocar o difusor em local alto e ventilado, longe do alcance deles.' },
    { pergunta: 'Como funciona o pagamento?', resposta: 'Aceitamos cartão de crédito em até 3x sem juros ou boleto bancário com desconto. O link de pagamento é enviado pelo WhatsApp após a confirmação do pedido.' },
    { pergunta: 'Qual o prazo de entrega?', resposta: 'Entregamos via Correios para todo o Brasil. O prazo varia por região: PAC em torno de 7 a 12 dias úteis e SEDEX de 2 a 4 dias úteis após postagem.' },
    { pergunta: 'O odorizador de tecidos mancha a roupa?', resposta: 'Não! Nosso odorizador é formulado especialmente para tecidos e não deixa manchas. Aplique com o tecido a cerca de 30cm de distância.' },
    { pergunta: 'Vocês têm sabonete líquido?', resposta: 'Sim! Temos o Sabonete Líquido Amazônia Aromas em 500ml (com refil) e em galão de 1L, em 10 fragrâncias. Me conta qual você prefere que eu te passo o preço!' },
    { pergunta: 'Vocês têm produto para carro?', resposta: 'Temos sim! A linha RedCar tem o Aromatizante em gel de 3g e o Perfume Spray de 15ml, ambos em 8 fragrâncias. Qual te interessa?' },
  ],
  objecoesComuns: [
    { objecao: 'Está caro', resposta: 'Entendo! Mas nossos difusores custam R$ 16,90 e duram até 30 dias — menos de R$ 0,60 por dia de ambiente perfumado. Vale muito a pena! Qual fragrância te chama mais atenção?' },
    { objecao: 'Não sei se o aroma vai ser bom', resposta: 'Boa dúvida! Me conta o que você gosta: algo mais suave e floral, refrescante como frutas, ou amadeirado? Assim eu indico a opção certinha pra você 🌿' },
    { objecao: 'Tenho medo de não gostar e perder o dinheiro', resposta: 'Nossos produtos têm avaliações muito positivas e fragrâncias equilibradas, nada exagerado. Se preferir, comece com o difusor clássico de R$ 16,90 — é o mais popular e agrada na maioria dos ambientes.' },
    { objecao: 'Demora muito para chegar', resposta: 'Via SEDEX a entrega é em 2 a 4 dias úteis após a postagem. Se quiser mais rápido, é só escolher o SEDEX no momento do pedido!' },
  ],
  regras: [
    'Nunca invente fragrâncias, tamanhos ou preços que não estão no catálogo.',
    'Para produtos com preço "sob consulta", informe que o preço varia e passe o contato para mais detalhes: (11) 99126-6405 ou Instagram @amazoniaaromas. Nunca acione suporte humano só por causa de preço sob consulta.',
    'Se o cliente perguntar por um produto que não temos, indique o mais parecido do catálogo.',
    'Sugira o Difusor Premium quando o cliente mencionar presente ou quer algo mais sofisticado.',
    'Sempre pergunte qual fragrância o cliente prefere antes de fechar o pedido.',
    'O pagamento é em até 3x sem juros no cartão ou boleto com desconto — informe isso quando o cliente perguntar.',
  ],
};

// --- Dados demo Turma do Brinquedo ---
const TURMA_BRINQUEDO_BUSINESS = {
  descricao:
    'A Turma do Brinquedo é uma loja especializada em brinquedos educativos e criativos para crianças de 0 a 12 anos. ' +
    'Fundada em 2018 em Campinas/SP, trabalhamos com marcas como LEGO, Estrela, Grow e Hasbro. ' +
    'Entregamos para todo o Brasil. Contato: @turmado_brinquedo | (19) 3291-4477',
  tomDeVoz:
    'Alegre, carinhoso e especialista em desenvolvimento infantil 🧸. Use emojis de brinquedo com moderação. ' +
    'Fale com os pais de forma acolhedora, ajudando a escolher o presente certo para a idade e o perfil da criança.',
  frete:
    'Frete grátis para compras acima de R$ 200. Abaixo disso, calculamos pelo CEP via Correios (PAC ou SEDEX). ' +
    'PAC: 5 a 10 dias úteis. SEDEX: 1 a 3 dias úteis. Enviamos para todo o Brasil.',
  produtos: [
    {
      nome: 'LEGO Creator 3 em 1 — Jacaré Incrível',
      preco: 'R$ 149,90',
      descricao: 'Monte 3 modelos diferentes: jacaré, peixe-boi e cobra. Desenvolve criatividade e coordenação motora. 178 peças.',
      diferenciais: ['3 construções em 1', 'Desenvolve raciocínio lógico', 'Compatível com todos os sets LEGO', 'A partir de 7 anos'],
      variacoes: [],
    },
    {
      nome: 'Jogo Banco Imobiliário Brasil',
      preco: 'R$ 89,90',
      descricao: 'A versão brasileira do clássico jogo de estratégia financeira. Com cidades do Brasil como propriedades. 2 a 6 jogadores.',
      diferenciais: ['Estimula raciocínio financeiro', 'Versão com cidades brasileiras', 'Para toda a família', 'A partir de 8 anos'],
      variacoes: ['Clássico', 'Edição Viagem (compacto)'],
    },
    {
      nome: 'Boneca Baby Alive Chora de Verdade',
      preco: 'R$ 219,90',
      descricao: 'Boneca interativa que chora lágrimas reais, fala e reage ao cuidado. Acompanha mamadeira, chupeta e fralda.',
      diferenciais: ['Chora lágrimas de verdade', 'Sons e movimentos reais', 'Estimula cuidado e empatia', 'A partir de 3 anos'],
      variacoes: ['Loira', 'Morena', 'Negra'],
    },
    {
      nome: 'Kit Massinha Play-Doh — Cozinha Divertida',
      preco: 'R$ 129,90',
      descricao: 'Kit com 15 potes de massinha colorida + moldes de comida. Estimula criatividade e coordenação motora fina.',
      diferenciais: ['15 cores incluídas', 'Fórmula não-tóxica', 'Fácil de limpar', 'A partir de 3 anos'],
      variacoes: [],
    },
    {
      nome: 'Quebra-Cabeça Grow 500 peças — Panorama Brasil',
      preco: 'R$ 67,90',
      descricao: 'Quebra-cabeça de 500 peças com panorama ilustrado do Brasil. Ótimo para desenvolver concentração e paciência.',
      diferenciais: ['500 peças de qualidade', 'Imagem temática brasileira', 'Peças grossas e encaixe perfeito', 'A partir de 10 anos'],
      variacoes: [],
    },
    {
      nome: 'Carrinho Hot Wheels Coleção Básica',
      preco: 'R$ 19,90',
      descricao: 'Miniaturas diecast colecionáveis na escala 1:64. Ideal para colecionar ou dar de presente.',
      diferenciais: ['Miniaturas oficiais', 'Rodas com rolamento suave', 'Colecionável', 'A partir de 3 anos'],
      variacoes: ['Sortido (modelo surpresa)', 'Exóticos', 'Muscle Cars'],
    },
    {
      nome: 'Pista Hot Wheels Loop Duplo',
      preco: 'R$ 189,90',
      descricao: 'Pista com 2 loopings, lançador de carrinhos e suporte para múltiplas corridas. Acompanha 2 carrinhos exclusivos.',
      diferenciais: ['2 loopings em série', '2 carrinhos incluídos', 'Montagem fácil', 'A partir de 5 anos'],
      variacoes: [],
    },
    {
      nome: 'Kit Ciência Incrível — Vulcão em Erupção',
      preco: 'R$ 79,90',
      descricao: 'Experimentos científicos seguros para crianças. Monte um vulcão e faça a lava subir com química real!',
      diferenciais: ['Desenvolve interesse por ciências', 'Materiais seguros e não-tóxicos', 'Manual com 5 experimentos', 'A partir de 6 anos'],
      variacoes: [],
    },
  ],
  perguntasFrequentes: [
    { pergunta: 'Qual brinquedo indicar para uma criança de 5 anos?', resposta: 'Para 5 anos adoramos indicar Massinha Play-Doh, Hot Wheels com pista ou o Kit Ciência. Tudo estimula criatividade e é muito divertido!' },
    { pergunta: 'Vocês têm brinquedos educativos?', resposta: 'Sim! Jogos de tabuleiro, quebra-cabeças, kits de ciência e LEGO são todos educativos e desenvolvem habilidades importantes.' },
    { pergunta: 'Posso personalizar uma embalagem presente?', resposta: 'Sim! Adicionamos laço e cartão personalizado gratuitamente para compras acima de R$ 100. É só solicitar no pedido.' },
    { pergunta: 'Os produtos têm garantia?', resposta: 'Sim, todos seguem o Código de Defesa do Consumidor. LEGO e Hasbro têm garantia adicional de fábrica de 90 dias.' },
  ],
  objecoesComuns: [
    { objecao: 'Está caro', resposta: 'Pense que um brinquedo de qualidade dura anos e estimula o desenvolvimento. Temos opções a partir de R$ 19,90! Qual a faixa de preço ideal?' },
    { objecao: 'Não sei a idade certa', resposta: 'Me conta a idade da criança e o que ela gosta — eu indico o brinquedo certinho para o desenvolvimento dela.' },
    { objecao: 'Frete demorado', resposta: 'Com SEDEX a entrega é em 1 a 3 dias úteis. Compras acima de R$ 200 têm frete grátis!' },
  ],
  regras: [
    'Sempre pergunte a idade da criança antes de recomendar um brinquedo.',
    'Nunca indique brinquedos com peças pequenas para crianças menores de 3 anos.',
    'Ofereça embalagem presente grátis para pedidos acima de R$ 100.',
    'Não invente modelos ou preços que não estão no catálogo.',
  ],
};

// --- Dados demo Café & Lar Essencial ---
const CAFE_LAR_BUSINESS = {
  descricao:
    'Café & Lar Essencial é uma loja especializada em cafés especiais, acessórios para preparo e decoração de cozinha. ' +
    'Baseada em Belo Horizonte/MG, trabalhamos com grãos selecionados de origem única e os melhores acessórios de barismo. ' +
    'Atendemos todo o Brasil. Instagram: @cafeelaressencial | (31) 98854-2200',
  tomDeVoz:
    'Apaixonado por café, acolhedor e especialista ☕. Use emojis com moderação. ' +
    'Fale como um barista amigo que quer ajudar o cliente a ter a melhor experiência de café em casa.',
  frete:
    'Frete grátis para compras acima de R$ 180. Abaixo disso, calculamos pelo CEP. ' +
    'Todos os cafés são enviados em embalagem hermética para preservar o aroma. ' +
    'PAC: 5 a 8 dias úteis. SEDEX: 2 a 3 dias úteis.',
  produtos: [
    {
      nome: 'Café Especial Cerrado Mineiro — moído ou em grão',
      preco: 'R$ 42,90 (250g)',
      descricao: 'Café de origem única do Cerrado Mineiro. Notas de caramelo, amendoim e chocolate ao leite. Torra média. Score 84 pontos SCA.',
      diferenciais: ['Origem única rastreável', 'Torra artesanal', 'Embalagem com válvula desgaseificadora', 'Moído na hora ou em grão'],
      variacoes: ['Moído fino (espresso)', 'Moído médio (coado/prensa)', 'Grão inteiro'],
    },
    {
      nome: 'Café Especial Chapada Diamantina — Bahia',
      preco: 'R$ 48,90 (250g)',
      descricao: 'Café de altitude da Chapada Diamantina. Notas cítricas de laranja, maçã verde e mel. Torra clara. Score 86 pontos SCA.',
      diferenciais: ['Alta altitude — mais acidez e doçura', 'Processado via natural', 'Ideal para V60 e Aeropress', 'Score SCA 86'],
      variacoes: ['Moído fino', 'Moído médio', 'Moído grosso (french press)', 'Grão inteiro'],
    },
    {
      nome: 'Prensa Francesa Bodum Chambord 1L',
      preco: 'R$ 189,90',
      descricao: 'A prensa francesa mais famosa do mundo. Corpo de vidro borosilicato, estrutura em aço inox. Faz até 8 xícaras.',
      diferenciais: ['Vidro borosilicato resistente', 'Design clássico Bodum', '8 xícaras por preparo', 'Fácil de lavar'],
      variacoes: ['350ml (3 xícaras)', '1L (8 xícaras)'],
    },
    {
      nome: 'Coador V60 Hario Cerâmica',
      preco: 'R$ 129,90',
      descricao: 'O coador preferido dos baristas. Cerâmica mantém a temperatura ideal durante o preparo. Inclui 40 filtros de papel.',
      diferenciais: ['Cerâmica retém calor', 'Filtração lenta e uniforme', '40 filtros incluídos', 'Tamanho 01 (1 a 2 xícaras)'],
      variacoes: ['Branco', 'Preto', 'Vermelho'],
    },
    {
      nome: 'Balança Digital para Café — precisão 0,1g',
      preco: 'R$ 94,90',
      descricao: 'Balança com timer integrado. Fundamental para extrações precisas e consistentes em casa.',
      diferenciais: ['Precisão de 0,1g', 'Timer integrado', 'Display LCD iluminado', 'Bateria recarregável USB'],
      variacoes: [],
    },
    {
      nome: 'Kit Iniciante no Café Especial',
      preco: 'R$ 149,90',
      descricao: 'Kit completo para começar no mundo dos cafés especiais: coador de papel, 2 pacotes de café (250g cada) e guia de preparo.',
      diferenciais: ['Tudo para começar', 'Dois cafés de origens diferentes', 'Guia de preparo incluído', 'Ótima opção de presente'],
      variacoes: ['Com Cerrado + Chapada', 'Com Cerrado + Blend Especial da Casa'],
    },
    {
      nome: 'Moedor Manual Porlex Mini',
      preco: 'R$ 219,90',
      descricao: 'Moedor manual japonês com rebarbas de cerâmica. Moagem uniforme e regulável. Compacto para viagens.',
      diferenciais: ['Rebarbas de cerâmica Kyocera', 'Regulagem de 1 a 15 cliques', 'Compacto — cabe numa mochila', 'Moagem silenciosa'],
      variacoes: [],
    },
    {
      nome: 'Assinatura Mensal de Café Especial',
      preco: 'R$ 79,90/mês',
      descricao: 'Receba todo mês 2 pacotes de 250g de cafés especiais selecionados. Origens diferentes a cada mês. Frete incluso.',
      diferenciais: ['Frete incluso', 'Cafés diferentes todo mês', 'Cancele quando quiser', 'Curadoria exclusiva'],
      variacoes: ['Torra clara (mais ácido e frutado)', 'Torra média (equilibrado)', 'Torra escura (encorpado e amargo)'],
    },
  ],
  perguntasFrequentes: [
    { pergunta: 'Qual café indicar para quem está começando?', resposta: 'Para iniciantes, o Cerrado Mineiro é perfeito — equilibrado, com notas de caramelo e chocolate, agrada a maioria. Ou o Kit Iniciante que já vem com tudo!' },
    { pergunta: 'Qual a diferença entre torra clara e escura?', resposta: 'Torra clara: mais ácido, frutado, delicado — ideal para coado. Torra escura: encorpado, amargo, menos ácido — ideal para espresso. A torra média fica no equilíbrio.' },
    { pergunta: 'Posso pedir o café já moído?', resposta: 'Sim! Informe o método de preparo (espresso, coado, prensa francesa, Aeropress) que moemos na hora do envio para garantir a frescura.' },
    { pergunta: 'Como assino o clube?', resposta: 'É simples! Escolha a torra preferida e eu te passo o link de assinatura. O primeiro envio sai em até 2 dias úteis.' },
  ],
  objecoesComuns: [
    { objecao: 'Café especial é muito caro', resposta: 'R$ 42,90 por 250g dá em torno de 20 a 25 xícaras — menos de R$ 2 por xícara. Muito mais barato que cafeteria e infinitamente melhor que o de supermercado!' },
    { objecao: 'Não tenho equipamento', resposta: 'O Kit Iniciante tem tudo que você precisa por R$ 149,90. Ou posso indicar só um coador simples de papel, que já faz uma diferença enorme!' },
    { objecao: 'Não sei qual escolher', resposta: 'Me conta como você toma café hoje e o que quer experimentar — eu escolho o certo para o seu paladar. Prefere algo mais suave ou mais encorpado?' },
  ],
  regras: [
    'Sempre pergunte o método de preparo do cliente antes de recomendar moagem.',
    'Nunca invente origens, preços ou notas de sabor que não estão no catálogo.',
    'Para assinatura, reforce que pode cancelar quando quiser — elimina a objeção de compromisso.',
    'Ofereça o Kit Iniciante quando o cliente não souber por onde começar.',
  ],
};

// --- Dados demo Bella Napoli Pizzaria ---
const BELLA_NAPOLI_BUSINESS = {
  tipo_negocio: 'pizzaria',
  descricao:
    'Bella Napoli é uma pizzaria artesanal em São Paulo/SP, fundada em 2019. ' +
    'Massa fermentada 48h, molho de tomate San Marzano e ingredientes frescos todos os dias. ' +
    'Delivery e retirada. Instagram: @bellanapoli_sp | (11) 94521-8833',
  tomDeVoz:
    'Simpático, rápido e apaixonado por pizza 🍕. Use emojis com moderação. ' +
    'Trate o cliente como amigo, seja ágil nas respostas e incentive combos e bordas recheadas.',
  delivery: {
    ativo: true,
    taxa_fixa: 6.00,
    raio_km: 8,
    eta_minutos: 45,
    aceita_retirada: true,
    aceita_mesa: false,
  },
  horario_atendimento: {
    ativo: true,
    inicio: '18:00',
    fim: '23:30',
    dias: [0, 2, 3, 4, 5, 6],
    mensagem_fora: '🍕 Oi! Funcionamos terça a domingo, das 18h às 23h30. Deixe sua mensagem e retornaremos na abertura!',
  },
  followup: {
    ativo: true,
    horas: 24,
    mensagem: 'Oi! 🍕 Ainda está interessado na pizza? Temos promoção hoje na borda de catupiry — R$ 8,00 em qualquer tamanho!',
  },
  produtos: [
    {
      nome: 'Mussarela',
      tipo_produto: 'pizza',
      descricao: 'Clássica com molho de tomate San Marzano, mussarela fatiada e manjericão fresco.',
      tamanhos: [
        { nome: 'P (6 fatias)',  preco: '38.90' },
        { nome: 'M (8 fatias)',  preco: '49.90' },
        { nome: 'G (10 fatias)', preco: '59.90' },
        { nome: 'GG (12 fatias)', preco: '72.90' },
      ],
      max_sabores: 2,
      adicionais: 'Borda de catupiry (+R$8), Borda de cheddar (+R$8), Extra mussarela (+R$5)',
    },
    {
      nome: 'Calabresa',
      tipo_produto: 'pizza',
      descricao: 'Calabresa fatiada na hora, cebola roxa, molho de tomate e orégano.',
      tamanhos: [
        { nome: 'P (6 fatias)',  preco: '40.90' },
        { nome: 'M (8 fatias)',  preco: '51.90' },
        { nome: 'G (10 fatias)', preco: '62.90' },
        { nome: 'GG (12 fatias)', preco: '74.90' },
      ],
      max_sabores: 2,
      adicionais: 'Borda de catupiry (+R$8), Borda de cheddar (+R$8), Extra calabresa (+R$6)',
    },
    {
      nome: 'Frango com Catupiry',
      tipo_produto: 'pizza',
      descricao: 'Frango desfiado temperado, catupiry original cremoso e milho verde.',
      tamanhos: [
        { nome: 'P (6 fatias)',  preco: '44.90' },
        { nome: 'M (8 fatias)',  preco: '55.90' },
        { nome: 'G (10 fatias)', preco: '67.90' },
        { nome: 'GG (12 fatias)', preco: '79.90' },
      ],
      max_sabores: 2,
      adicionais: 'Borda de catupiry (+R$8), Extra catupiry (+R$5), Extra frango (+R$6)',
    },
    {
      nome: 'Portuguesa',
      tipo_produto: 'pizza',
      descricao: 'Presunto, ovos, pimentão verde, cebola, azeitona e orégano. A favorita da casa!',
      tamanhos: [
        { nome: 'P (6 fatias)',  preco: '45.90' },
        { nome: 'M (8 fatias)',  preco: '57.90' },
        { nome: 'G (10 fatias)', preco: '69.90' },
        { nome: 'GG (12 fatias)', preco: '82.90' },
      ],
      max_sabores: 2,
      adicionais: 'Borda de catupiry (+R$8), Borda de cheddar (+R$8)',
    },
    {
      nome: 'Quatro Queijos',
      tipo_produto: 'pizza',
      descricao: 'Mussarela, catupiry, parmesão e provolone. Para os amantes de queijo.',
      tamanhos: [
        { nome: 'P (6 fatias)',  preco: '47.90' },
        { nome: 'M (8 fatias)',  preco: '59.90' },
        { nome: 'G (10 fatias)', preco: '72.90' },
        { nome: 'GG (12 fatias)', preco: '86.90' },
      ],
      max_sabores: 2,
      adicionais: 'Borda de catupiry (+R$8), Extra queijo (+R$7)',
    },
    {
      nome: 'Pepperoni',
      tipo_produto: 'pizza',
      descricao: 'Generosa quantidade de pepperoni importado, mussarela e orégano.',
      tamanhos: [
        { nome: 'P (6 fatias)',  preco: '46.90' },
        { nome: 'M (8 fatias)',  preco: '58.90' },
        { nome: 'G (10 fatias)', preco: '71.90' },
        { nome: 'GG (12 fatias)', preco: '84.90' },
      ],
      max_sabores: 2,
      adicionais: 'Borda de catupiry (+R$8), Extra pepperoni (+R$8)',
    },
    {
      nome: 'Frango com Bacon',
      tipo_produto: 'pizza',
      descricao: 'Frango desfiado, bacon crocante, milho e catupiry. Combinação irresistível.',
      tamanhos: [
        { nome: 'P (6 fatias)',  preco: '46.90' },
        { nome: 'M (8 fatias)',  preco: '58.90' },
        { nome: 'G (10 fatias)', preco: '71.90' },
        { nome: 'GG (12 fatias)', preco: '84.90' },
      ],
      max_sabores: 2,
      adicionais: 'Borda de catupiry (+R$8), Extra bacon (+R$7)',
    },
    {
      nome: 'Chocolate com Morango',
      tipo_produto: 'pizza',
      descricao: 'Nutella generosa, morangos frescos fatiados e leite condensado. A pizza doce mais pedida! 🍓',
      tamanhos: [
        { nome: 'P (6 fatias)',  preco: '42.90' },
        { nome: 'M (8 fatias)',  preco: '54.90' },
        { nome: 'G (10 fatias)', preco: '65.90' },
        { nome: 'GG (12 fatias)', preco: '78.90' },
      ],
      max_sabores: 2,
      adicionais: 'Borda de chocolate (+R$8), Extra morango (+R$5), Extra Nutella (+R$6)',
    },
    {
      nome: 'Refrigerante Lata 350ml',
      tipo_produto: 'simples',
      preco: 'R$ 6,00',
      descricao: 'Coca-Cola, Guaraná Antarctica, Fanta Laranja ou Sprite.',
      variacoes: ['Coca-Cola', 'Guaraná Antarctica', 'Fanta Laranja', 'Sprite'],
    },
    {
      nome: 'Refrigerante 2 Litros',
      tipo_produto: 'simples',
      preco: 'R$ 14,00',
      descricao: 'Coca-Cola ou Guaraná Antarctica em garrafa de 2L. Ideal para grupos.',
      variacoes: ['Coca-Cola 2L', 'Guaraná Antarctica 2L'],
    },
    {
      nome: 'Suco Natural 400ml',
      tipo_produto: 'simples',
      preco: 'R$ 11,00',
      descricao: 'Suco natural feito na hora. Laranja, limão ou maracujá.',
      variacoes: ['Laranja', 'Limão', 'Maracujá'],
    },
    {
      nome: 'Água sem gás 500ml',
      tipo_produto: 'simples',
      preco: 'R$ 4,00',
      descricao: 'Água mineral natural.',
    },
    {
      nome: 'Porção de Batata Frita',
      tipo_produto: 'porcao',
      descricao: 'Batatas fritas crocantes. Acompanha ketchup e maionese da casa.',
      tamanhos: [
        { nome: 'Pequena', preco: '18.00' },
        { nome: 'Média',   preco: '26.00' },
        { nome: 'Grande',  preco: '34.00' },
      ],
      adicionais: 'Cheddar (+R$5), Bacon crocante (+R$6), Catupiry (+R$5)',
    },
  ],
  perguntasFrequentes: [
    { pergunta: 'Vocês fazem pizza meia a meia?', resposta: 'Sim! Você pode escolher 2 sabores em qualquer tamanho. O preço será a média dos dois sabores no tamanho escolhido.' },
    { pergunta: 'Qual o tempo de entrega?', resposta: 'Em média 40 a 50 minutos para delivery. Retirada no balcão fica pronta em 25 a 30 minutos.' },
    { pergunta: 'Vocês aceitam retirada no local?', resposta: 'Sim! Retirada no local tem 10% de desconto. É só avisar que vai buscar no momento do pedido.' },
    { pergunta: 'Qual a taxa de entrega?', resposta: 'A taxa de entrega é R$ 6,00 para endereços em até 8km da pizzaria. Acima disso consulte disponibilidade.' },
    { pergunta: 'Como funciona a borda recheada?', resposta: 'A borda recheada é um adicional de R$ 8,00 em qualquer tamanho. Temos catupiry e cheddar (salgadas) e chocolate (para as pizzas doces).' },
    { pergunta: 'Vocês têm pizza doce?', resposta: 'Temos a Chocolate com Morango, que é um sucesso! Nutella, morangos frescos e leite condensado. Quer pedir?' },
    { pergunta: 'Vocês funcionam quais dias?', resposta: 'Funcionamos terça a domingo, das 18h às 23h30. Segunda fechamos para descanso.' },
    { pergunta: 'Aceitam cartão na entrega?', resposta: 'Aceitamos cartão na entrega (crédito e débito) e Pix. Para pagamento no momento do pedido pelo WhatsApp, geramos um link de pagamento Pix ou cartão.' },
  ],
  objecoesComuns: [
    { objecao: 'Está caro', resposta: 'Nossa pizza G tem 10 fatias e alimenta de 3 a 4 pessoas — dá menos de R$ 20 por pessoa com uma pizza artesanal de verdade! Qual tamanho fica melhor pra você?' },
    { objecao: 'Demora muito', resposta: 'Nosso tempo médio de entrega é 40 a 45 minutos. Se quiser mais rápido, a retirada fica pronta em 25 minutos!' },
    { objecao: 'Não sei qual sabor escolher', resposta: 'A Mussarela e a Frango com Catupiry são as mais pedidas 🍕. Prefere algo mais clássico ou quer ousar com uma meia a meia?' },
    { objecao: 'Prefiro outro lugar', resposta: 'Entendo! Mas se quiser experimentar, nossa massa fermentada 48h faz toda a diferença. Que tal começar com uma P para testar? 😊' },
  ],
  regras: [
    'Para pizza meia a meia: o preço é a média dos dois sabores no tamanho escolhido. Arredonde para cima no R$ 0,50 mais próximo se necessário.',
    'Sempre confirme o tamanho desejado antes de gerar o pedido — nunca assuma.',
    'Ofereça a borda recheada na hora de confirmar o pedido — apenas se o cliente não tiver pedido uma.',
    'Para retirada no local: aplicar 10% de desconto no total (sem contar a taxa de entrega).',
    'Nunca invente sabores, preços ou adicionais que não estão no cardápio.',
    'Pizzas doces não combinam com bordas salgadas — ofereça apenas borda de chocolate para a Chocolate com Morango.',
    'Segunda-feira fechado. Nos outros dias, horário das 18h às 23h30.',
  ],
};

// Senha de suporte — SEM default embutido. Se não configurada via env, os
// endpoints de suporte (seed/verify) ficam desabilitados.
const SUPPORT_PASSWORD = process.env.SUPPORT_PASSWORD || '';
const supportEnabled = Boolean(SUPPORT_PASSWORD);

// --- Plano e controle de recursos ---
// Ordem/limites dos planos vêm de src/plans.js (fonte única — inclui o plano
// Especial, que esta função local antes não conhecia).

function getPlanFeatures(plan, subStatus) {
  const limits = getPlanLimits(plan, subStatus);
  const effectivePlan = effectivePlanId(plan, subStatus);
  return {
    maxProdutos:    limits.maxProdutos,
    followUp:       planAtLeast(effectivePlan, 'pro'),
    notas:          planAtLeast(effectivePlan, 'pro'),
    csvExport:      planAtLeast(effectivePlan, 'pro'),
    catalogImport:  planAtLeast(effectivePlan, 'pro'),
    liveRefresh:    planAtLeast(effectivePlan, 'pro'),
    melhorEnvio:    limits.melhorEnvio,
    blingEnabled:   limits.blingEnabled,
    nuvemshopEnabled: limits.nuvemshopEnabled,
    hotmartEnabled: limits.hotmartEnabled,
    campaignsEnabled: planAtLeast(effectivePlan, 'elite'),
    mpBillingEnabled,
  };
}

function requirePlan(required) {
  return (req, res, next) => {
    const rawPlan = req.tenant?.plan || 'essencial';
    // Usa o plano efetivo: durante o trial o lojista tem acesso elite completo.
    const subStatus = subscriptionState(req.tenant).status;
    const plan = effectivePlanId(rawPlan, subStatus);
    if (!planAtLeast(plan, required)) {
      return res.status(403).json({
        error: `Recurso disponível somente no plano ${required.charAt(0).toUpperCase() + required.slice(1)} ou superior.`,
        upgrade_required: required,
      });
    }
    next();
  };
}

// --- Autenticacao ---
apiRouter.post('/api/signup', signupLimiter, (req, res) => {
  let data;
  try {
    data = validate(signupSchema, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const { email, password } = data;
  if (tenantQueries.byEmail.get(email)) {
    return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
  }
  const tenant = createTenant(email, password);
  const rawToken = createEmailVerificationToken(tenant.id);
  const verifyUrl = `${config.appUrl.replace(/\/$/, '')}/api/verify-email?token=${encodeURIComponent(rawToken)}`;
  sendEmailVerificationEmail({ to: email, verifyUrl, expiresInHours: 24 })
    .catch((err) => {
      console.error('[verify-email]', err.message);
      sendAlert('email', `falha ao enviar verificação para ${maskEmail(email)}: ${err.message}`);
    });
  res.status(201).json({
    ok: true,
    verification_required: true,
    message: 'Enviamos um link de confirmação para seu e-mail.',
  });
});

apiRouter.post('/api/login', loginLimiter, (req, res) => {
  let data;
  try {
    data = validate(loginSchema, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const account = tenantQueries.byEmail.get(data.email);
  if (account && !account.email_verified_at) {
    return res.status(403).json({
      error: 'Confirme seu e-mail antes de entrar.',
      verification_required: true,
      email: maskEmail(account.email),
    });
  }
  const token = login(data.email, data.password);
  if (!token) return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  setSessionCookie(res, token);
  // Resolve pelo tenant da sessão: membros de equipe autenticam com o próprio
  // e-mail, que não existe na tabela tenants.
  const session = sessionQueries.byToken.get(token);
  const tenant = session ? tenantQueries.byId.get(session.tenant_id) : null;
  res.json({
    ok: true,
    redirect: tenant?.onboarding_completed_at ? '/dashboard.html' : '/onboarding.html',
  });
});

apiRouter.get('/api/verify-email', (req, res) => {
  const tenant = consumeEmailVerificationToken(req.query?.token);
  if (!tenant) return res.redirect('/login.html?error=verification_invalid');
  // O token único já provou a posse do e-mail; cria a sessão diretamente.
  const sessionToken = randomBytes(32).toString('hex');
  sessionQueries.create.run(sessionToken, tenant.id, null);
  setSessionCookie(res, sessionToken);
  res.redirect('/onboarding.html?email=verified');
});

apiRouter.post('/api/resend-verification', passwordResetLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const tenant = tenantQueries.byEmail.get(email);
  // Resposta neutra evita revelar se uma conta existe.
  const response = { ok: true, message: 'Se a conta existir e estiver pendente, enviaremos um novo link.' };
  if (!tenant || tenant.email_verified_at) return res.json(response);
  const rawToken = createEmailVerificationToken(tenant.id);
  const verifyUrl = `${config.appUrl.replace(/\/$/, '')}/api/verify-email?token=${encodeURIComponent(rawToken)}`;
  try {
    await sendEmailVerificationEmail({ to: tenant.email, verifyUrl, expiresInHours: 24 });
  } catch (err) {
    console.error('[resend-verify-email]', err.message);
    return res.status(503).json({ error: 'Não foi possível enviar agora. Tente novamente em alguns minutos.' });
  }
  res.json(response);
});

// --- Google OAuth Login ---
apiRouter.get('/api/auth/google/available', (_req, res) => {
  res.json({ available: googleLoginEnabled() });
});

apiRouter.get('/api/auth/google/start', (req, res) => {
  if (!googleLoginEnabled()) return res.redirect('/login.html?error=google_unavailable');
  const state = randomBytes(16).toString('hex');
  res.cookie('_g_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(googleLoginUrl(state));
});

apiRouter.get('/api/auth/google/callback', async (req, res) => {
  if (!googleLoginEnabled()) return res.redirect('/login.html?error=google_unavailable');
  const { code, state, error } = req.query;
  const storedState = req.cookies?._g_state;
  res.clearCookie('_g_state');

  if (error || !code || !state || !storedState || state !== storedState) {
    return res.redirect('/login.html?error=google_failed');
  }

  try {
    const tokenData = await exchangeGoogleCode(code);
    const userInfo = await getGoogleUserInfo(tokenData.access_token);

    if (!userInfo.email || !userInfo.email_verified) {
      return res.redirect('/login.html?error=google_email_unverified');
    }

    const token = loginOrCreateWithGoogle(userInfo.sub, userInfo.email, userInfo.name);
    setSessionCookie(res, token);
    const tenant = tenantQueries.byEmail.get(userInfo.email.toLowerCase().trim());
    res.redirect(tenant?.onboarding_completed_at ? '/dashboard.html' : '/onboarding.html');
  } catch (e) {
    console.error('[google-login]', e.message);
    res.redirect('/login.html?error=google_failed');
  }
});

// --- Recuperação de senha ---
// A resposta é a mesma para e-mail existente e inexistente ("se existir, um
// link foi enviado") — sem isso, o endpoint viraria oráculo de contas.
// O envio real é feito por src/email.js (console em dev, Resend em produção)
// e roda em fire-and-forget: a resposta pública sai antes do provedor
// responder, para o tempo de resposta não virar oráculo de contas.
apiRouter.post('/api/forgot-password', passwordResetLimiter, (req, res) => {
  let data;
  try {
    data = validate(forgotPasswordSchema, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const result = createPasswordResetToken(data.email);
  if (result) {
    const link = `${config.appUrl.replace(/\/$/, '')}/login.html#reset=${encodeURIComponent(result.rawToken)}`;
    sendPasswordResetEmail({ to: data.email, resetUrl: link, expiresInMinutes: 60 })
      .catch((err) => {
        // Nunca logar o token/link aqui — só o motivo da falha e o e-mail mascarado.
        console.error(
          `[reset-senha]${err.requestId ? `[${err.requestId}]` : ''} falha ao enviar para ${maskEmail(data.email)}: ${err.message}`
        );
        sendAlert('email', `reset de senha não enviado (${String(err.message).slice(0, 150)})`);
      });
  }

  // Resposta sempre 200 com mesma mensagem — não revela existência do e-mail.
  res.json({ ok: true, message: 'Se o e-mail existir, enviamos um link para redefinir a senha.' });
});

// --- Eventos de conversão (medição first-party da landing/cadastro) ---
// Beacon público, anônimo: só aceita nomes de um allowlist e trunca tudo.
// NUNCA gravar dados pessoais aqui (telefone, e-mail, CPF, conversa, senha).
const ALLOWED_CONVERSION_EVENTS = new Set([
  'landing_view', 'hero_trial_click', 'hero_login_click', 'pricing_plan_click',
  'signup_view', 'signup_started', 'signup_completed', 'login_completed',
  'whatsapp_support_click', 'sources_expanded', 'footer_trial_click', 'web_vitals',
]);

apiRouter.post('/api/events', eventsLimiter, (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').slice(0, 40);
  // Resposta 204 sempre — beacon não é oráculo nem canal de erro.
  if (!ALLOWED_CONVERSION_EVENTS.has(name)) return res.status(204).end();

  const cut = (value, max) => (value == null ? null : String(value).slice(0, max));
  const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
  let propsJson = null;
  if (body.props && typeof body.props === 'object') {
    try { propsJson = JSON.stringify(body.props).slice(0, 500); } catch { /* ignora props inválidas */ }
  }
  try {
    conversionEventQueries.insert.run(
      name, cut(body.sid, 64), cut(body.path, 200), cut(body.referrer, 300),
      cut(utm.utm_source, 120), cut(utm.utm_medium, 120), cut(utm.utm_campaign, 120),
      cut(utm.utm_content, 120), cut(utm.utm_term, 120), propsJson,
    );
  } catch (err) {
    console.error('[events] falha ao gravar evento:', err.message);
  }
  res.status(204).end();
});

apiRouter.post('/api/reset-password', passwordResetLimiter, (req, res) => {
  let data;
  try {
    data = validate(resetPasswordSchema, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const ok = consumePasswordResetToken(data.token, data.password);
  if (!ok) return res.status(400).json({ error: 'Link expirado ou inválido. Peça um novo em "Esqueceu a senha?".' });
  res.json({ ok: true });
});

// --- Link de atendimento permanente /a/:code (formato TX579) ---
// URL permanente por tenant — nunca muda, mesmo que o nome comercial seja alterado.
// A mensagem é construída dinamicamente com o nome comercial atual.

const WA_ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

apiRouter.get('/a/:code/logo', (req, res) => {
  const code = req.params.code.toUpperCase();
  if (!isValidAttendanceCode(code)) return res.status(404).send('Link inválido.');
  const tenant = tenantQueries.byAttendanceCode.get(code);
  if (!tenant || !tenant.active || !tenant.link_logo_content || !tenant.link_logo_mime) {
    return res.status(404).send('Logo não encontrada.');
  }
  res.setHeader('Content-Type', tenant.link_logo_mime);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(tenant.link_logo_content);
});

apiRouter.get('/a/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  if (!isValidAttendanceCode(code)) return res.status(404).send('Link inválido.');
  const serverPhone = (process.env.WA_SERVER_PHONE || '').replace(/\D/g, '');
  if (!serverPhone) return res.status(404).send('Canal não configurado.');
  const tenant = tenantQueries.byAttendanceCode.get(code);
  if (!tenant || !tenant.active) return res.status(404).send('Canal não encontrado.');

  const bizName = (tenant.business_name || 'esta empresa')
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')
    .slice(0, 80);
  const msg = `Olá! Conheci a empresa ${bizName}\ne gostaria de falar com vocês.\n\n🎫 Atendimento ${code}\n\n👉 Toque em Enviar para iniciar.`;
  const waUrl = `https://wa.me/${serverPhone}?text=${encodeURIComponent(msg)}`;
  const logoUrl = tenant.link_logo_content ? `/a/${encodeURIComponent(code)}/logo?v=${encodeURIComponent(tenant.link_logo_updated_at || code)}` : '';
  const safeBizName = escapeHtml(bizName);
  const safeMsg = escapeHtml(msg);
  const logoHtml = logoUrl
    ? `<img class="brand-logo" src="${logoUrl}" alt="${safeBizName}">`
    : `<div class="wa-circle">${WA_ICON_SVG}</div>`;

  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeBizName} — Atendimento WhatsApp</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(160deg,#e0f2fe 0%,#f8fafc 52%,#ecfdf5 100%);min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:28px;padding:34px 24px 28px;max-width:360px;width:100%;text-align:center;box-shadow:0 12px 48px rgba(15,23,42,.10),0 2px 8px rgba(15,23,42,.05)}
.brand-logo{display:block;max-width:148px;max-height:92px;width:auto;height:auto;object-fit:contain;margin:0 auto 20px;border-radius:18px}
.wa-circle{width:76px;height:76px;background:linear-gradient(145deg,#25d366,#128c7e);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;box-shadow:0 6px 20px rgba(37,211,102,.35);color:#fff}
.wa-circle svg{width:42px;height:42px}.pill{display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:999px;padding:5px 14px;font-size:.75rem;color:#15803d;font-weight:700;margin-bottom:18px}.dot{width:7px;height:7px;border-radius:50%;background:#22c55e}
h1{font-size:1.32rem;font-weight:850;color:#111827;line-height:1.28;margin-bottom:8px}.sub{font-size:.9rem;color:#64748b;line-height:1.5;margin-bottom:24px}.sub strong{color:#111827}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,#25d366 0%,#20bd5a 100%);color:#fff;text-decoration:none;font-size:1rem;font-weight:800;padding:17px 22px;border-radius:16px;box-shadow:0 4px 18px rgba(37,211,102,.42);-webkit-tap-highlight-color:transparent}.btn:active{transform:scale(.97)}.btn svg{width:22px;height:22px;flex-shrink:0}
.divider{border:none;border-top:1px solid #f1f5f9;margin:22px 0 18px}.hint{font-size:.82rem;color:#64748b;line-height:1.45}.send-word{display:inline-block;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:1px 7px;font-weight:800;color:#15803d}.msg-preview{margin-top:14px;font-size:.75rem;color:#94a3b8;line-height:1.5}.msg-preview em{font-style:normal;color:#64748b;white-space:pre-line}
</style>
</head>
<body>
<div class="card">
  ${logoHtml}
  <div class="pill"><span class="dot"></span> Atendimento online</div>
  <h1>Bem-vindo a<br>${safeBizName}!</h1>
  <p class="sub">Toque no botão abaixo para conversar pelo WhatsApp agora mesmo.</p>
  <a href="${waUrl}" class="btn">${WA_ICON_SVG}Iniciar conversa</a>
  <div class="divider"></div>
  <div class="hint">Após abrir o WhatsApp, toque em <span class="send-word">Enviar</span> para começar.</div>
  <div class="msg-preview">Mensagem que será enviada:<br><em>${safeMsg}</em></div>
</div>
</body>
</html>`);
});
// --- Rota pública de links de marketing rastreáveis ---
apiRouter.get('/l/:slug', (req, res) => {
  const slug = req.params.slug.trim().toLowerCase();
  const link = marketingLinkQueries.bySlug.get(slug);
  if (!link || !link.active) {
    return res.status(404).send('Link de marketing não encontrado ou inativo.');
  }

  const tenant = tenantQueries.byId.get(link.tenant_id);
  if (!tenant || !tenant.active) {
    return res.status(404).send('Loja associada a este link está inativa.');
  }

  const query = req.query || {};
  const clickId = 'cli_' + randomUUID().replace(/-/g, '').slice(0, 24);
  const anonymousSessionId = req.cookies?.gw_anon_session || randomUUID();

  const limitStr = (str, len = 200) => str ? String(str).slice(0, len) : null;
  const utm_source = limitStr(query.utm_source || link.source || 'direct');
  const utm_medium = limitStr(query.utm_medium || link.medium || 'organic');
  const utm_campaign = limitStr(query.utm_campaign || link.campaign || 'none');
  const utm_content = limitStr(query.utm_content || link.content);
  const utm_term = limitStr(query.utm_term || link.term);
  const fbclid = limitStr(query.fbclid);
  const gclid = limitStr(query.gclid);
  const ttclid = limitStr(query.ttclid);
  const msclkid = limitStr(query.msclkid);
  const referrer = limitStr(req.headers.referer || query.referrer, 500);
  const userAgent = limitStr(req.headers['user-agent'], 200);

  const token = randomBytes(3).toString('hex').toUpperCase();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  attributionClickQueries.insert.run({
    id: clickId,
    tenant_id: tenant.id,
    marketing_link_id: link.id,
    entry_token_hash: tokenHash,
    anonymous_session_id: anonymousSessionId,
    fbclid,
    gclid,
    ttclid,
    msclkid,
    referrer,
    user_agent_summary: userAgent,
    expires_at: expiresAt,
  });

  emitDomainEvent({
    tenantId: tenant.id,
    type: 'marketing_link_clicked',
    entityType: 'contact',
    entityId: null,
    payload: {
      link_id: link.id,
      slug: link.slug,
      source: utm_source,
      medium: utm_medium,
      campaign: utm_campaign,
      content: utm_content,
      term: utm_term,
    },
  });

  res.cookie('gw_anon_session', anonymousSessionId, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });

  const tenantRow = decryptTenant(tenant);
  const tenantSlug = tenantRow.routing_slug || slugify(tenantRow.business_name);
  res.redirect(`/c/${tenantSlug}?mkt_token=${token}`);
});

// --- Landing page pública por slug ---
// Exibe página intermediária que instrui o cliente a tocar Enviar no WhatsApp.
// A mensagem inicial usa o slug público da loja para que o webhook identifique
// o tenant sem expor IDs internos, tokens ou dados sensíveis ao consumidor.
// Formato: "Olá! Vim conhecer a loja @slug e gostaria de ver os produtos 😊"
//
// Backward-compat: o reconhecimento dos tokens de 6 caracteres "(K8M3Q1)" e do
// comando "START slug" continuam funcionando no webhook — mantenha waTokenQueries
// disponível enquanto links antigos estiverem em circulação.

apiRouter.get('/c/:slug', (req, res) => {
  const slug = req.params.slug.toLowerCase();
  const serverPhone = (process.env.WA_SERVER_PHONE || '').replace(/\D/g, '');
  if (!serverPhone) return res.status(404).send('Canal não configurado.');
  const tenant = tenantQueries.bySlug.get(slug);
  if (!tenant || !tenant.active) return res.status(404).send('Canal não encontrado.');

  const mktToken = req.query.mkt_token ? String(req.query.mkt_token).trim().toUpperCase() : '';
  const tokenSuffix = mktToken ? ` (${mktToken})` : '';

  // Gera token de sessão (30 min) como segunda camada de identificação.
  const baseMessage = (tenant.entry_handle && tenant.entry_code)
    ? buildWhatsAppEntryMessage(tenant)
    : (tenant.route_code
      ? `Olá! Vim conhecer ${tenant.route_code} @${slugify(tenant.business_name || 'loja')} e gostaria de ver os produtos 😊`
      : `Olá! Vim conhecer a loja @${slug} e gostaria de ver os produtos 😊`);
  const initialMessage = baseMessage + tokenSuffix;
  const waUrl = `https://wa.me/${serverPhone}?text=${encodeURIComponent(initialMessage)}`;
  const bizName = tenant.business_name || 'nossa loja';
  const atendente = tenant.atendente_name || 'nosso atendente';
  const WA_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${bizName} — Atendimento WhatsApp</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  background:linear-gradient(160deg,#d1fae5 0%,#f0fdf4 50%,#ecfdf5 100%);
  min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px;
}
.card{
  background:#fff;border-radius:28px;
  padding:40px 28px 32px;
  max-width:360px;width:100%;text-align:center;
  box-shadow:0 12px 48px rgba(0,0,0,.10),0 2px 8px rgba(0,0,0,.05);
}
.wa-circle{
  width:80px;height:80px;
  background:linear-gradient(145deg,#25d366,#128c7e);
  border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  margin:0 auto 20px;
  box-shadow:0 6px 20px rgba(37,211,102,.4);
  color:#fff;
}
.wa-circle svg{width:44px;height:44px}
.pill{
  display:inline-flex;align-items:center;gap:6px;
  background:#f0fdf4;border:1px solid #bbf7d0;
  border-radius:999px;padding:5px 14px;
  font-size:.75rem;color:#15803d;font-weight:600;
  margin-bottom:18px;
}
.dot{width:7px;height:7px;border-radius:50%;background:#22c55e;animation:blink 2s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
h1{font-size:1.375rem;font-weight:800;color:#111;line-height:1.3;margin-bottom:8px}
.sub{font-size:.9rem;color:#6b7280;line-height:1.5;margin-bottom:28px}
.sub strong{color:#111}
.btn{
  display:flex;align-items:center;justify-content:center;gap:10px;
  background:linear-gradient(135deg,#25d366 0%,#20bd5a 100%);
  color:#fff;text-decoration:none;
  font-size:1rem;font-weight:700;
  padding:17px 24px;border-radius:16px;
  box-shadow:0 4px 18px rgba(37,211,102,.45);
  transition:transform .12s,box-shadow .12s;
  -webkit-tap-highlight-color:transparent;
}
.btn:active{transform:scale(.96);box-shadow:0 2px 8px rgba(37,211,102,.3)}
.btn svg{width:22px;height:22px;flex-shrink:0}
.divider{border:none;border-top:1px solid #f3f4f6;margin:22px 0 18px}
.hint{
  display:flex;align-items:center;justify-content:center;gap:7px;
  font-size:.8rem;color:#9ca3af;line-height:1.4;
}
.hint-icon{
  width:18px;height:18px;flex-shrink:0;
  background:#f0fdf4;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
}
.hint-icon svg{width:11px;height:11px;color:#25d366}
.send-word{
  display:inline-block;
  background:#f0fdf4;border:1px solid #bbf7d0;
  border-radius:6px;padding:1px 7px;
  font-weight:700;color:#15803d;font-size:.8rem;
}
.msg-preview{
  margin-top:14px;
  font-size:.75rem;color:#9ca3af;text-align:center;line-height:1.5;
}
.msg-preview em{
  font-style:normal;color:#6b7280;
}
</style>
</head>
<body>
<div class="card">
  <div class="wa-circle">${WA_SVG}</div>

  <div class="pill"><span class="dot"></span> Atendimento online</div>

  <h1>Bem-vindo a<br>${bizName}!</h1>
  <p class="sub">Toque no botão abaixo para conversar com <strong>${atendente}</strong> pelo WhatsApp agora mesmo.</p>

  <a href="${waUrl}" class="btn">
    ${WA_SVG}
    Iniciar conversa
  </a>

  <div class="divider"></div>

  <div class="hint">
    <div class="hint-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
    </div>
    Após abrir o WhatsApp, toque em <span class="send-word">Enviar</span> para começar
  </div>
  <div class="msg-preview">
    Mensagem que será enviada:<br>
    <em>${initialMessage}</em>
  </div>
</div>
</body>
</html>`);
});

// CSRF token endpoint
apiRouter.get('/api/csrf-token', requireAuth, (req, res) => {
  const token = generateCsrfToken(req.sessionToken);
  res.json({ token });
});

apiRouter.post('/api/logout', requireAuth, requireCsrf, (req, res) => {
  logout(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Conclusão persistente dos primeiros passos. O COALESCE no banco torna esta
// operação idempotente e preserva a data da primeira conclusão.
apiRouter.post('/api/onboarding/complete', requireAuth, requireCsrf, (req, res) => {
  tenantQueries.markOnboardingCompleted.run(req.tenant.id);
  res.json({ ok: true, redirect: '/dashboard.html?onboarding=done' });
});

// Dados da sessao atual (para o front saber se e admin, status, features).
apiRouter.get('/api/me', requireAuth, (req, res) => {
  const t = req.tenant;
  const plan = t.plan || 'essencial';
  const impersonatedBy = req.impersonatedBy
    ? (tenantQueries.byId.get(req.impersonatedBy)?.email || req.impersonatedBy)
    : null;
  const sub = subscriptionState(t);
  res.json({
    email: t.email,
    is_admin: isAdminTenant(t),
    subscription: sub,
    // trial_ends_at exposto para o painel exibir "termina em X dias" durante
    // o teste grátis. Só faz sentido quando subscription.status === 'trial'.
    trial_ends_at: t.trial_ends_at || null,
    plan,
    billing_period: t.billing_period || 'mensal',
    planFeatures: getPlanFeatures(plan, sub.status),
    mp_token_set: Boolean(t.mp_access_token),
    features: { billingEnabled, mpBillingEnabled, mpOAuthEnabled, mePlatformEnabled, audioTranscriptionEnabled, blingOAuthEnabled, googleSheetsEnabled, nuvemshopOAuthEnabled, trayOAuthEnabled },
    google_sheets: googleSheetsStatus(t.id),
    google_calendar: googleCalendarStatus(t.id),
    supportPhone: config.supportPhone || '',
    onboarding_required: !t.onboarding_completed_at,
    impersonatedBy,
  });
});

// Uso do plano no ciclo atual (IA, áudio, armazenamento, documentos extras) —
// consumido pelo painel para exibir barras de progresso e avisos de 70/80/100%.
apiRouter.get('/api/usage', requireAuth, (req, res) => {
  res.json(getTenantUsage(req.tenant));
});

// --- Configuracoes do negocio ---
apiRouter.get('/api/settings', requireAuth, (req, res) => {
  const t = req.tenant;
  // Retorna sempre no formato canônico (mapeia dados legados) para o painel.
  const business = normalizeBusiness(t.business_json);
  const catMeta = db.prepare('SELECT filename, uploaded_at FROM catalog_files WHERE tenant_id = ?').get(t.id);
  const catalogDocument = knowledgeDocumentQueries.latestCatalogForTenant.get(t.id);
  res.json({
    email: t.email,
    business_name: t.business_name,
    atendente_name: t.atendente_name,
    checkout_url: t.checkout_url,
    notify_phone: t.notify_phone || '',
    wa_phone_number_id: t.wa_phone_number_id || '',
    wa_token_set: Boolean(t.wa_token),
    mp_token_set: Boolean(t.mp_access_token),
    cep_origem: t.cep_origem || '',
    melhor_envio_token_set: Boolean(t.melhor_envio_token),
    bling_connected: Boolean(t.bling_access_token),
    nuvemshop_connected: Boolean(t.nuvemshop_access_token),
    tray_connected: Boolean(t.tray_access_token),
    hotmart_connected: Boolean(t.hotmart_hottok),
    hotmart_webhook_url: `${config.appUrl.replace(/\/$/, '')}/api/hotmart/webhook/${t.id}`,
    business,
    setup_analysis: (() => {
      if (t.setup_analysis_score == null) return null;
      let saved = {};
      try { saved = JSON.parse(t.setup_analysis_json || '{}'); } catch { saved = {}; }
      return {
        ...saved,
        score: Number(t.setup_analysis_score),
        analyzed_at: t.setup_analysis_at || null,
      };
    })(),
    catalog_file: catMeta ? { filename: catMeta.filename, uploaded_at: catMeta.uploaded_at } : null,
    catalog_document: catalogDocument ? {
      id: catalogDocument.id,
      status: catalogDocument.status,
      active: Boolean(catalogDocument.active),
      progress_percent: catalogDocument.progress_percent,
      page_count: catalogDocument.page_count,
      indexed_pages: catalogDocument.indexed_pages,
      chunks_count: catalogDocument.chunks_count,
      error_code: catalogDocument.error_code,
      error_message: catalogDocument.error_message,
      processed_at: catalogDocument.processed_at,
      created_at: catalogDocument.created_at,
    } : null,
    webhook_url: `${config.appUrl}/webhook`,
    verify_token: config.whatsapp.verifyToken,
    outbound_webhook_url: t.webhook_url || '',
    outbound_webhook_enabled: Boolean(t.webhook_enabled),
    outbound_webhook_secret_set: Boolean(t.webhook_secret),
    link_logo_set: Boolean(t.link_logo_content),
    link_logo_updated_at: t.link_logo_updated_at || null,
    printnode_connected: Boolean(t.printnode_api_key),
    printnode_printer_id: t.printnode_printer_id || '',
    plan: t.plan || 'essencial',
    planFeatures: getPlanFeatures(t.plan, subscriptionState(t).status),
    subscription: subscriptionState(t),
    routing_slug: t.routing_slug || null,
    whatsapp_number: config.whatsapp.phoneNumberId ? config.whatsapp.phoneNumberId : null,
    google_sheets: googleSheetsStatus(t.id),
    features: { billingEnabled, mpBillingEnabled, mpOAuthEnabled, mePlatformEnabled, audioTranscriptionEnabled, blingOAuthEnabled, googleSheetsEnabled, nuvemshopOAuthEnabled, trayOAuthEnabled },
  });
});

apiRouter.post('/api/settings/link-logo', requireAuth, requireCsrf, uploadGuard, upload.single('logo'), requireMagicBytes, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Envie uma imagem para usar como logo.' });

  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!allowedTypes.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'Use uma imagem PNG, JPG ou WebP.' });
  }
  if (req.file.size > 1024 * 1024) {
    return res.status(400).json({ error: 'A logo deve ter no máximo 1 MB.' });
  }

  db.prepare(`
    UPDATE tenants
       SET link_logo_mime = ?,
           link_logo_content = ?,
           link_logo_updated_at = datetime('now')
     WHERE id = ?
  `).run(req.file.mimetype, readUploadBuffer(req.file), req.tenant.id);

  res.json({ ok: true, link_logo_set: true });
});

apiRouter.delete('/api/settings/link-logo', requireAuth, requireCsrf, (req, res) => {
  db.prepare(`
    UPDATE tenants
       SET link_logo_mime = NULL,
           link_logo_content = NULL,
           link_logo_updated_at = NULL
     WHERE id = ?
  `).run(req.tenant.id);

  res.json({ ok: true, link_logo_set: false });
});

apiRouter.post('/api/settings', requireAuth, requireCsrf, (req, res) => {
  const t = req.tenant;
  const {
    business_name,
    atendente_name,
    checkout_url,
    notify_phone,
    mp_access_token,
    cep_origem,
    melhor_envio_token,
    business,
  } = req.body || {};

  // Normaliza para o formato canônico ANTES de qualquer verificação/gravação —
  // garante que tom de voz, FAQ, objeções, dias e mensagem fora de horário
  // sejam gravados com as chaves que a IA e o webhook leem.
  const canonicalBusiness = normalizeBusiness(business || {});

  const { status: subStatus } = subscriptionState(t);
  const planLimitsForSave = getPlanLimits(t.plan, subStatus);
  if (canonicalBusiness.produtos.length > planLimitsForSave.maxProdutos) {
    return res.status(400).json({
      error: `Seu plano ${planLimitsForSave.label} suporta no máximo ${planLimitsForSave.maxProdutos} produtos. Faça upgrade para cadastrar mais.`,
    });
  }

  try {
    // req.tenant já vem decifrado (requireAuth usa decryptTenant) — usar seus
    // campos cifrados (wa_token/mp_access_token/melhor_envio_token) como
    // fallback "manter como está" regravaria o segredo em TEXTO PURO na
    // coluna cifrada a cada save que não tocasse esses campos. Lê a linha
    // crua do banco pra preservar o valor cifrado intacto.
    const raw = tenantQueries.byId.get(t.id);
    const newBizName = (business_name || t.business_name || '').trim();
    tenantQueries.updateSettings.run({
      id: t.id,
      business_name: newBizName || t.business_name,
      atendente_name: atendente_name || t.atendente_name,
      checkout_url: checkout_url ?? t.checkout_url,
      notify_phone: notify_phone ?? t.notify_phone,
      wa_phone_number_id: t.wa_phone_number_id,
      wa_token: raw.wa_token,
      mp_access_token: mp_access_token ? encryptSecret(mp_access_token) : raw.mp_access_token,
      cep_origem: cep_origem ? cep_origem.replace(/\D/g, '') : t.cep_origem,
      melhor_envio_token: melhor_envio_token ? encryptSecret(melhor_envio_token) : raw.melhor_envio_token,
      business_json: JSON.stringify(canonicalBusiness),
    });

    // Slug NÃO é regenerado automaticamente ao mudar o nome comercial —
    // links antigos já compartilhados devem continuar funcionando.
    // O lojista pode gerar um novo slug manualmente via "↻ Gerar novo" nas configurações.

    // Salva backup automático em disco
    try {
      mkdirSync(BACKUP_DIR, { recursive: true });
      writeFileSync(
        join(BACKUP_DIR, `${t.id}.json`),
        JSON.stringify({
          saved_at: new Date().toISOString(),
          email: t.email,
          business_name: newBizName || t.business_name,
          atendente_name: atendente_name || t.atendente_name,
          checkout_url: checkout_url ?? t.checkout_url,
          notify_phone: notify_phone ?? t.notify_phone,
          cep_origem: cep_origem ? cep_origem.replace(/\D/g, '') : t.cep_origem,
          business: business || {},
        }, null, 2),
      );
    } catch (bkErr) {
      console.error('[backup write]', bkErr);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[settings save]', err);
    res.status(500).json({ error: 'Erro ao salvar.' });
  }
});

// --- Mudar senha ---
apiRouter.post('/api/change-password', requireAuth, requireCsrf, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ error: 'Preencha todos os campos.' });
  if (new_password.length < 8) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });

  const t = decryptTenant(tenantQueries.byId.get(req.tenant.id));
  if (!comparePassword(current_password, t.password_hash)) {
    return res.status(401).json({ error: 'Senha atual incorreta.' });
  }
  db.prepare('UPDATE tenants SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), t.id);
  // Segurança: revoga todas as outras sessões (desloga outros dispositivos).
  sessionQueries.deleteAllForTenantExcept.run(t.id, req.sessionToken);
  res.json({ ok: true });
});

// Exclusão real de conta (LGPD, Art. 18, VI — direito de eliminação). Só o
// próprio titular pode excluir a própria conta (nunca durante impersonation,
// pra um clique de admin nunca apagar a conta de um cliente sem querer).
// Cascata do banco (foreign_keys=ON) apaga contatos, mensagens, vendas, mídia,
// notas e tags; aqui só limpamos o que vive fora do banco (backup em disco).
apiRouter.delete('/api/account', requireAuth, requireCsrf, (req, res) => {
  if (req.impersonatedBy) {
    return res.status(400).json({ error: 'Não é possível excluir conta durante impersonation. Volte para sua própria conta primeiro.' });
  }
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Digite sua senha para confirmar.' });

  const t = decryptTenant(tenantQueries.byId.get(req.tenant.id));
  if (!comparePassword(password, t.password_hash)) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }

  logAudit({
    actorTenantId: t.id, actorEmail: t.email,
    targetTenantId: t.id, targetEmail: t.email,
    action: 'account_delete_self',
  });

  const diskFile = join(BACKUP_DIR, `${t.id}.json`);
  if (existsSync(diskFile)) { try { unlinkSync(diskFile); } catch { /* não bloqueia a exclusão */ } }

  tenantQueries.delete.run(t.id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// --- Billing (Stripe) ---
apiRouter.post('/api/billing/checkout', requireAuth, requireCsrf, async (req, res) => {
  if (!billingEnabled) return res.status(400).json({ error: 'Cobrança não habilitada.' });
  try {
    const url = await createCheckoutSession(req.tenant);
    res.json({ url });
  } catch (err) {
    console.error('checkout:', err);
    res.status(500).json({ error: 'Não foi possível iniciar o checkout.' });
  }
});

apiRouter.post('/api/billing/portal', requireAuth, requireCsrf, async (req, res) => {
  if (!billingEnabled) return res.status(400).json({ error: 'Cobrança não habilitada.' });
  try {
    const url = await createPortalSession(req.tenant);
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: 'Você ainda não tem assinatura ativa.' });
  }
});

// --- WhatsApp link (número servidor) ---

// QR Code do link de atendimento — PNG servido para o modal do painel.
// O link é o /a/:attendance_code (curto) → menos densidade de módulos →
// leitura mais fácil em cartão de visita, adesivo, banner impresso.
apiRouter.get('/api/whatsapp/qrcode.png', requireAuth, async (req, res) => {
  const t = req.tenant;
  const serverPhone = (process.env.WA_SERVER_PHONE || '').replace(/\D/g, '');
  const hasPhone = Boolean(serverPhone);
  const attendanceUrl = (hasPhone && t.attendance_code)
    ? `${config.appUrl}/a/${t.attendance_code}`
    : (hasPhone && t.routing_slug ? `${config.appUrl}/c/${t.routing_slug}` : null);
  if (!attendanceUrl) return res.status(404).json({ error: 'Link de atendimento não configurado.' });

  const size = Math.max(200, Math.min(2000, Number(req.query.size) || 512));
  try {
    const QRCode = (await import('qrcode')).default;
    const buffer = await QRCode.toBuffer(attendanceUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: size,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5min — muda se o slug mudar
    res.send(buffer);
  } catch (err) {
    console.error('[QR code]', err);
    res.status(500).json({ error: 'Falha ao gerar QR code.' });
  }
});

// Retorna o link de atendimento do tenant para o painel do lojista.
// Prioriza o link permanente /a/:attendance_code quando disponível.
apiRouter.get('/api/whatsapp/link', requireAuth, (req, res) => {
  const t = req.tenant;
  const serverPhone = (process.env.WA_SERVER_PHONE || '').replace(/\D/g, '');
  const hasPhone = Boolean(serverPhone);

  const attendanceUrl = (hasPhone && t.attendance_code)
    ? `${config.appUrl}/a/${t.attendance_code}`
    : null;
  const legacyLink = (hasPhone && t.routing_slug)
    ? `${config.appUrl}/c/${t.routing_slug}`
    : null;

  if (!attendanceUrl && !legacyLink) {
    return res.json({ link: null, attendance_url: null, attendance_code: null, slug: null, route_code: null, display_handle: null, link_logo_set: false, link_logo_url: null });
  }

  const displayHandle = slugify(t.business_name || 'loja');

  const bizName = (t.business_name || 'esta empresa')
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')
    .slice(0, 80);
  const attendancePreviewMsg = t.attendance_code
    ? `Olá! Conheci a empresa ${bizName}\ne gostaria de falar com vocês.\n\n🎫 Atendimento ${t.attendance_code}\n\n👉 Toque em Enviar para iniciar.`
    : null;

  res.json({
    link: attendanceUrl || legacyLink,
    attendance_url: attendanceUrl,
    attendance_code: t.attendance_code || null,
    attendance_preview_msg: attendancePreviewMsg,
    slug: t.routing_slug || null,
    route_code: t.route_code || null,
    display_handle: displayHandle,
    entry_handle: t.entry_handle || null,
    entry_code:   t.entry_code   || null,
    link_logo_set: Boolean(t.link_logo_content),
    link_logo_url: (t.link_logo_content && t.attendance_code)
      ? `/a/${encodeURIComponent(t.attendance_code)}/logo?v=${encodeURIComponent(t.link_logo_updated_at || '')}`
      : null,
  });
});

// Regera slug a pedido do lojista — usa o nome comercial para gerar um slug legível
// (sem sufixos aleatórios). Conflitos são resolvidos com "-2", "-3", etc.
apiRouter.post('/api/whatsapp/regenerate-slug', requireAuth, requireCsrf, (req, res) => {
  const t = req.tenant;
  const base = slugify(t.business_name || 'loja');
  const slug = generateUniqueSlug(base, t.id);
  tenantQueries.setSlug.run(slug, t.id);
  res.json({ slug });
});

// --- Mercado Pago OAuth (conectar conta do lojista com 1 clique) ---
apiRouter.get('/api/mp/oauth/start', requireAuth, (req, res) => {
  if (!mpOAuthEnabled) return res.status(404).json({ error: 'MP OAuth não configurado.' });
  const state = createHmac('sha256', config.sessionSecret)
    .update(req.sessionToken)
    .digest('hex');
  const base = `${req.protocol}://${req.get('host')}`;
  const params = new URLSearchParams({
    client_id: config.mpOAuthAppId,
    response_type: 'code',
    platform_id: 'mp',
    redirect_uri: `${base}/api/mp/oauth/callback`,
    state,
  });
  res.redirect(`https://auth.mercadopago.com.br/authorization?${params}`);
});

apiRouter.get('/api/mp/oauth/callback', requireAuth, async (req, res) => {
  if (!mpOAuthEnabled) return res.redirect('/integrations.html?mp_error=not_configured');
  const { code, state } = req.query;

  // Normalise state to lowercase (MP may return it in any case)
  const stateNorm = typeof state === 'string' ? state.toLowerCase() : '';
  const expected = createHmac('sha256', config.sessionSecret)
    .update(req.sessionToken)
    .digest('hex'); // always lowercase hex
  const validState =
    stateNorm.length === expected.length &&
    /^[0-9a-f]+$/.test(stateNorm) &&
    timingSafeEqual(Buffer.from(stateNorm, 'hex'), Buffer.from(expected, 'hex'));
  if (!validState) {
    console.error('MP OAuth state mismatch — state:', state?.slice(0, 8), 'expected:', expected.slice(0, 8));
    return res.redirect('/integrations.html?mp_error=invalid_state');
  }

  // redirect_uri must match exactly what was sent in /start (no trailing slash)
  const redirectUri = `${req.protocol}://${req.get('host')}/api/mp/oauth/callback`;
  try {
    const r = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: config.mpOAuthAppId,
        client_secret: config.mpOAuthAppSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        test_token: false,
      }),
    });
    const data = await r.json();
    // Nunca logar o corpo (contém access_token). Apenas status e presença do token.
    console.log('MP OAuth token response status:', r.status, 'has_token:', Boolean(data.access_token));
    if (!r.ok || !data.access_token) throw new Error(data.message || data.error || 'Falha ao obter token do Mercado Pago.');
    db.prepare('UPDATE tenants SET mp_access_token = ? WHERE id = ?')
      .run(encryptSecret(data.access_token), req.tenant.id);
    res.redirect('/integrations.html?mp_connected=1');
  } catch (e) {
    console.error('MP OAuth error:', e.message);
    res.redirect('/integrations.html?mp_error=oauth_failed');
  }
});

// --- Mercado Pago: desconectar conta do lojista ---
apiRouter.post('/api/mp/disconnect', requireAuth, requireCsrf, (req, res) => {
  db.prepare('UPDATE tenants SET mp_access_token = NULL WHERE id = ?').run(req.tenant.id);
  res.json({ ok: true });
});

// --- Configuração por voz: transcreve áudio e organiza dados do negócio ---
apiRouter.post('/api/settings/voice-intake', requireAuth, requireCsrf, uploadGuard, upload.single('audio'), requireMagicBytes, async (req, res) => {
  try {
    const result = await processSettingsVoiceIntake(req.file);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      error: err.message || 'Não consegui transcrever o áudio. Tente novamente ou preencha manualmente.',
    });
  }
});

// --- Bling ERP OAuth (conectar conta do lojista com 1 clique — Elite/Especial) ---
apiRouter.get('/api/bling/oauth/start', requireAuth, requirePlan('elite'), (req, res) => {
  if (!blingOAuthEnabled) return res.status(404).json({ error: 'Bling OAuth não configurado.' });
  const state = createHmac('sha256', config.sessionSecret)
    .update(req.sessionToken)
    .digest('hex');
  const base = `${req.protocol}://${req.get('host')}`;
  const params = new URLSearchParams({
    client_id: config.blingOAuthAppId,
    response_type: 'code',
    state,
    redirect_uri: `${base}/api/bling/oauth/callback`,
  });
  res.redirect(`https://www.bling.com.br/Api/v3/oauth/authorize?${params}`);
});

apiRouter.get('/api/bling/oauth/callback', requireAuth, async (req, res) => {
  if (!blingOAuthEnabled) return res.redirect('/integrations.html?bling_error=not_configured');
  const { code, state } = req.query;

  const stateNorm = typeof state === 'string' ? state.toLowerCase() : '';
  const expected = createHmac('sha256', config.sessionSecret)
    .update(req.sessionToken)
    .digest('hex');
  const validState =
    stateNorm.length === expected.length &&
    /^[0-9a-f]+$/.test(stateNorm) &&
    timingSafeEqual(Buffer.from(stateNorm, 'hex'), Buffer.from(expected, 'hex'));
  if (!validState) {
    console.error('Bling OAuth state mismatch — state:', state?.slice(0, 8), 'expected:', expected.slice(0, 8));
    return res.redirect('/integrations.html?bling_error=invalid_state');
  }

  const redirectUri = `${req.protocol}://${req.get('host')}/api/bling/oauth/callback`;
  try {
    const data = await exchangeBlingCode(code, redirectUri);
    saveBlingTokens(req.tenant.id, data);
    res.redirect('/integrations.html?bling_connected=1');
  } catch (e) {
    console.error('Bling OAuth error:', e.message);
    res.redirect('/integrations.html?bling_error=oauth_failed');
  }
});

apiRouter.post('/api/bling/disconnect', requireAuth, requireCsrf, (req, res) => {
  tenantQueries.clearBlingCredentials.run(req.tenant.id);
  res.json({ ok: true });
});

function blingProductCode(produto) {
  return String(produto?.codigo || produto?.sku || produto?.produto_codigo || '').trim();
}

function formatBlingPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

function mapBlingProdutoToZapien(produto, saldo) {
  const codigo = blingProductCode(produto);
  const estoque = saldo !== undefined ? Number(saldo) : undefined;
  return {
    nome: String(produto?.nome || codigo || 'Produto sem nome').trim(),
    codigo,
    sku: codigo,
    preco: formatBlingPrice(produto?.preco ?? produto?.precoVenda ?? produto?.valor),
    descricao: String(produto?.descricaoCurta || produto?.descricaoComplementar || produto?.descricao || '').trim(),
    estoque_qtd: estoque,
    esgotado: estoque !== undefined ? estoque <= 0 : Boolean(produto?.esgotado),
  };
}

apiRouter.post('/api/bling/import-products', requireAuth, requireCsrf, requirePlan('elite'), async (req, res) => {
  if (!blingOAuthEnabled) return res.status(404).json({ error: 'Bling OAuth não configurado.' });
  if (!req.tenant.bling_access_token) return res.status(400).json({ error: 'Conecte o Bling antes de importar produtos.' });

  try {
    const produtosBling = await fetchAllBlingProdutos(req.tenant);
    if (!produtosBling.length) return res.json({ ok: true, imported: 0, updated: 0, total: 0 });

    const saldos = await fetchBlingEstoques(req.tenant, produtosBling.map((p) => p.id).filter(Boolean));
    const importados = produtosBling.map((p) => mapBlingProdutoToZapien(p, saldos[p.id])).filter((p) => p.nome);
    const biz = normalizeBusiness(req.tenant.business_json);
    const existentes = Array.isArray(biz.produtos) ? biz.produtos : [];
    const porCodigo = new Map();
    const porNome = new Map();
    existentes.forEach((p, index) => {
      const codigo = blingProductCode(p);
      if (codigo) porCodigo.set(codigo, index);
      if (p?.nome) porNome.set(p.nome, index);
    });

    let imported = 0;
    let updated = 0;
    const mapPayloads = [];
    for (const produto of importados) {
      const idx = (produto.codigo && porCodigo.has(produto.codigo))
        ? porCodigo.get(produto.codigo)
        : porNome.get(produto.nome);

      let insertedIndex;
      if (idx !== undefined) {
        existentes[idx] = { ...existentes[idx], ...produto };
        insertedIndex = idx;
        updated += 1;
      } else {
        // Gera product_id imediatamente para produto novo — precisamos dele
        // no mapPayload abaixo.
        existentes.push({ product_id: newProductId(), ...produto });
        insertedIndex = existentes.length - 1;
        imported += 1;
      }

      const source = produtosBling.find((p) => {
        const sourceCode = blingProductCode(p);
        return (produto.codigo && sourceCode === produto.codigo) || p.nome === produto.nome;
      });
      const mapPayload = {
        tenant_id: req.tenant.id,
        produto_nome: produto.nome,
        produto_codigo: produto.codigo || null,
        bling_produto_id: String(source?.id || ''),
        bling_sku: produto.codigo || null,
        product_id: existentes[insertedIndex]?.product_id || null,
      };
      mapPayloads.push(mapPayload);
    }

    biz.produtos = existentes;
    const limits = getPlanLimits(req.tenant.plan, subscriptionState(req.tenant).status);
    if (biz.produtos.length > limits.maxProdutos) {
      return res.status(400).json({
        error: `Seu plano ${limits.label} suporta no máximo ${limits.maxProdutos} produtos. O Bling retornou ${biz.produtos.length}.`,
      });
    }

    for (const mapPayload of mapPayloads) {
      if (mapPayload.produto_codigo) blingProductMapQueries.upsertByCodigo.run(mapPayload);
      else blingProductMapQueries.upsert.run(mapPayload);
    }
    saveBusinessJson(req.tenant.id, biz);
    res.json({ ok: true, imported, updated, total: importados.length });
  } catch (err) {
    console.error('[Bling] import-products:', err.message);
    res.status(502).json({ error: err.message || 'Não foi possível importar produtos do Bling.' });
  }
});


// --- Google Sheets OAuth (planilha automática) ---
apiRouter.get('/api/google-sheets/oauth/start', requireAuth, (req, res) => {
  if (!googleSheetsEnabled) return res.redirect('/settings.html?gs_error=not_configured');
  try {
    res.redirect(googleOAuthUrl(req.sessionToken));
  } catch (e) {
    console.error('[google-sheets] oauth start', e.message);
    res.redirect('/settings.html?gs_error=not_configured');
  }
});

apiRouter.get('/api/google-sheets/oauth/callback', requireAuth, async (req, res) => {
  if (!googleSheetsEnabled) return res.redirect('/settings.html?gs_error=not_configured');
  const { code, state } = req.query;
  if (!code || !verifyGoogleOAuthState(req.sessionToken, state)) {
    return res.redirect('/settings.html?gs_error=invalid_state');
  }
  try {
    await connectGoogleSheets(req.tenant, String(code));
    res.redirect('/settings.html?gs_connected=1');
  } catch (e) {
    console.error('[google-sheets] oauth callback', e.message);
    res.redirect('/settings.html?gs_error=oauth_failed');
  }
});

apiRouter.get('/api/google-sheets/status', requireAuth, (req, res) => {
  res.json(googleSheetsStatus(req.tenant.id));
});

apiRouter.post('/api/google-sheets/sync', requireAuth, requireCsrf, async (req, res) => {
  try {
    const status = await syncGoogleSheets(req.tenant);
    res.json({ ok: true, ...status });
  } catch (e) {
    console.error('[google-sheets] sync', e.message);
    res.status(400).json({ error: 'Não foi possível sincronizar a planilha. Tente novamente.' });
  }
});

apiRouter.post('/api/google-sheets/disconnect', requireAuth, requireCsrf, (req, res) => {
  disconnectGoogleSheets(req.tenant.id);
  res.json({ ok: true });
});

apiRouter.get('/api/google-calendar/oauth/start', requireAuth, (req, res) => {
  if (!googleCalendarEnabled()) return res.redirect('/integrations.html?gcal_error=not_configured');
  try { res.redirect(googleCalendarOAuthUrl(req.sessionToken)); }
  catch { res.redirect('/integrations.html?gcal_error=not_configured'); }
});
apiRouter.get('/api/google-calendar/oauth/callback', requireAuth, async (req, res) => {
  if (!req.query.code || !verifyGoogleCalendarState(req.sessionToken, req.query.state)) return res.redirect('/integrations.html?gcal_error=invalid_state');
  try { await connectGoogleCalendar(req.tenant, String(req.query.code)); res.redirect('/integrations.html?gcal_connected=1'); }
  catch (err) { console.error('[google-calendar] oauth:', err.message); res.redirect('/integrations.html?gcal_error=oauth_failed'); }
});
apiRouter.get('/api/google-calendar/status', requireAuth, (req, res) => res.json(googleCalendarStatus(req.tenant.id)));
apiRouter.post('/api/google-calendar/sync', requireAuth, requireCsrf, async (req, res) => {
  try { res.json({ ok: true, ...(await syncGoogleCalendar(req.tenant.id)) }); }
  catch (err) { console.error('[google-calendar] sync:', err.message); res.status(400).json({ error: 'Não foi possível sincronizar o Google Calendar.' }); }
});
apiRouter.post('/api/google-calendar/disconnect', requireAuth, requireCsrf, (req, res) => { disconnectGoogleCalendar(req.tenant.id); res.json({ ok: true }); });

// --- Webhook genérico (Zapier/Make) ---
apiRouter.post('/api/webhooks/settings', requireAuth, requireCsrf, (req, res) => {
  const t = req.tenant;
  const { webhook_url, webhook_enabled } = req.body || {};
  if (webhook_url) {
    try { assertPublicUrl(webhook_url); } catch (e) {
      return res.status(400).json({ error: e.message || 'URL de webhook inválida.' });
    }
  }
  // Preserva o segredo CIFRADO como está — req.tenant já vem decifrado
  // (requireAuth usa decryptTenant), então lemos a linha crua para não
  // regravar o segredo em texto puro na coluna cifrada.
  const raw = tenantQueries.byId.get(t.id);
  tenantQueries.setWebhookSettings.run({
    id: t.id,
    webhook_url: webhook_url ?? raw.webhook_url ?? '',
    webhook_secret: raw.webhook_secret,
    webhook_enabled: webhook_enabled === false ? 0 : 1,
  });
  res.json({ ok: true });
});

// Gera (ou regenera) o segredo do webhook — mostrado em texto puro só nesta
// resposta; depois disso só um booleano `outbound_webhook_secret_set` é exposto.
apiRouter.post('/api/webhooks/regenerate-secret', requireAuth, requireCsrf, (req, res) => {
  const t = req.tenant;
  const secret = randomBytes(32).toString('hex');
  tenantQueries.setWebhookSettings.run({
    id: t.id,
    webhook_url: t.webhook_url || '',
    webhook_secret: encryptSecret(secret),
    webhook_enabled: t.webhook_enabled === 0 ? 0 : 1,
  });
  res.json({ ok: true, secret });
});

apiRouter.post('/api/webhooks/test', requireAuth, requireCsrf, async (req, res) => {
  const t = decryptTenant(tenantQueries.byId.get(req.tenant.id));
  if (!t.webhook_url) return res.status(400).json({ error: 'Configure uma URL de webhook primeiro.' });
  await dispatchWebhookEvent(t, 'test.ping', { message: 'Evento de teste do Zapien.' });
  const last = webhookLogQueries.recentByTenant.all(t.id)[0];
  res.json({ ok: true, delivery: last ? { status: last.status, http_status: last.http_status, error: last.error } : null });
});

apiRouter.get('/api/webhooks/log', requireAuth, (req, res) => {
  res.json(webhookLogQueries.recentByTenant.all(req.tenant.id));
});

// --- Saúde da conexão Meta (WhatsApp) ---
// Sempre a visão do PRÓPRIO tenant da sessão — nunca aceita tenant_id do front.
apiRouter.get('/api/meta/health', requireAuth, (req, res) => {
  const t = decryptTenant(tenantQueries.byId.get(req.tenant.id));
  res.json(getTenantMetaHealthView(t));
});

// Verificação manual ("Verificar conexão agora") — chama a Graph API na hora.
apiRouter.post('/api/meta/health/check', requireAuth, requireCsrf, metaHealthLimiter, async (req, res) => {
  try {
    const t = decryptTenant(tenantQueries.byId.get(req.tenant.id));
    const view = await checkTenantMetaHealth(t);
    res.json(view);
  } catch (e) {
    console.error('[meta-health] verificação manual falhou:', e.message);
    res.status(502).json({ error: 'Não foi possível verificar a conexão agora. Tente novamente em instantes.' });
  }
});

// Situação dos templates (contagens da última verificação Meta + templates
// cadastrados localmente para campanhas).
apiRouter.get('/api/meta/templates/status', requireAuth, (req, res) => {
  const t = decryptTenant(tenantQueries.byId.get(req.tenant.id));
  const view = getTenantMetaHealthView(t);
  const biz = normalizeBusiness(t.business_json);
  res.json({
    checked_at: view.checked_at,
    meta: view.templates,
    local_registered: (biz.whatsappTemplates || []).length,
  });
});

// --- Web Push (notificações no aparelho) ---
apiRouter.get('/api/push/config', requireAuth, (req, res) => {
  res.json({
    enabled: webPushEnabled,
    public_key: getVapidPublicKey(),
    active_subscriptions: pushSubscriptionQueries.countActiveByTenant.get(req.tenant.id)?.n || 0,
  });
});

apiRouter.post('/api/push/subscribe', requireAuth, requireCsrf, (req, res) => {
  if (!webPushEnabled) return res.status(400).json({ error: 'Notificações não estão habilitadas nesta instalação.' });
  try {
    saveSubscription(req.tenant.id, req.body, req.headers['user-agent']);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Assinatura de notificação inválida.' });
  }
});

apiRouter.delete('/api/push/subscribe', requireAuth, requireCsrf, (req, res) => {
  const result = removeSubscription(req.tenant.id, req.body?.endpoint);
  res.json({ ok: true, removed: result.removed });
});

apiRouter.get('/api/push/preferences', requireAuth, (req, res) => {
  const raw = tenantQueries.byId.get(req.tenant.id);
  res.json(getPushPreferences(raw));
});

apiRouter.put('/api/push/preferences', requireAuth, requireCsrf, (req, res) => {
  if (typeof req.body !== 'object' || req.body === null) {
    return res.status(400).json({ error: 'Preferências inválidas.' });
  }
  res.json(setPushPreferences(req.tenant.id, req.body));
});

apiRouter.get('/api/alert-preferences', requireAuth, (req, res) => {
  const raw = tenantQueries.byId.get(req.tenant.id);
  res.json({
    whatsapp_phone: req.tenant.notify_phone || '',
    push_enabled: webPushEnabled,
    active_subscriptions: pushSubscriptionQueries.countActiveByTenant.get(req.tenant.id)?.n || 0,
    categories: getPushPreferences(raw),
  });
});

apiRouter.put('/api/alert-preferences', requireAuth, requireCsrf, (req, res) => {
  try {
    const phone = normalizeAlertPhone(req.body?.whatsapp_phone);
    db.prepare('UPDATE tenants SET notify_phone = ? WHERE id = ?').run(phone || null, req.tenant.id);
    const categories = req.body?.categories && typeof req.body.categories === 'object'
      ? setPushPreferences(req.tenant.id, req.body.categories)
      : getPushPreferences(tenantQueries.byId.get(req.tenant.id));
    res.json({ ok: true, whatsapp_phone: phone, categories });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Agenda para negócios de serviços (MVP profissional individual) ---
const bookingServiceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  duration_minutes: z.coerce.number().int().min(10).max(720),
  price_cents: z.coerce.number().int().min(0).max(100000000),
  booking_fee_cents: z.coerce.number().int().min(0).max(100000000),
  active: z.boolean().optional().default(true),
});

const bookingSettingsSchema = z.object({
  weekly: z.record(z.string(), z.object({
    enabled: z.boolean(),
    intervals: z.array(z.object({
      start: z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/),
      end: z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/),
    })).max(3),
  })),
  min_notice_minutes: z.coerce.number().int().min(0).max(43200),
  max_advance_days: z.coerce.number().int().min(1).max(365),
  buffer_minutes: z.coerce.number().int().min(0).max(240),
});

const bookingBlockSchema = z.object({
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  reason: z.string().trim().max(200).optional().nullable(),
});

const appointmentSchema = z.object({
  service_id: z.string().min(1),
  customer_name: z.string().trim().min(2).max(120),
  customer_phone: z.string().trim().max(30).optional().nullable(),
  starts_at: z.string().datetime(),
  contact_id: z.coerce.number().int().positive().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const appointmentStatuses = new Set([
  'aguardando_pagamento',
  'aguardando_confirmacao',
  'confirmado',
  'concluido',
  'cancelado',
  'nao_compareceu',
]);

function requireServiceMode(req, res, next) {
  const business = normalizeBusiness(req.tenant.business_json);
  if (business.tipo_negocio !== 'servicos') {
    return res.status(403).json({
      error: 'A Agenda está disponível quando o tipo de negócio é Serviços.',
      code: 'SERVICE_MODE_REQUIRED',
    });
  }
  next();
}

function normalizeBookingPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return digits.length >= 12 && digits.length <= 15 ? digits : '';
}

apiRouter.get('/api/booking/settings', requireAuth, requireServiceMode, (req, res) => {
  res.json({ settings: getBookingSettings(req.tenant.id) });
});

apiRouter.put('/api/booking/settings', requireAuth, requireServiceMode, requireCsrf, (req, res) => {
  let data;
  try { data = validate(bookingSettingsSchema, req.body || {}); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  res.json({ settings: saveBookingSettings(req.tenant.id, data) });
});

apiRouter.get('/api/booking/blocks', requireAuth, requireServiceMode, (req, res) => {
  res.json({ blocks: bookingBlockQueries.listUpcoming.all(req.tenant.id) });
});

apiRouter.post('/api/booking/blocks', requireAuth, requireServiceMode, requireCsrf, (req, res) => {
  let data;
  try { data = validate(bookingBlockSchema, req.body || {}); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  const startsAt = new Date(data.starts_at);
  const endsAt = new Date(data.ends_at);
  if (endsAt <= startsAt) return res.status(400).json({ error: 'O fim do bloqueio deve ser posterior ao início.' });
  const block = {
    id: 'blk_' + randomUUID().replace(/-/g, '').slice(0, 24),
    tenant_id: req.tenant.id,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    reason: data.reason || null,
  };
  bookingBlockQueries.insert.run(block);
  res.status(201).json({ block });
});

apiRouter.delete('/api/booking/blocks/:id', requireAuth, requireServiceMode, requireCsrf, (req, res) => {
  const info = bookingBlockQueries.delete.run(req.params.id, req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'Bloqueio não encontrado.' });
  res.json({ ok: true });
});

apiRouter.get('/api/booking/availability', requireAuth, requireServiceMode, (req, res) => {
  const service = bookingServiceQueries.byId.get(String(req.query.service_id || ''), req.tenant.id);
  if (!service || !service.active) return res.status(400).json({ error: 'Serviço indisponível.' });
  const date = String(req.query.date || '');
  res.json({ slots: getAvailableBookingSlots(req.tenant.id, service, date) });
});

apiRouter.get('/api/booking/services', requireAuth, requireServiceMode, (req, res) => {
  res.json({ services: bookingServiceQueries.list.all(req.tenant.id) });
});

apiRouter.post('/api/booking/services', requireAuth, requireServiceMode, requireCsrf, (req, res) => {
  let data;
  try { data = validate(bookingServiceSchema, req.body || {}); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  const service = {
    id: 'svc_' + randomUUID().replace(/-/g, '').slice(0, 24),
    tenant_id: req.tenant.id,
    name: data.name,
    duration_minutes: data.duration_minutes,
    price_cents: data.price_cents,
    booking_fee_cents: data.booking_fee_cents,
    active: data.active ? 1 : 0,
  };
  bookingServiceQueries.insert.run(service);
  res.status(201).json({ service: bookingServiceQueries.byId.get(service.id, req.tenant.id) });
});

apiRouter.put('/api/booking/services/:id', requireAuth, requireServiceMode, requireCsrf, (req, res) => {
  let data;
  try { data = validate(bookingServiceSchema, req.body || {}); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  const info = bookingServiceQueries.update.run({
    id: req.params.id,
    tenant_id: req.tenant.id,
    name: data.name,
    duration_minutes: data.duration_minutes,
    price_cents: data.price_cents,
    booking_fee_cents: data.booking_fee_cents,
    active: data.active ? 1 : 0,
  });
  if (!info.changes) return res.status(404).json({ error: 'Serviço não encontrado.' });
  res.json({ service: bookingServiceQueries.byId.get(req.params.id, req.tenant.id) });
});

apiRouter.get('/api/booking/appointments', requireAuth, requireServiceMode, (req, res) => {
  const now = new Date();
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(from.getTime() + 7 * 86400000);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to - from > 93 * 86400000) {
    return res.status(400).json({ error: 'Período inválido. Consulte no máximo 93 dias.' });
  }
  res.json({
    appointments: appointmentQueries.listRange.all({
      tenant_id: req.tenant.id,
      from: from.toISOString(),
      to: to.toISOString(),
    }),
  });
});

apiRouter.post('/api/booking/appointments', requireAuth, requireServiceMode, requireCsrf, async (req, res) => {
  let data;
  try { data = validate(appointmentSchema, req.body || {}); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  const service = bookingServiceQueries.byId.get(data.service_id, req.tenant.id);
  if (!service || !service.active) return res.status(400).json({ error: 'Serviço indisponível.' });
  const startsAt = new Date(data.starts_at);
  const validation = validateBookingSlot(req.tenant.id, service, startsAt.toISOString());
  if (!validation.ok) {
    return res.status(409).json({ error: validation.reason });
  }
  const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60000);

  const phone = normalizeBookingPhone(data.customer_phone);
  let contact = data.contact_id ? contactQueries.byId.get(data.contact_id) : null;
  if (!contact && phone) {
    contact = contactQueries.byPhone.get(req.tenant.id, phone);
    if (!contact) {
      const inserted = contactQueries.insert.run(req.tenant.id, phone, data.customer_name);
      contact = contactQueries.byId.get(inserted.lastInsertRowid);
    }
  }

  const appointment = {
    id: 'apt_' + randomUUID().replace(/-/g, '').slice(0, 24),
    tenant_id: req.tenant.id,
    contact_id: contact?.id || null,
    service_id: service.id,
    customer_name: data.customer_name,
    customer_phone: phone || null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    status: service.booking_fee_cents > 0 ? 'aguardando_pagamento' : 'aguardando_confirmacao',
    fee_status: service.booking_fee_cents > 0 ? 'pendente' : 'nao_cobrada',
    fee_amount_cents: service.booking_fee_cents,
    notes: data.notes || null,
  };
  appointmentQueries.insert.run(appointment);
  let calendarWarning = null;
  try {
    await createGoogleCalendarEvent(req.tenant.id, { ...appointment, service_name: service.name });
  } catch (err) {
    console.error('[Agenda] Google Calendar:', err.message);
    calendarWarning = 'Agendamento salvo, mas não foi enviado ao Google Calendar.';
  }

  let paymentLink = null;
  let paymentWarning = null;
  if (service.booking_fee_cents > 0) {
    try {
      const payment = await createBookingFeeLink(req.tenant, contact, appointment, service);
      paymentLink = payment.link;
      if (payment.saleId) {
        appointmentQueries.attachSale.run({
          id: appointment.id,
          tenant_id: req.tenant.id,
          sale_id: payment.saleId,
        });
      } else {
        paymentWarning = req.tenant.mp_access_token
          ? 'Não foi possível gerar a cobrança agora.'
          : 'Conecte o Mercado Pago para cobrar a taxa automaticamente.';
      }
    } catch (err) {
      console.error('[Agenda] cobrança da taxa:', err.message);
      paymentWarning = 'Não foi possível gerar a cobrança agora.';
    }
  }

  if (phone) {
    const when = formatBookingDateTime(startsAt.toISOString());
    const fee = (service.booking_fee_cents / 100).toFixed(2).replace('.', ',');
    const text = paymentLink
      ? `Olá, ${data.customer_name}! Seu horário de ${service.name} foi reservado para ${when}. Para concluir a solicitação, pague a taxa de R$ ${fee}: ${paymentLink}`
      : `Olá, ${data.customer_name}! Recebemos sua solicitação de ${service.name} para ${when}. O estabelecimento ainda confirmará o horário.`;
    try {
      await sendText(req.tenant, phone, text);
      if (contact) messageQueries.insert.run(contact.id, 'assistant', text);
    } catch (err) {
      console.error('[Agenda] aviso inicial:', err.message);
      paymentWarning = paymentWarning || 'Agendamento salvo, mas o aviso no WhatsApp não foi enviado.';
    }
  }

  res.status(201).json({
    appointment: appointmentQueries.byId.get(appointment.id, req.tenant.id),
    payment_link: paymentLink,
    warning: paymentWarning || calendarWarning,
  });
});

apiRouter.patch('/api/booking/appointments/:id/status', requireAuth, requireServiceMode, requireCsrf, async (req, res) => {
  const status = String(req.body?.status || '');
  if (!appointmentStatuses.has(status)) return res.status(400).json({ error: 'Status inválido.' });
  const before = appointmentQueries.byId.get(req.params.id, req.tenant.id);
  if (!before) return res.status(404).json({ error: 'Agendamento não encontrado.' });

  const info = appointmentQueries.updateStatus.run({
    id: req.params.id,
    tenant_id: req.tenant.id,
    status,
  });
  if (!info.changes) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  const appointment = appointmentQueries.byId.get(req.params.id, req.tenant.id);

  let warning = null;
  if (status === 'cancelado' && before.status !== 'cancelado') {
    try { await cancelGoogleCalendarEvent(req.tenant.id, before); }
    catch (err) { console.error('[Agenda] cancelar Google Calendar:', err.message); warning = 'Status atualizado, mas o evento não foi removido do Google Calendar.'; }
  }
  if (status === 'confirmado' && before.status !== 'confirmado' && appointment.customer_phone) {
    const text = `✅ Agendamento confirmado! ${appointment.service_name} em ${formatBookingDateTime(appointment.starts_at)}. Se precisar alterar, responda por aqui.`;
    try {
      await sendText(req.tenant, appointment.customer_phone, text);
      if (appointment.contact_id) messageQueries.insert.run(appointment.contact_id, 'assistant', text);
      appointmentQueries.markNotified.run(appointment.id, req.tenant.id);
    } catch (err) {
      console.error('[Agenda] confirmação:', err.message);
      warning = 'Status atualizado, mas o aviso no WhatsApp não foi enviado.';
    }
  }

  res.json({ appointment, warning });
});

// --- Automações comerciais (QUANDO → SE → ENTÃO) ---
// Tenant sempre da sessão; JSON do front sempre revalidado por allowlist
// (src/automations/schema.js). Limite de automações ATIVAS vem do plano.

function automationLimit(req) {
  return getPlanLimits(req.tenant.plan, subscriptionState(req.tenant).status).automationMaxActive || 0;
}

function serializeAutomation(row, counts = null) {
  const safe = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    enabled: Boolean(row.enabled),
    trigger_type: row.trigger_type,
    trigger_config: safe(row.trigger_config_json, {}),
    conditions: safe(row.conditions_json, []),
    actions: safe(row.actions_json, []),
    cooldown_seconds: row.cooldown_seconds,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_run_at: counts?.last_run_at || row.last_run_at,
    runs_total: counts?.total || 0,
    last_run_status: counts?.last_status || null,
  };
}

apiRouter.get('/api/automations', requireAuth, (req, res) => {
  const rows = automationQueries.listByTenant.all(req.tenant.id);
  const counts = Object.fromEntries(
    automationQueries.runCounts.all(req.tenant.id).map((r) => [r.automation_id, r])
  );
  res.json({
    automations: rows.map((r) => serializeAutomation(r, counts[r.id])),
    limit_active: automationLimit(req),
    active_count: automationQueries.countActive.get(req.tenant.id)?.n || 0,
  });
});

// Opções para o construtor: allowlists + dados do tenant (etapas, tags,
// templates cadastrados) + predefinições.
apiRouter.get('/api/automations/options', requireAuth, (req, res) => {
  const t = decryptTenant(tenantQueries.byId.get(req.tenant.id));
  const biz = normalizeBusiness(t.business_json);
  res.json({
    triggers: TRIGGER_TYPES,
    conditions: CONDITION_TYPES,
    actions: ACTION_TYPES,
    stages: STAGES.map((s) => ({ id: s.id, label: s.label })),
    tags: contactTagQueries.byTenant.all(req.tenant.id).map((r) => r.tag).slice(0, 100),
    templates: (biz.whatsappTemplates || []).map((tpl) => ({ nome: tpl.nome, idioma: tpl.idioma || 'pt_BR' })),
    webhook_configured: Boolean(t.webhook_url && t.webhook_enabled),
    presets: AUTOMATION_PRESETS,
    limit_active: automationLimit(req),
    active_count: automationQueries.countActive.get(req.tenant.id)?.n || 0,
  });
});

apiRouter.post('/api/automations', requireAuth, requireCsrf, (req, res, next) => {
  try {
    const data = validateAutomation(req.body);
    const wantsEnabled = data.enabled !== false;
    if (wantsEnabled) {
      const active = automationQueries.countActive.get(req.tenant.id)?.n || 0;
      if (active >= automationLimit(req)) {
        return res.status(403).json({
          error: `Seu plano permite até ${automationLimit(req)} automações ativas. Pause uma automação ou faça upgrade.`,
        });
      }
    }
    const id = 'aut_' + randomUUID().replace(/-/g, '').slice(0, 24);
    automationQueries.insert.run({
      id,
      tenant_id: req.tenant.id,
      name: data.name,
      description: data.description || null,
      enabled: wantsEnabled ? 1 : 0,
      trigger_type: data.trigger_type,
      trigger_config_json: JSON.stringify(data.trigger_config || {}),
      conditions_json: JSON.stringify(data.conditions || []),
      actions_json: JSON.stringify(data.actions),
      cooldown_seconds: data.cooldown_seconds || 0,
    });
    res.status(201).json(serializeAutomation(automationQueries.byId.get(id, req.tenant.id)));
  } catch (e) { next(e); }
});

apiRouter.get('/api/automations/:id', requireAuth, (req, res) => {
  const row = automationQueries.byId.get(req.params.id, req.tenant.id);
  if (!row) return res.status(404).json({ error: 'Automação não encontrada.' });
  res.json(serializeAutomation(row));
});

apiRouter.put('/api/automations/:id', requireAuth, requireCsrf, (req, res, next) => {
  try {
    const row = automationQueries.byId.get(req.params.id, req.tenant.id);
    if (!row) return res.status(404).json({ error: 'Automação não encontrada.' });
    const data = validateAutomation(req.body);
    automationQueries.update.run({
      id: row.id,
      tenant_id: req.tenant.id,
      name: data.name,
      description: data.description || null,
      trigger_type: data.trigger_type,
      trigger_config_json: JSON.stringify(data.trigger_config || {}),
      conditions_json: JSON.stringify(data.conditions || []),
      actions_json: JSON.stringify(data.actions),
      cooldown_seconds: data.cooldown_seconds || 0,
    });
    res.json(serializeAutomation(automationQueries.byId.get(row.id, req.tenant.id)));
  } catch (e) { next(e); }
});

apiRouter.post('/api/automations/:id/toggle', requireAuth, requireCsrf, (req, res) => {
  const row = automationQueries.byId.get(req.params.id, req.tenant.id);
  if (!row) return res.status(404).json({ error: 'Automação não encontrada.' });
  const enable = !row.enabled;
  if (enable) {
    const active = automationQueries.countActive.get(req.tenant.id)?.n || 0;
    if (active >= automationLimit(req)) {
      return res.status(403).json({
        error: `Seu plano permite até ${automationLimit(req)} automações ativas. Pause uma automação ou faça upgrade.`,
      });
    }
  }
  automationQueries.setEnabled.run({ id: row.id, tenant_id: req.tenant.id, enabled: enable ? 1 : 0 });
  res.json({ ok: true, enabled: enable });
});

apiRouter.post('/api/automations/:id/duplicate', requireAuth, requireCsrf, (req, res) => {
  const row = automationQueries.byId.get(req.params.id, req.tenant.id);
  if (!row) return res.status(404).json({ error: 'Automação não encontrada.' });
  const id = 'aut_' + randomUUID().replace(/-/g, '').slice(0, 24);
  // Cópia entra PAUSADA — nunca estoura o limite de ativas nem duplica disparos.
  automationQueries.insert.run({
    id,
    tenant_id: req.tenant.id,
    name: `${row.name} (cópia)`.slice(0, 80),
    description: row.description,
    enabled: 0,
    trigger_type: row.trigger_type,
    trigger_config_json: row.trigger_config_json,
    conditions_json: row.conditions_json,
    actions_json: row.actions_json,
    cooldown_seconds: row.cooldown_seconds,
  });
  res.status(201).json(serializeAutomation(automationQueries.byId.get(id, req.tenant.id)));
});

apiRouter.delete('/api/automations/:id', requireAuth, requireCsrf, (req, res) => {
  const row = automationQueries.byId.get(req.params.id, req.tenant.id);
  if (!row) return res.status(404).json({ error: 'Automação não encontrada.' });
  // Deleção segura: cancela jobs pendentes e remove histórico junto.
  db.prepare(`
    UPDATE automation_jobs SET status = 'cancelled', finished_at = datetime('now')
    WHERE automation_id = ? AND tenant_id = ? AND status IN ('pending', 'retry', 'processing')
  `).run(row.id, req.tenant.id);
  db.prepare(`
    DELETE FROM automation_run_actions WHERE run_id IN
      (SELECT id FROM automation_runs WHERE automation_id = ? AND tenant_id = ?)
  `).run(row.id, req.tenant.id);
  automationRunQueries.deleteRunsByAutomation.run(row.id, req.tenant.id);
  automationQueries.delete.run(row.id, req.tenant.id);
  res.json({ ok: true });
});

// Teste em DRY RUN — nunca executa efeitos reais nem envia mensagem. Envio
// real de teste não é suportado (por segurança, dry_run é obrigatório).
apiRouter.post('/api/automations/:id/test', requireAuth, requireCsrf, sandboxLimiter, (req, res) => {
  const row = automationQueries.byId.get(req.params.id, req.tenant.id);
  if (!row) return res.status(404).json({ error: 'Automação não encontrada.' });
  if (req.body?.dry_run === false) {
    return res.status(400).json({ error: 'Teste com envio real não é suportado — use dry_run: true.' });
  }
  const t = decryptTenant(tenantQueries.byId.get(req.tenant.id));
  res.json(dryRunAutomation({
    tenant: t,
    automation: row,
    contactId: req.body?.contact_id != null ? Number(req.body.contact_id) : null,
  }));
});

apiRouter.get('/api/automations/:id/runs', requireAuth, (req, res) => {
  const row = automationQueries.byId.get(req.params.id, req.tenant.id);
  if (!row) return res.status(404).json({ error: 'Automação não encontrada.' });
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const page = Math.max(1, Number(req.query.page) || 1);
  const statusFilter = ['success', 'skipped', 'failed'].includes(req.query.status) ? req.query.status : null;
  let runs = automationRunQueries.listByAutomation.all(req.tenant.id, row.id, limit, (page - 1) * limit);
  if (statusFilter) runs = runs.filter((r) => r.status === statusFilter);
  res.json({
    page,
    limit,
    total: automationRunQueries.countByAutomation.get(req.tenant.id, row.id)?.n || 0,
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      started_at: r.started_at,
      finished_at: r.finished_at,
      error_summary: r.error_summary,
      actions: automationRunQueries.actionsByRun.all(r.id).map((a) => ({
        index: a.action_index,
        type: a.action_type,
        status: a.status,
        error: a.error_summary,
      })),
    })),
  });
});

// --- Estatisticas do dashboard ---
apiRouter.get('/api/stats', requireAuth, (req, res) => {
  const tid = req.tenant.id;

  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS total_contatos,
         SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS contatos_hoje,
         SUM(CASE WHEN buy_intent = 'alta' THEN 1 ELSE 0 END) AS intencao_alta,
         SUM(CASE WHEN stage = 'fechado' THEN 1 ELSE 0 END) AS fechados,
         SUM(CASE WHEN needs_human = 1 THEN 1 ELSE 0 END) AS aguardando_humano,
         SUM(CASE WHEN handoff_status = 'waiting' THEN 1 ELSE 0 END) AS handoff_waiting,
         SUM(CASE WHEN handoff_status = 'in_progress' THEN 1 ELSE 0 END) AS handoff_in_progress
       FROM contacts WHERE tenant_id = ?`
    )
    .get(tid);

  // Status pago: aceita as duas grafias que já convivem no banco ('pago'
  // do fluxo normal e 'paid' herdado); receita usa COALESCE(amount,
  // total_cents/100) porque vendas antigas gravaram só amount e as novas
  // só total_cents. Sem isso, o relatório de valor da IA ficava zerado.
  const paidSalesStats = db
    .prepare(
      `SELECT
         COUNT(*) AS total_vendas,
         COALESCE(SUM(COALESCE(amount, total_cents / 100.0)), 0) AS receita_total
       FROM sales WHERE tenant_id = ? AND status IN ('pago', 'paid')`
    )
    .get(tid);

  const totalMsgs = messageQueries.countByTenant.get(tid).n;

  const stageRows = db
    .prepare(`SELECT stage, COUNT(*) AS n FROM contacts WHERE tenant_id = ? GROUP BY stage`)
    .all(tid);
  const stageMap = Object.fromEntries(stageRows.map((r) => [r.stage, r.n]));
  const porEtapa = STAGES.map((s) => ({
    id: s.id,
    label: s.label,
    color: s.color,
    total: stageMap[s.id] || 0,
  }));

  const series = db
    .prepare(
      `SELECT date(created_at) AS dia, COUNT(*) AS n
       FROM contacts
       WHERE tenant_id = ? AND created_at >= date('now', '-13 days')
       GROUP BY dia ORDER BY dia`
    )
    .all(tid);
  const serieMap = Object.fromEntries(series.map((r) => [r.dia, r.n]));
  const porDia = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    porDia.push({ dia: iso, total: serieMap[iso] || 0 });
  }

  const total = totals.total_contatos || 0;
  const fechados = totals.fechados || 0;
  const salesStats = saleQueries.statsByTenant.get(tid) || {};
  const paidSales = salesStats.pagos || 0;

  // --- Painel de dinheiro parado (Fase 9) ---
  const orcamentosSemResposta = db.prepare(`
    SELECT COUNT(*) AS n FROM contacts
    WHERE tenant_id = ? AND stage = 'orcamento' AND handoff_status = 'none'
      AND last_message_at < datetime('now', '-24 hours')
  `).get(tid).n;

  const clientesSemRetorno = db.prepare(`
    SELECT COUNT(*) AS n FROM contacts c
    WHERE c.tenant_id = ? AND c.handoff_status = 'none' AND c.stage NOT IN ('fechado', 'perdido')
      AND c.last_message_at < datetime('now', '-24 hours')
      AND (SELECT role FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) = 'assistant'
  `).get(tid).n;

  const fretesSemCompra = freteCalculoQueries.semCompraCount.get(tid).n;

  // Tempo médio de resposta (últimos 7 dias) — média do tempo entre a
  // mensagem do cliente e a próxima resposta (IA ou humano) no mesmo contato.
  const tempoRespostaRow = db.prepare(`
    WITH msgs_recentes AS (
      SELECT m.id, m.contact_id, m.created_at
      FROM messages m
      JOIN contacts c ON c.id = m.contact_id
      WHERE c.tenant_id = ? AND m.role = 'user' AND m.created_at >= datetime('now', '-7 days')
    )
    SELECT AVG((julianday(reply_at) - julianday(r.created_at)) * 86400) AS avg_seconds
    FROM (
      SELECT r.created_at,
        (SELECT MIN(m2.created_at) FROM messages m2 WHERE m2.contact_id = r.contact_id AND m2.role = 'assistant' AND m2.created_at > r.created_at) AS reply_at
      FROM msgs_recentes r
    ) r
    WHERE reply_at IS NOT NULL
  `).get(tid);
  const tempoMedioRespostaMin = tempoRespostaRow?.avg_seconds != null ? Math.round(tempoRespostaRow.avg_seconds / 60) : null;

  // Vendas por tipo de cliente (PF/PJ) — duas consultas separadas (contatos e
  // vendas) para não multiplicar contagem quando um contato tem mais de uma venda.
  const contatosPorTipo = db.prepare(`
    SELECT COALESCE(tipo_cliente, 'indefinido') AS tipo, COUNT(*) AS n
    FROM contacts WHERE tenant_id = ? GROUP BY tipo
  `).all(tid);
  const vendasPorTipo = db.prepare(`
    SELECT COALESCE(c.tipo_cliente, 'indefinido') AS tipo,
      COALESCE(SUM(CASE WHEN s.status IN ('pago','paid') THEN COALESCE(s.total_cents, CAST(s.amount * 100 AS INTEGER)) ELSE 0 END), 0) AS valor_cents
    FROM sales s JOIN contacts c ON c.id = s.contact_id
    WHERE s.tenant_id = ? GROUP BY tipo
  `).all(tid);
  const valorPorTipoMap = Object.fromEntries(vendasPorTipo.map((r) => [r.tipo, r.valor_cents]));
  const vendasPorTipoCliente = { pf: { n: 0, valor_cents: 0 }, pj: { n: 0, valor_cents: 0 }, indefinido: { n: 0, valor_cents: 0 } };
  for (const r of contatosPorTipo) {
    vendasPorTipoCliente[r.tipo] = { n: r.n, valor_cents: valorPorTipoMap[r.tipo] || 0 };
  }

  // Cadastros incompletos — contato já avançou no funil (orçamento em diante)
  // mas ainda não tem e-mail nem endereço registrados.
  const cadastrosIncompletos = db.prepare(`
    SELECT COUNT(*) AS n FROM contacts
    WHERE tenant_id = ? AND stage IN ('orcamento', 'negociacao', 'checkout', 'fechado')
      AND (email IS NULL OR email = '') AND (endereco IS NULL OR endereco = '')
  `).get(tid).n;

  res.json({
    total_contatos: total,
    contatos_hoje: totals.contatos_hoje || 0,
    total_mensagens: totalMsgs,
    intencao_alta: totals.intencao_alta || 0,
    fechados,
    sales_total: salesStats.total_sales || 0,
    sales_checkout_enviado: salesStats.checkout_enviado || 0,
    sales_pagos: paidSales,
    sales_perdidos: salesStats.perdidos || 0,
    sales_receita_paga_cents: salesStats.receita_paga_cents || 0,
    sales_receita_em_aberto_cents: salesStats.receita_em_aberto_cents || 0,
    aguardando_humano: totals.aguardando_humano || 0,
    aguardando_humano_v2: totals.handoff_waiting || 0,
    em_atendimento_humano: totals.handoff_in_progress || 0,
    taxa_conversao: total ? Math.round((fechados / total) * 100) : 0,
    receita_total: paidSalesStats.receita_total || 0,
    vendas_reais: paidSalesStats.total_vendas || 0,
    por_etapa: porEtapa,
    por_dia: porDia,
    dinheiro_parado: {
      vendas_paradas_cents: salesStats.receita_em_aberto_cents || 0,
      orcamentos_sem_resposta: orcamentosSemResposta,
      aguardando_pagamento: salesStats.checkout_enviado || 0,
      fretes_sem_compra: fretesSemCompra,
      clientes_sem_retorno: clientesSemRetorno,
      precisa_humano: totals.handoff_waiting || 0,
      cadastros_incompletos: cadastrosIncompletos,
    },
    tempo_medio_resposta_min: tempoMedioRespostaMin,
    vendas_por_tipo_cliente: vendasPorTipoCliente,
  });
});

// Métricas por origem do lead (Fase 8) — de onde vêm os atendimentos e quais
// canais realmente viram venda.
const LEAD_SOURCE_LABEL = {
  whatsapp_direto: 'WhatsApp direto',
  instagram_facebook: 'Instagram/Facebook',
  meta_ads: 'Anúncio (Meta Ads)',
  mercado_livre: 'Mercado Livre',
  site: 'Site',
  indicacao: 'Indicação',
  google: 'Google',
  outro: 'Outro',
};

apiRouter.get('/api/stats/origem', requireAuth, (req, res) => {
  const tid = req.tenant.id;

  const porContato = db.prepare(`
    SELECT
      lead_source,
      COUNT(*) AS atendimentos,
      SUM(CASE WHEN stage IN ('orcamento','negociacao','checkout','fechado','perdido') THEN 1 ELSE 0 END) AS orcamentos,
      SUM(CASE WHEN stage = 'fechado' THEN 1 ELSE 0 END) AS vendas_concluidas,
      SUM(CASE WHEN stage = 'perdido' THEN 1 ELSE 0 END) AS vendas_perdidas
    FROM contacts
    WHERE tenant_id = ?
    GROUP BY lead_source
  `).all(tid);

  // Consulta separada (não um JOIN com a de cima) para não multiplicar as
  // contagens de contatos quando um contato tem mais de uma venda.
  const porVenda = db.prepare(`
    SELECT
      c.lead_source,
      COALESCE(SUM(CASE WHEN s.status IN ('pago','paid') THEN COALESCE(s.total_cents, CAST(s.amount * 100 AS INTEGER)) ELSE 0 END), 0) AS valor_vendido_cents,
      COALESCE(SUM(CASE WHEN s.status IN ('checkout_enviado','aguardando_pagamento','pending') THEN COALESCE(s.total_cents, CAST(s.amount * 100 AS INTEGER)) ELSE 0 END), 0) AS valor_parado_cents,
      SUM(CASE WHEN s.status IN ('checkout_enviado','aguardando_pagamento','pending') THEN 1 ELSE 0 END) AS pagamentos_iniciados
    FROM sales s
    JOIN contacts c ON c.id = s.contact_id
    WHERE s.tenant_id = ?
    GROUP BY c.lead_source
  `).all(tid);
  const vendaMap = Object.fromEntries(porVenda.map((r) => [r.lead_source, r]));

  const result = porContato.map((r) => {
    const v = vendaMap[r.lead_source] || {};
    const atendimentos = r.atendimentos || 0;
    const vendasConcluidas = r.vendas_concluidas || 0;
    return {
      lead_source: r.lead_source,
      label: LEAD_SOURCE_LABEL[r.lead_source] || r.lead_source,
      atendimentos,
      orcamentos: r.orcamentos || 0,
      pagamentos_iniciados: v.pagamentos_iniciados || 0,
      vendas_concluidas: vendasConcluidas,
      vendas_perdidas: r.vendas_perdidas || 0,
      valor_vendido_cents: v.valor_vendido_cents || 0,
      valor_parado_cents: v.valor_parado_cents || 0,
      taxa_conversao: atendimentos ? Math.round((vendasConcluidas / atendimentos) * 100) : 0,
    };
  }).sort((a, b) => b.atendimentos - a.atendimentos);

  res.json(result);
});

// --- Vendas / pedidos ---
function formatSale(row) {
  let items = [];
  try { items = JSON.parse(row.items_json || '[]'); } catch { items = []; }
  let deliveryAddress = null;
  try { if (row.delivery_address) deliveryAddress = JSON.parse(row.delivery_address); } catch { deliveryAddress = null; }
  return {
    id: row.id,
    phone: row.wa_phone,
    name: row.name,
    status: row.status,
    items,
    total_cents: row.total_cents || 0,
    checkout_url: row.checkout_url || '',
    payment_provider: row.payment_provider || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    paid_at: row.paid_at,
    summary: row.summary || '',
    order_type: row.order_type || null,
    delivery_address: deliveryAddress,
    table_number: row.table_number || null,
    estimated_minutes: row.estimated_minutes || null,
    delivery_fee: row.delivery_fee || 0,
    comanda_number: row.comanda_number || null,
    // Melhor Envio — etiqueta gerada / erro. Consumido pelo botão
    // "Gerar etiqueta" no Painel de Vendas (public/js/pages/vendas.js).
    me_order_id: row.me_order_id || null,
    me_tracking_code: row.me_tracking_code || null,
    me_label_url: row.me_label_url || null,
    me_label_status: row.me_label_status || 'pendente',
    me_label_error: row.me_label_error || null,
    me_tracking_sent_at: row.me_tracking_sent_at || null,
  };
}

apiRouter.get('/api/sales', requireAuth, (req, res) => {
  const wantsPaged = req.query.limit !== undefined || req.query.cursor !== undefined || req.query.page_mode === '1';
  if (!wantsPaged) {
    return res.json(saleQueries.byTenantRecent.all(req.tenant.id).map(formatSale));
  }
  const limit = clampLimit(req.query.limit);
  const cursor = decodeCursor(req.query.cursor);
  const validStatuses = ['rascunho', 'checkout_enviado', 'aguardando_pagamento', 'pago', 'paid', 'perdido', 'cancelled', 'rejected'];
  const status = validStatuses.includes(req.query.status) ? req.query.status : null;
  const from_dt = req.query.from && !Number.isNaN(Date.parse(req.query.from)) ? String(req.query.from) : null;
  const to_dt = req.query.to && !Number.isNaN(Date.parse(req.query.to)) ? String(req.query.to) : null;

  const rows = saleQueries.byTenantPage.all({
    tenant_id: req.tenant.id,
    status,
    from_dt,
    to_dt,
    since_t: cursor?.t || null,
    since_id: cursor?.id || null,
    limit_plus_one: limit + 1,
  });

  const { items, next_cursor, has_more } = paginate(rows, limit, (r) => ({
    t: r.updated_at, id: r.id,
  }));
  res.json({
    items: items.map(formatSale),
    next_cursor,
    has_more,
    server_time: new Date().toISOString(),
  });
});

apiRouter.post('/api/sales/:id/status', requireAuth, requireCsrf, (req, res) => {
  const status = String(req.body?.status || '');
  if (!['rascunho', 'checkout_enviado', 'aguardando_pagamento', 'pago', 'perdido'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido.' });
  }
  // sales.id é texto (hex/uuid) — Number(id) sempre virava NaN aqui, fazendo
  // esta rota nunca encontrar a venda. Corrigido: usa o id como veio na URL.
  const saleId = req.params.id;
  const sale = saleQueries.byId.get(saleId);
  if (!sale || sale.tenant_id !== req.tenant.id) return res.status(404).json({ error: 'Venda não encontrada.' });

  const info = saleQueries.updateStatus.run({
    id: saleId,
    tenant_id: req.tenant.id,
    status,
  });
  if (!info.changes) return res.status(404).json({ error: 'Venda não encontrada.' });

  // Cancelou/perdeu uma venda que tinha estoque reservado: devolve.
  if (status === 'perdido') restoreStockForSale(req.tenant.id, sale);

  // Automações: pagamento manual dispara sale_paid; pago/perdido invalida
  // lembretes pendentes daquela venda (ex.: "checkout sem pagamento").
  if (status === 'pago' && sale.status !== 'pago') {
    cancelPendingJobsForSale(req.tenant.id, saleId, sale.contact_id);
    emitDomainEvent({
      tenantId: req.tenant.id,
      type: 'sale_paid',
      entityType: 'sale',
      entityId: saleId,
      payload: { amount: sale.total_cents ? sale.total_cents / 100 : (sale.amount || 0) },
    });
  } else if (status === 'perdido') {
    cancelPendingJobsForSale(req.tenant.id, saleId, null);
  }

  res.json({ ok: true });
});

// --- Melhor Envio: preferência de envio automático do rastreio no WhatsApp ---
// Persistido em business_json.me_auto_send_tracking (via normalizeBusiness).
// Consumido no fluxo POST /api/sales/:id/etiqueta após o cart+checkout sucederem.
apiRouter.post('/api/settings/melhor-envio/auto-tracking', requireAuth, requireCsrf, (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const biz = normalizeBusiness(req.tenant.business_json);
  biz.me_auto_send_tracking = enabled;
  saveBusinessJson(req.tenant.id, biz);
  res.json({ ok: true, enabled });
});

// --- Melhor Envio: diagnóstico do token (que ele consegue fazer) ---
//
// Retorna se o token do lojista tem escopos suficientes para calcular frete
// e/ou gerar etiqueta. Usado pela UI (settings/integrações) para mostrar
// badge "Etiquetas disponíveis" ou "Só cálculo — reautorize para etiqueta".
// Não faz chamada externa; lê os scopes direto do JWT do token.
apiRouter.get('/api/settings/melhor-envio/status', requireAuth, (req, res) => {
  const t = decryptTenant(tenantQueries.byId.get(req.tenant.id));
  const business = normalizeBusiness(t.business_json);
  const meToken = t.melhor_envio_token || config.mePlatformToken;
  if (!meToken) {
    return res.json({
      connected: false,
      source: null,
      scopes: [],
      can_calculate: false,
      can_generate_label: false,
      missing_for_label: ME_REQUIRED_SCOPES_LABEL,
      auto_send_tracking: business.me_auto_send_tracking,
    });
  }
  const caps = meTokenCapabilities(meToken);
  res.json({
    connected: true,
    source: t.melhor_envio_token ? 'tenant' : 'platform',
    ...caps,
    auto_send_tracking: business.me_auto_send_tracking,
  });
});

// --- Melhor Envio: gerar etiqueta / rastreio da venda ---
//
// Requer que o lojista tenha:
//   - Token do Melhor Envio configurado (escopos shipping-generate, shipping-checkout e shipping-print)
//   - CEP de origem preenchido em Configurações
//   - Endereço de entrega da venda (delivery_address JSON)
//   - Saldo Melhor Envio (a checkout debita da conta do lojista)
//
// O orquestrador src/melhorenvio.js#generateLabel encadeia cart → checkout →
// print e persiste o resultado (me_order_id, me_tracking_code, me_label_url,
// me_label_status) na sale. Falhas conhecidas viram me_label_error sem lançar.
apiRouter.post('/api/sales/:id/etiqueta', requireAuth, requireCsrf, async (req, res) => {
  const saleId = req.params.id;
  const sale = saleQueries.byId.get(saleId);
  if (!sale || sale.tenant_id !== req.tenant.id) {
    return res.status(404).json({ error: 'Venda não encontrada.' });
  }
  if (sale.me_label_status === 'gerada' && sale.me_label_url) {
    // Idempotente: já tem etiqueta gerada, devolve os dados persistidos.
    return res.json({
      ok: true,
      already_generated: true,
      tracking: sale.me_tracking_code,
      orderId: sale.me_order_id,
      labelUrl: sale.me_label_url,
    });
  }

  const t = decryptTenant(tenantQueries.byId.get(req.tenant.id));
  const meToken = t.melhor_envio_token || config.mePlatformToken;
  if (!meToken) return res.status(400).json({ error: 'Token do Melhor Envio não configurado. Configure na aba Integrações.' });

  // Pré-check dos escopos: token gerado antes só tinha 'shipping-calculate'.
  // Pra etiqueta precisa 'shipping-generate' + 'shipping-checkout' + 'shipping-print'.
  // Sem esse check a gente só descobriria depois de tentar chamar /me/cart (custa
  // uma request à Meta e pode retornar erro obscuro).
  const caps = meTokenCapabilities(meToken);
  if (!caps.can_generate_label) {
    return res.status(422).json({
      error: 'Token do Melhor Envio sem permissão para gerar etiqueta.',
      code: 'scope_missing',
      missing_scopes: caps.missing_for_label.length ? caps.missing_for_label : ME_REQUIRED_SCOPES_LABEL,
      hint: 'Vá em melhorenvio.com.br → Configurações → Tokens, gere um novo token com os escopos shipping-generate, shipping-checkout e shipping-print marcados (mantenha shipping-calculate se já usa o cálculo de frete), e cole na aba Integrações.',
    });
  }

  const business = normalizeBusiness(t.business_json);
  const cepOrigem = (business.cep_origem || t.cep_origem || '').replace(/\D/g, '');
  if (!cepOrigem) return res.status(400).json({ error: 'CEP de origem não configurado. Preencha em Configurações.' });

  const delivery = sale.delivery_address ? JSON.parse(sale.delivery_address) : null;
  if (!delivery?.cep) return res.status(400).json({ error: 'Endereço de entrega da venda incompleto (falta CEP).' });

  const contact = contactQueries.byId.get(sale.contact_id);
  if (!contact) return res.status(400).json({ error: 'Contato da venda não encontrado.' });

  const items = sale.items_json ? JSON.parse(sale.items_json) : [];
  if (!items.length) return res.status(400).json({ error: 'Venda sem itens — não há o que enviar.' });

  const labelData = {
    // TODO: quando o front deixar o lojista escolher o serviço (PAC/SEDEX/etc),
    // aceitar req.body.serviceId. Por ora usa o service passado ou default 1 (PAC).
    serviceId: Number(req.body?.serviceId) || 1,
    from: {
      name: business.nome_loja || t.email,
      phone: (business.telefone_lojista || '').replace(/\D/g, ''),
      email: t.email,
      document: (business.cnpj_cpf || '').replace(/\D/g, ''),
      address: business.endereco || '',
      city: business.cidade || '',
      state_abbr: (business.uf || '').toUpperCase(),
      postal_code: cepOrigem,
      country_id: 'BR',
      complement: business.complemento || '',
      number: business.numero || '',
      district: business.bairro || '',
    },
    to: {
      name: contact.name || 'Cliente',
      phone: (contact.wa_phone || '').replace(/\D/g, ''),
      email: contact.email || '',
      document: (contact.cpf_cnpj || '').replace(/\D/g, ''),
      address: delivery.rua || '',
      city: delivery.cidade || '',
      state_abbr: (delivery.uf || '').toUpperCase(),
      postal_code: delivery.cep.replace(/\D/g, ''),
      country_id: 'BR',
      complement: delivery.complemento || '',
      number: delivery.numero || '',
      district: delivery.bairro || '',
    },
    products: items.map((it) => ({
      name: it.titulo || it.nome || 'Produto',
      quantity: it.quantidade || 1,
      unitary_value: Number(it.valor_unitario || it.preco || 0),
    })),
    volumes: {
      height: Number(business.altura_padrao_cm) || 10,
      width: Number(business.largura_padrao_cm) || 15,
      length: Number(business.comprimento_padrao_cm) || 20,
      weight: Number(business.peso_padrao_kg) || 0.5,
    },
  };

  try {
    const result = await generateMeLabel(meToken, sale, labelData);
    if (!result.ok) {
      return res.status(502).json({ error: result.error, step: result.step, orderId: result.orderId });
    }
    // Envio automático do rastreio no WhatsApp (opt-in em business.me_auto_send_tracking).
    // Não bloqueia a resposta se falhar — o lojista ainda tem o link do PDF.
    let tracking_sent = false;
    if (business.me_auto_send_tracking) {
      tracking_sent = await maybeSendTracking(t, sale.id).catch((e) => {
        console.warn('[Melhor Envio] tracking WhatsApp falhou (auto):', e.message);
        return false;
      });
    }
    res.json({ ok: true, ...result, tracking_sent });
  } catch (err) {
    // Falha inesperada — não passou pelos catches internos do generateLabel.
    console.error('[Melhor Envio etiqueta]', err);
    res.status(500).json({ error: 'Falha ao gerar etiqueta: ' + err.message });
  }
});

// Envio manual do rastreio: o lojista clica "Avisar cliente" no Painel de
// Vendas mesmo com auto_send desligado. Idempotente — se me_tracking_sent_at
// já estiver preenchido, retorna already_sent sem reenviar.
apiRouter.post('/api/sales/:id/etiqueta/notify', requireAuth, requireCsrf, async (req, res) => {
  const saleId = req.params.id;
  const sale = saleQueries.byId.get(saleId);
  if (!sale || sale.tenant_id !== req.tenant.id) return res.status(404).json({ error: 'Venda não encontrada.' });
  if (sale.me_label_status !== 'gerada' || !sale.me_tracking_code) {
    return res.status(400).json({ error: 'Gere a etiqueta antes de avisar o cliente.' });
  }
  const t = decryptTenant(tenantQueries.byId.get(req.tenant.id));
  const sent = await maybeSendTracking(t, sale.id).catch((e) => {
    console.error('[Melhor Envio notify manual]', e);
    return false;
  });
  if (!sent) {
    // sale já foi atualizada (mesmo em ok) — devolve o estado atual pro front decidir
    const fresh = saleQueries.byId.get(saleId);
    if (fresh.me_tracking_sent_at) return res.json({ ok: true, already_sent: true, at: fresh.me_tracking_sent_at });
    return res.status(502).json({ error: 'Falha ao enviar mensagem ao cliente.' });
  }
  const fresh = saleQueries.byId.get(saleId);
  res.json({ ok: true, sent_at: fresh.me_tracking_sent_at });
});

// Helper compartilhado pelo auto-send e pelo endpoint manual.
// Retorna true se enviou (ou já tinha enviado antes). false só em erro.
async function maybeSendTracking(tenant, saleId) {
  const sale = saleQueries.byId.get(saleId);
  if (!sale) return false;
  if (sale.me_tracking_sent_at) return true; // idempotente
  if (!sale.me_tracking_code) return false;
  const contact = contactQueries.byId.get(sale.contact_id);
  if (!contact?.wa_phone) return false;
  const business = normalizeBusiness(tenant.business_json);
  const nome = contact.name || 'olá';
  const nomeLoja = business.name || tenant.business_name || 'nossa loja';
  const msg = `Oi ${nome}! Seu pedido em ${nomeLoja} saiu para entrega 📦\n\nCódigo de rastreio: ${sale.me_tracking_code}\nAcompanhe em: https://melhorenvio.com.br/rastreio/${sale.me_tracking_code}\n\nQualquer dúvida é só chamar aqui.`;
  await sendText(tenant, contact.wa_phone, msg);
  saleQueries.setMelhorEnvioTrackingSent.run(saleId);
  return true;
}

// --- PrintNode: impressão de comandas ---
apiRouter.post('/api/settings/printnode', requireAuth, requireCsrf, (req, res) => {
  const { printnode_api_key, printnode_printer_id } = req.body || {};
  const raw = tenantQueries.byId.get(req.tenant.id);
  tenantQueries.setPrintNodeCredentials.run({
    id: req.tenant.id,
    printnode_api_key: printnode_api_key ? encryptSecret(printnode_api_key) : raw.printnode_api_key,
    printnode_printer_id: printnode_printer_id !== undefined ? (printnode_printer_id || null) : raw.printnode_printer_id,
  });
  res.json({ ok: true });
});

apiRouter.delete('/api/settings/printnode', requireAuth, requireCsrf, (req, res) => {
  tenantQueries.clearPrintNodeCredentials.run(req.tenant.id);
  res.json({ ok: true });
});

apiRouter.get('/api/printnode/printers', requireAuth, async (req, res) => {
  const t = decryptTenant(tenantQueries.byId.get(req.tenant.id));
  if (!t.printnode_api_key) return res.status(400).json({ error: 'Chave de API do PrintNode não configurada.' });
  try {
    const printers = await listPrintNodePrinters(t.printnode_api_key);
    res.json(printers);
  } catch (err) {
    console.error('[printnode printers]', err.message);
    res.status(502).json({ error: 'Erro ao consultar impressoras: ' + err.message });
  }
});

apiRouter.post('/api/sales/:id/print', requireAuth, requireCsrf, async (req, res) => {
  const t = decryptTenant(tenantQueries.byId.get(req.tenant.id));
  if (!t.printnode_api_key || !t.printnode_printer_id) {
    return res.status(400).json({ error: 'PrintNode não configurado. Configure a chave de API e impressora nas Integrações.' });
  }
  const sale = saleQueries.byId.get(req.params.id);
  if (!sale || sale.tenant_id !== req.tenant.id) return res.status(404).json({ error: 'Pedido não encontrado.' });

  // Gera número de comanda se ainda não tiver
  let comandaNum = sale.comanda_number;
  if (!comandaNum) {
    const { next_n } = saleQueries.nextComandaNumber.get(req.tenant.id);
    comandaNum = next_n;
    saleQueries.setComandaNumber.run(comandaNum, sale.id);
  }

  const saleWithComanda = { ...sale, comanda_number: comandaNum };
  try {
    const jobId = await printComanda(t.printnode_api_key, t.printnode_printer_id, saleWithComanda, req.tenant.business_name);
    res.json({ ok: true, comanda_number: comandaNum, print_job_id: jobId });
  } catch (err) {
    console.error('[printnode print]', err.message);
    res.status(502).json({ error: 'Erro ao imprimir comanda: ' + err.message });
  }
});

// --- Exportação fiscal (balancete mensal) ---
apiRouter.get('/api/sales/export/fiscal.csv', requireAuth, (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Informe os parâmetros from e to (formato YYYY-MM-DD).' });

  // Aceita YYYY-MM-DD; adiciona T00:00:00 para from e T23:59:59 para to
  const fromDt = `${from}T00:00:00`;
  const toDt   = `${to}T23:59:59`;

  const rows = saleQueries.byTenantPeriod.all(req.tenant.id, fromDt, toDt);

  const headers = [
    'ID', 'Data', 'Cliente', 'Telefone', 'Tipo', 'Status',
    'Itens', 'Taxa Entrega (R$)', 'Total (R$)', 'Pago em', 'Mesa', 'Endereço Entrega',
  ];

  const csvRows = rows.map((r) => {
    let items = [];
    try { items = JSON.parse(r.items_json || '[]'); } catch { items = []; }
    const itemsStr = items.map((i) => `${i.quantidade}x ${i.titulo} R$${(i.valor_unitario || 0).toFixed(2)}`).join(' | ');
    return [
      sanitizeCsvCell(r.id),
      sanitizeCsvCell(r.created_at),
      sanitizeCsvCell(r.contact_name || ''),
      sanitizeCsvCell(r.wa_phone || ''),
      sanitizeCsvCell(r.order_type || 'online'),
      sanitizeCsvCell(r.status),
      sanitizeCsvCell(itemsStr),
      sanitizeCsvCell(((r.delivery_fee || 0) / 100).toFixed(2)),
      sanitizeCsvCell(((r.total_cents || 0) / 100).toFixed(2)),
      sanitizeCsvCell(r.paid_at || ''),
      sanitizeCsvCell(r.table_number || ''),
      sanitizeCsvCell(r.delivery_address || ''),
    ].join(',');
  });

  const csv = [headers.join(','), ...csvRows].join('\n');
  const filename = `vendas_${from}_a_${to}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv); // BOM UTF-8 para Excel
});

// --- Insights: valor gerado pela IA + prioridades acionáveis ---
// Alimenta o "relatório de valor" (o que a IA produziu) e a "central de
// prioridades" do dashboard. Só usa dados reais do banco; a métrica fora_horario
// é uma estimativa (marcada como tal no front).
apiRouter.get('/api/insights', requireAuth, (req, res) => {
  const tid = req.tenant.id;

  const value = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM messages m JOIN contacts c ON c.id = m.contact_id
         WHERE c.tenant_id = @tid AND m.role = 'assistant') AS ia_mensagens,
      (SELECT COUNT(*) FROM contacts WHERE tenant_id = @tid) AS clientes_atendidos,
      (SELECT COUNT(*) FROM contacts WHERE tenant_id = @tid AND stage = 'fechado') AS vendas,
      (SELECT COUNT(*) FROM messages m JOIN contacts c ON c.id = m.contact_id
         WHERE c.tenant_id = @tid AND m.role = 'assistant'
           AND CAST(strftime('%H', datetime(m.created_at, '-3 hours')) AS INTEGER) NOT BETWEEN 8 AND 17
      ) AS ia_fora_horario
  `).get({ tid });

  // Prioridades acionáveis — só contatos com histórico de mensagens.
  const priorities = db.prepare(`
    SELECT
      SUM(CASE WHEN handoff_status = 'waiting'
               AND EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id) THEN 1 ELSE 0 END) AS aguardando_humano,
      SUM(CASE WHEN buy_intent = 'alta' AND stage IN ('orcamento','negociacao','checkout')
               AND EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id) THEN 1 ELSE 0 END) AS leads_quentes,
      SUM(CASE WHEN stage = 'checkout'
               AND EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id) THEN 1 ELSE 0 END) AS checkouts_pendentes,
      SUM(CASE WHEN stage IN ('duvida','orcamento','negociacao','checkout')
                AND datetime(last_message_at) < datetime('now','-24 hours')
               AND EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id) THEN 1 ELSE 0 END) AS sem_resposta_24h
    FROM contacts c WHERE c.tenant_id = ?
  `).get(tid);

  // Top leads quentes (para ação rápida) — só com histórico.
  const hotLeads = db.prepare(`
    SELECT wa_phone AS phone, name, stage, buy_intent, summary, last_message_at
    FROM contacts c
    WHERE c.tenant_id = ? AND buy_intent = 'alta' AND stage IN ('orcamento','negociacao','checkout')
      AND EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id)
    ORDER BY last_message_at DESC LIMIT 5
  `).all(tid);

  res.json({
    value: {
      ia_mensagens: value.ia_mensagens || 0,
      clientes_atendidos: value.clientes_atendidos || 0,
      vendas: value.vendas || 0,
      ia_fora_horario: value.ia_fora_horario || 0, // estimativa
    },
    priorities: {
      aguardando_humano: priorities.aguardando_humano || 0,
      leads_quentes: priorities.leads_quentes || 0,
      checkouts_pendentes: priorities.checkouts_pendentes || 0,
      sem_resposta_24h: priorities.sem_resposta_24h || 0,
    },
    hot_leads: hotLeads,
  });
});

// --- Contatos ---
function formatContactRow(c, ltvMap) {
  const doc = decryptContactDocument(c);
  const ltv = ltvMap ? ltvMap[c.id] : null;
  return {
    phone: c.wa_phone,
    name: c.name,
    stage: c.stage,
    buy_intent: c.buy_intent,
    summary: c.summary,
    needs_human: Boolean(c.needs_human),
    handoff_status: c.handoff_status || 'none',
    handoff_reason: c.handoff_reason || null,
    handoff_requested_at: c.handoff_requested_at || null,
    last_message_at: c.last_message_at,
    lead_source: c.lead_source || 'whatsapp_direto',
    tipo_cliente: c.tipo_cliente || null,
    cpf_cnpj_masked: doc ? maskDocument(doc) : null,
    prioridade: c.prioridade || 'media',
    responsavel: c.responsavel || '',
    proxima_tarefa: c.proxima_tarefa || '',
    prazo_resposta: c.prazo_resposta || null,
    tags: contactTagQueries.byContact.all(c.id).map((r) => r.tag),
    cliente_desde: c.created_at,
    compras_pagas: ltv ? ltv.compras : 0,
    total_gasto_cents: ltv ? ltv.total_gasto_cents || 0 : 0,
    ultima_compra_at: ltv ? ltv.ultima_compra_at : null,
    archived: Boolean(c.archived),
  };
}

// GET /api/contacts — paginado por cursor (last_message_at DESC, id DESC).
// Compatibilidade: sem `limit` nem `cursor`, devolve o formato antigo (array
// puro) para os callers atuais do dashboard; com qualquer um deles, devolve
// o envelope `{items, next_cursor, has_more}`. Filtros de servidor: q, stage,
// tag, archived, priority, handoff_status, lead_source.
apiRouter.get('/api/contacts', requireAuth, (req, res) => {
  const wantsPaged = req.query.limit !== undefined || req.query.cursor !== undefined || req.query.page_mode === '1';
  const tenantId = req.tenant.id;
  const ltvMap = Object.fromEntries(saleQueries.ltvByTenant.all(tenantId).map((r) => [r.contact_id, r]));

  if (!wantsPaged) {
    const rows = contactQueries.listByTenant.all(tenantId);
    return res.json(rows.map((c) => formatContactRow(c, ltvMap)));
  }

  const limit = clampLimit(req.query.limit);
  const cursor = decodeCursor(req.query.cursor);
  const archived = req.query.archived === '1' || req.query.archived === 'true';
  const q = String(req.query.q || '').trim().toLowerCase();
  const stage = STAGE_IDS.includes(req.query.stage) ? req.query.stage : null;
  const handoffStatus = ['none', 'waiting', 'in_progress'].includes(req.query.handoff_status) ? req.query.handoff_status : null;
  const priority = ['baixa', 'media', 'alta'].includes(req.query.priority) ? req.query.priority : null;
  const leadSource = req.query.lead_source ? String(req.query.lead_source).slice(0, 40) : null;
  const tag = req.query.tag ? String(req.query.tag).slice(0, 40) : null;

  const params = {
    tenant_id: tenantId,
    since_t: cursor?.t || null,
    since_id: cursor?.id || 0,
    limit_plus_one: limit + 1,
  };
  const rows = (archived
    ? contactQueries.listArchivedByTenantPage.all(params)
    : contactQueries.listByTenantPage.all(params))
    // Filtros de servidor "pós-índice" — para as combinações raras. Índices
    // compostos cobrem (archived, stage, handoff) sozinhos; filtros mais
    // exóticos são aplicados aqui para não explodir a matriz de queries.
    .filter((c) => (!stage || c.stage === stage))
    .filter((c) => (!handoffStatus || (c.handoff_status || 'none') === handoffStatus))
    .filter((c) => (!priority || (c.prioridade || 'media') === priority))
    .filter((c) => (!leadSource || c.lead_source === leadSource))
    .filter((c) => {
      if (!q) return true;
      const haystack = `${c.name || ''} ${c.wa_phone} ${c.summary || ''} ${c.nome_fantasia || ''} ${c.razao_social || ''} ${c.email || ''}`.toLowerCase();
      return haystack.includes(q);
    })
    .filter((c) => {
      if (!tag) return true;
      const tags = contactTagQueries.byContact.all(c.id).map((r) => r.tag);
      return tags.includes(tag);
    });

  const { items, next_cursor, has_more } = paginate(rows, limit, (r) => ({
    t: archived ? r.archived_at : r.last_message_at, id: r.id,
  }));
  res.json({
    items: items.map((c) => formatContactRow(c, ltvMap)),
    next_cursor,
    has_more,
    server_time: new Date().toISOString(),
  });
});

// GET /api/contacts/changes?since=<ISO> — refresh incremental.
// Devolve só contatos alterados desde `since`, para o dashboard atualizar
// caches locais sem baixar toda a lista de novo. Sem dados sensíveis:
// mesmo formato de formatContactRow (documento continua mascarado).
apiRouter.get('/api/contacts/changes', requireAuth, (req, res) => {
  const since = String(req.query.since || '').trim();
  if (!since || Number.isNaN(Date.parse(since))) {
    return res.status(400).json({ error: 'since_invalido' });
  }
  const limit = clampLimit(req.query.limit);
  const tenantId = req.tenant.id;
  const ltvMap = Object.fromEntries(saleQueries.ltvByTenant.all(tenantId).map((r) => [r.contact_id, r]));
  const rows = contactQueries.listChangedSince.all({ tenant_id: tenantId, since, limit });
  res.json({
    items: rows.map((c) => formatContactRow(c, ltvMap)),
    deleted_ids: [], // exclusão hard é rara; deleteByPhone não deixa rastro
    server_time: new Date().toISOString(),
  });
});

// Tags que indicam maior urgência/relevância comercial — usadas para escolher
// a "tag principal" exibida em cada card do Painel de Vendas.
const TAG_PRIORITY = [
  'reclamação', 'venda perdida', 'alta intenção', 'cliente quente',
  'aguardando pagamento', 'pediu desconto', 'pagamento pendente', 'envio pendente',
];
function pickMainTag(tags) {
  for (const t of TAG_PRIORITY) if (tags.includes(t)) return t;
  return tags[0] || null;
}

// Painel de Vendas — contatos agrupados por etapa, com informação comercial
// suficiente para decidir a próxima ação sem abrir a conversa (Fase 2).
apiRouter.get('/api/pipeline', requireAuth, (req, res) => {
  const tid = req.tenant.id;
  const contacts = contactQueries.listByTenant.all(tid);

  // Última venda de cada contato (qualquer status) — para valor estimado e
  // produto de interesse. Usa ROW_NUMBER em vez de JOIN direto para não
  // multiplicar contatos que têm mais de uma venda.
  const latestSales = db.prepare(`
    SELECT contact_id, status, total_cents, amount, items_json FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY created_at DESC) AS rn
      FROM sales WHERE tenant_id = ?
    ) WHERE rn = 1
  `).all(tid);
  const saleMap = Object.fromEntries(latestSales.map((s) => [s.contact_id, s]));
  const ltvMap = Object.fromEntries(saleQueries.ltvByTenant.all(tid).map((r) => [r.contact_id, r]));
  const OPEN_SALE_STATUS = ['checkout_enviado', 'aguardando_pagamento', 'pending'];

  const columns = Object.fromEntries(STAGE_IDS.map((id) => [id, []]));
  for (const c of contacts) {
    const sale = saleMap[c.id];
    let produtoInteresse = '';
    if (sale?.items_json) {
      try { produtoInteresse = JSON.parse(sale.items_json).map((i) => i.titulo).filter(Boolean).join(', '); } catch { /* ignore */ }
    }
    const valorCents = sale ? (sale.total_cents || Math.round((sale.amount || 0) * 100)) : 0;
    const tags = contactTagQueries.byContact.all(c.id).map((r) => r.tag);

    const card = {
      phone: c.wa_phone,
      name: c.name || c.wa_phone,
      lead_source: c.lead_source || 'whatsapp_direto',
      lead_source_label: LEAD_SOURCE_LABEL[c.lead_source] || c.lead_source || 'WhatsApp direto',
      produto_interesse: produtoInteresse,
      valor_cents: valorCents,
      valor_parado_cents: sale && OPEN_SALE_STATUS.includes(sale.status) ? valorCents : 0,
      tags,
      main_tag: pickMainTag(tags),
      needs_human: Boolean(c.needs_human),
      handoff_status: c.handoff_status || 'none',
      last_message_at: c.last_message_at,
      prioridade: c.prioridade || 'media',
      responsavel: c.responsavel || '',
      proxima_tarefa: c.proxima_tarefa || '',
      compras_pagas: ltvMap[c.id] ? ltvMap[c.id].compras : 0,
      total_gasto_cents: ltvMap[c.id] ? ltvMap[c.id].total_gasto_cents || 0 : 0,
    };
    if (columns[c.stage]) columns[c.stage].push(card);
  }

  res.json({ stages: STAGES, columns });
});

// Move um contato manualmente entre etapas do Painel de Vendas — até aqui só
// a IA classificava a etapa; isto dá controle manual ao lojista (Fase 2).
apiRouter.post('/api/contacts/:phone/stage', requireAuth, requireCsrf, (req, res) => {
  const { stage } = req.body || {};
  if (!STAGE_IDS.includes(stage)) return res.status(400).json({ error: 'Etapa inválida.' });
  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });
  db.prepare(`UPDATE contacts SET stage = ? WHERE id = ?`).run(stage, contact.id);
  applyStageTag(req.tenant.id, contact.id, stage);
  if (stage !== contact.stage) {
    emitDomainEvent({
      tenantId: req.tenant.id,
      type: 'stage_changed',
      entityType: 'contact',
      entityId: contact.id,
      payload: { from: contact.stage, to: stage, manual: true },
    });
  }
  res.json({ ok: true, stage });
});

// Próxima melhor ação (Fase 7) — sugestão determinística de ação + mensagem
// pronta, calculada a partir de sinais que o app já tem (etapa, tags, handoff,
// intenção de compra, tempo parado). Sem chamar IA — barato de recalcular
// toda vez que o lojista abre a conversa.
apiRouter.get('/api/contacts/:phone/next-action', requireAuth, (req, res) => {
  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });

  const openSale = db.prepare(`
    SELECT 1 FROM sales
    WHERE tenant_id = ? AND contact_id = ? AND status IN ('checkout_enviado', 'aguardando_pagamento', 'pending')
    LIMIT 1
  `).get(req.tenant.id, contact.id);

  const suggestion = suggestNextAction({
    stage: contact.stage,
    handoff_status: contact.handoff_status || 'none',
    handoff_reason: contact.handoff_reason,
    tags: contactTagQueries.byContact.all(contact.id).map((r) => r.tag),
    buy_intent: contact.buy_intent,
    last_message_at: contact.last_message_at,
    aguardandoPagamento: Boolean(openSale),
  });

  res.json(suggestion);
});

// Assumir / devolver para a IA (transbordo manual).
apiRouter.post('/api/contacts/:phone/handoff', requireAuth, requireCsrf, (req, res) => {
  const needsHuman = req.body?.needs_human ? 1 : 0;
  contactQueries.setNeedsHuman.run(needsHuman, req.tenant.id, req.params.phone);
  res.json({ ok: true });
});

// Vendas de um contato. Normaliza itens (vendas da IA usam titulo/quantidade/
// valor_unitario; vendas do MP usam title/quantity/unit_price) e garante amount
// numérico mesmo quando só total_cents foi gravado.
apiRouter.get('/api/contacts/:phone/sales', requireAuth, (req, res) => {
  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });
  const sales = saleQueries.byContact.all(contact.id);
  res.json(sales.map(s => {
    let items = [];
    try { items = JSON.parse(s.items_json || s.items || '[]'); } catch { items = []; }
    return {
      id: s.id,
      status: s.status,
      amount: s.amount ?? (s.total_cents != null ? s.total_cents / 100 : 0),
      items: items.map((i) => ({
        title: i.title ?? i.titulo ?? '',
        quantity: i.quantity ?? i.quantidade ?? 1,
        unit_price: Number(i.unit_price ?? i.valor_unitario) || 0,
      })),
      created_at: s.created_at,
      updated_at: s.updated_at,
      paid_at: s.paid_at,
    };
  }));
});

// Histórico de mensagens de um contato (visão do gerente).
//
// Compatibilidade: sem `limit`/`before_id`, devolve o comportamento antigo
// (últimas 500 em ordem cronológica ASC). Com `limit` ou `before_id`, entra
// no modo paginado — inicial pega as 50 mais recentes; ao rolar pra cima,
// front pede `?before_id=<id do topo>` e concatena. Ordem no envelope
// paginado é DESC (mais nova → mais antiga); front reverte antes de renderizar.
const stmtMsgs = db.prepare(
  `SELECT m.role, m.content, m.media_id, m.created_at,
          mm.mime AS media_mime, mm.filename AS media_filename
   FROM messages m
   LEFT JOIN message_media mm ON mm.id = m.media_id
   WHERE m.contact_id = ? ORDER BY m.id ASC LIMIT 500`
);
const stmtMsgsPage = db.prepare(
  `SELECT m.id, m.role, m.content, m.media_id, m.created_at,
          mm.mime AS media_mime, mm.filename AS media_filename
   FROM messages m
   LEFT JOIN message_media mm ON mm.id = m.media_id
   WHERE m.contact_id = @contact_id
     AND (@before_id IS NULL OR m.id < @before_id)
   ORDER BY m.id DESC
   LIMIT @limit_plus_one`
);
apiRouter.get('/api/contacts/:phone/messages', requireAuth, (req, res) => {
  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });

  const wantsPaged = req.query.limit !== undefined || req.query.before_id !== undefined || req.query.page_mode === '1';
  if (!wantsPaged) {
    return res.json(stmtMsgs.all(contact.id).map((m) => ({ ...m, content: decryptSecret(m.content) })));
  }
  const limit = clampLimit(req.query.limit);
  const beforeId = Number(req.query.before_id);
  const rows = stmtMsgsPage.all({
    contact_id: contact.id,
    before_id: Number.isFinite(beforeId) && beforeId > 0 ? beforeId : null,
    limit_plus_one: limit + 1,
  });
  const has_more = rows.length > limit;
  const items = (has_more ? rows.slice(0, limit) : rows).map((m) => ({
    ...m, content: decryptSecret(m.content),
  }));
  // next_cursor = id da mensagem mais antiga carregada (usa em ?before_id=)
  const oldest = items[items.length - 1];
  res.json({
    items,
    next_before_id: has_more && oldest ? oldest.id : null,
    has_more,
  });
});

// Apaga todo o historico de mensagens de um contato (IA recomeça do zero).
apiRouter.delete('/api/contacts/:phone/history', requireAuth, requireCsrf, (req, res) => {
  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM messages WHERE contact_id = ?').run(contact.id);
  // Campos derivados da conversa: sem histórico, não fazem sentido
  db.prepare(`UPDATE contacts SET buy_intent = 'baixa', summary = '', handoff_status = 'none', handoff_reason = NULL WHERE id = ?`).run(contact.id);
  res.json({ ok: true });
});

// Arquivar/desarquivar — some da lista principal (Contatos, Painel de
// Vendas) sem apagar nada; reversível a qualquer momento.
apiRouter.post('/api/contacts/:phone/archive', requireAuth, requireCsrf, (req, res) => {
  const info = contactQueries.archive.run(req.tenant.id, req.params.phone);
  if (!info.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

apiRouter.post('/api/contacts/:phone/unarchive', requireAuth, requireCsrf, (req, res) => {
  const info = contactQueries.unarchive.run(req.tenant.id, req.params.phone);
  if (!info.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

apiRouter.get('/api/contacts/archived', requireAuth, (req, res) => {
  const rows = contactQueries.listArchivedByTenant.all(req.tenant.id);
  res.json(rows.map((c) => ({
    phone: c.wa_phone,
    name: c.name,
    stage: c.stage,
    archived_at: c.archived_at,
  })));
});

// Exclui o contato permanentemente — em cascata apaga mensagens, notas,
// tags e cálculos de frete; vendas ficam preservadas (contact_id vira nulo)
// pra não perder histórico financeiro/contábil. Ação irreversível — o
// front exige confirmação explícita do lojista antes de chamar esta rota.
apiRouter.delete('/api/contacts/:phone', requireAuth, requireCsrf, (req, res) => {
  const info = contactQueries.deleteByPhone.run(req.tenant.id, req.params.phone);
  if (!info.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// --- Lista de espera de reposição ---
// Quando um cliente pede pra ser avisado sobre um produto [ESGOTADO], a IA
// registra o contato aqui (ver ai.js/webhook.js). O lojista vê quantas
// pessoas esperam por cada produto em Configurações e dispara o aviso
// manualmente quando repor o estoque.
apiRouter.get('/api/products/waitlist', requireAuth, (req, res) => {
  const rows = productWaitlistQueries.countsByTenant.all(req.tenant.id);
  res.json(Object.fromEntries(rows.map((r) => [r.produto_nome, r.n])));
});

apiRouter.post('/api/products/notify-restock', requireAuth, requireCsrf, async (req, res) => {
  const nome = (req.body?.nome || '').trim();
  if (!nome) return res.status(400).json({ error: 'nome_obrigatorio' });

  const waiters = productWaitlistQueries.activeByProduto.all(req.tenant.id, nome);
  if (!waiters.length) return res.json({ ok: true, enviados: 0, total: 0 });

  // Cria job persistente — worker envia em background, sem segurar a
  // requisição HTTP até a última mensagem sair (ver src/outbound-queue.js).
  const mensagem = `Boa notícia! O produto "${nome}" que você estava esperando já está disponível novamente 🎉 Quer que eu já separe o seu?`;
  const job = createOutboundJob({
    tenantId: req.tenant.id,
    type: 'restock',
    payload: { produto_nome: nome, mensagem },
    idempotencyKey: `restock:${nome}:${new Date().toISOString().slice(0, 10)}`,
    items: waiters.map((w) => ({
      contact_id: w.contact_id || null,
      destination: w.wa_phone,
      payload: { waiter_id: w.id },
    })),
  });
  // Automações: reposição avisada à lista de espera (fluxo existente).
  if (!job.duplicated) {
    emitDomainEvent({
      tenantId: req.tenant.id,
      type: 'product_restocked',
      entityType: 'product',
      entityId: nome,
      payload: { produto: nome, waiters: waiters.length },
    });
  }
  res.status(202).json({ ok: true, job_id: job.job_id, status: job.status, total: job.total, duplicated: job.duplicated || false });
});

// Sugestão de recompra — produtos com "ciclo_dias" configurado (ex: perfume
// dura ~30 dias) aparecem aqui quando o ciclo já passou desde a compra paga
// mais recente. Regra determinística, sem custo de IA (ver src/repurchase.js).
apiRouter.get('/api/repurchase-suggestions', requireAuth, (req, res) => {
  const biz = normalizeBusiness(req.tenant.business_json);
  res.json(getRepurchaseSuggestions(req.tenant.id, biz.produtos));
});

// Sinal de demanda agregada — produtos com várias perguntas recentes de
// contatos distintos (ver src/demand-signals.js). A IA marca o produto foco
// de cada mensagem via "produto_mencionado" (ai.js/webhook.js).
apiRouter.get('/api/demand-signals', requireAuth, (req, res) => {
  res.json(getDemandSignals(req.tenant.id));
});

// Radar de Receita — reúne, num único lugar, as oportunidades comerciais que
// já existem espalhadas pelo app (demanda, lista de espera, recompra) mais
// dinheiro parado com contato identificado (checkout pendente, frete sem
// compra, lead quente parado). Ver src/opportunities.js.
apiRouter.get('/api/opportunities', requireAuth, (req, res) => {
  const biz = normalizeBusiness(req.tenant.business_json);
  res.json(getRevenueRadar(req.tenant.id, biz.produtos));
});

const TEMPLATE_CATEGORIAS = ['marketing', 'utility', 'authentication'];

// Templates de mensagem do WhatsApp Business API (Elite) — cadastro manual de
// templates já aprovados no Meta Business Manager. Necessários para as
// campanhas segmentadas abaixo, que iniciam conversa fora da janela de
// atendimento de 24h (só permitido com template aprovado).
apiRouter.get('/api/whatsapp-templates', requireAuth, requirePlan('elite'), (req, res) => {
  const biz = normalizeBusiness(req.tenant.business_json);
  res.json(biz.whatsappTemplates);
});

apiRouter.post('/api/whatsapp-templates', requireAuth, requireCsrf, requirePlan('elite'), (req, res) => {
  const nome = (req.body?.nome || '').trim();
  const idioma = (req.body?.idioma || '').trim();
  const categoria = (req.body?.categoria || '').trim();
  const corpo = (req.body?.corpo || '').trim();
  if (!nome || !idioma || !corpo) return res.status(400).json({ error: 'campos_obrigatorios' });
  if (!TEMPLATE_CATEGORIAS.includes(categoria)) return res.status(400).json({ error: 'categoria_invalida' });

  const biz = normalizeBusiness(req.tenant.business_json);
  if (biz.whatsappTemplates.some((t) => t.nome === nome)) {
    return res.status(409).json({ error: 'template_ja_existe' });
  }
  biz.whatsappTemplates.push({ nome, idioma, categoria, corpo });
  saveBusinessJson(req.tenant.id, biz);
  res.json({ ok: true, templates: biz.whatsappTemplates });
});

apiRouter.delete('/api/whatsapp-templates/:nome', requireAuth, requireCsrf, requirePlan('elite'), (req, res) => {
  const biz = normalizeBusiness(req.tenant.business_json);
  const before = biz.whatsappTemplates.length;
  biz.whatsappTemplates = biz.whatsappTemplates.filter((t) => t.nome !== req.params.nome);
  if (biz.whatsappTemplates.length === before) return res.status(404).json({ error: 'not_found' });
  saveBusinessJson(req.tenant.id, biz);
  res.json({ ok: true });
});

// Campanhas segmentadas por tag (Elite) — reaproveita as tags já existentes
// (src/auto-tags.js e cadastro manual) como audiência. Envio síncrono na
// própria rota: volume esperado é de pequeno lojista (uma tag, dezenas/
// centenas de contatos), não justifica fila dedicada ainda.
apiRouter.get('/api/campaigns/tags', requireAuth, requirePlan('elite'), (req, res) => {
  res.json(contactTagQueries.byTenant.all(req.tenant.id));
});

apiRouter.get('/api/campaigns/audience', requireAuth, requirePlan('elite'), (req, res) => {
  const tag = (req.query.tag || '').trim();
  if (!tag) return res.status(400).json({ error: 'tag_obrigatoria' });
  const contatos = contactTagQueries.contactsWithPhoneByTag.all(req.tenant.id, tag);
  res.json({ total: contatos.length, amostra: contatos.slice(0, 5).map((c) => c.name || c.wa_phone) });
});

apiRouter.get('/api/campaigns', requireAuth, requirePlan('elite'), (req, res) => {
  res.json(campaignQueries.listByTenant.all(req.tenant.id));
});

// Campanhas segmentadas por tag (Elite). O disparo em si roda em background
// pela fila persistente (src/outbound-queue.js) — a rota só valida, cria o
// job e responde 202. Assim o navegador não fica preso esperando dezenas de
// mensagens saírem, e um reinício do servidor não perde o progresso.
apiRouter.post('/api/campaigns/send', requireAuth, requireCsrf, requirePlan('elite'), async (req, res) => {
  const tag = (req.body?.tag || '').trim();
  const templateNome = (req.body?.template_nome || '').trim();
  const variaveis = Array.isArray(req.body?.variaveis) ? req.body.variaveis.map(String) : [];
  const idempotencyKey = (req.body?.idempotency_key || req.headers['idempotency-key'] || '').toString().trim() || null;
  if (!tag || !templateNome) return res.status(400).json({ error: 'campos_obrigatorios' });

  const biz = normalizeBusiness(req.tenant.business_json);
  const template = biz.whatsappTemplates.find((t) => t.nome === templateNome);
  if (!template) return res.status(404).json({ error: 'template_nao_encontrado' });

  if (!config.whatsapp.phoneNumberId || !config.whatsapp.token) {
    return res.status(422).json({ error: 'whatsapp_not_configured' });
  }

  const contatos = contactTagQueries.contactsWithPhoneByTag.all(req.tenant.id, tag);
  if (!contatos.length) return res.status(400).json({ error: 'audiencia_vazia' });

  const job = createOutboundJob({
    tenantId: req.tenant.id,
    type: 'campaign',
    payload: {
      template_nome: template.nome,
      template_idioma: template.idioma,
      variaveis,
      tag,
    },
    idempotencyKey,
    items: contatos.map((c) => ({
      contact_id: c.id || null,
      destination: c.wa_phone,
    })),
  });

  // Registro histórico para a UI existente de campanhas — contagens finais
  // são atualizadas pelo próprio worker via updateCampaignSummary().
  campaignQueries.insert.run({
    tenant_id: req.tenant.id,
    template_nome: templateNome,
    tag,
    total_contatos: contatos.length,
    enviados: 0,
    falhas: 0,
  });

  res.status(202).json({
    ok: true,
    job_id: job.job_id,
    status: job.status,
    total: job.total,
    duplicated: job.duplicated || false,
  });
});

// ── Endpoints da fila de disparos ────────────────────────────────────────
// Uma UI de campanhas usa /api/outbound-jobs para acompanhar progresso,
// pausar, retomar, cancelar ou reenviar as falhas.
apiRouter.get('/api/outbound-jobs', requireAuth, (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const rows = outboundJobQueries.listByTenant.all(req.tenant.id, limit);
  res.json(rows.map(serializeOutboundJob));
});

apiRouter.get('/api/outbound-jobs/:id', requireAuth, (req, res) => {
  const job = outboundJobQueries.getById.get(req.params.id, req.tenant.id);
  if (!job) return res.status(404).json({ error: 'not_found' });
  const rows = outboundJobItemQueries.countByJobStatus.all(job.id);
  const counts = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const failed = outboundJobItemQueries.listFailedByJob.all(job.id, 50);
  res.json({
    ...serializeOutboundJob(job),
    counts,
    // Sem telefone completo em listas de erro. UI mostra só últimos dígitos.
    errors: failed.map((f) => ({
      item_id: f.id,
      contact_id: f.contact_id,
      attempts: f.attempts,
      failed_at: f.failed_at,
      error: String(f.last_error || '').slice(0, 200),
    })),
  });
});

apiRouter.post('/api/outbound-jobs/:id/pause', requireAuth, requireCsrf, (req, res) => {
  const info = outboundJobQueries.markPaused.run(req.params.id, req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'not_found_or_final' });
  res.json({ ok: true });
});

apiRouter.post('/api/outbound-jobs/:id/resume', requireAuth, requireCsrf, (req, res) => {
  const info = outboundJobQueries.markResumed.run(req.params.id, req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'not_found_or_not_paused' });
  res.json({ ok: true });
});

apiRouter.post('/api/outbound-jobs/:id/cancel', requireAuth, requireCsrf, (req, res) => {
  const job = outboundJobQueries.getById.get(req.params.id, req.tenant.id);
  if (!job) return res.status(404).json({ error: 'not_found' });
  outboundJobItemQueries.cancelPending.run(job.id);
  outboundJobQueries.markCancelled.run(job.id, req.tenant.id);
  outboundJobQueries.refreshCounters.run(job.id);
  res.json({ ok: true });
});

apiRouter.post('/api/outbound-jobs/:id/retry-failed', requireAuth, requireCsrf, (req, res) => {
  const job = outboundJobQueries.getById.get(req.params.id, req.tenant.id);
  if (!job) return res.status(404).json({ error: 'not_found' });
  const info = outboundJobItemQueries.retryFailed.run(job.id);
  outboundJobQueries.refreshCounters.run(job.id);
  // Se o job estava em estado terminal, volta pra pending pra o worker
  // pegar de novo. Reset só a coluna de status; contadores foram atualizados.
  if (['completed', 'completed_with_errors', 'failed'].includes(job.status)) {
    outboundJobQueries.updateStatus.run('pending', null, job.id);
  }
  res.json({ ok: true, requeued: info.changes });
});

function serializeOutboundJob(j) {
  const payload = (() => { try { return j.payload_json ? JSON.parse(j.payload_json) : {}; } catch { return {}; } })();
  return {
    id: j.id,
    type: j.type,
    status: j.status,
    total: j.total_items,
    pending: j.pending_items,
    sent: j.sent_items,
    failed: j.failed_items,
    cancelled: j.cancelled_items,
    percent: j.total_items > 0
      ? Math.round(((j.sent_items + j.failed_items + j.cancelled_items) / j.total_items) * 100)
      : 0,
    payload,
    created_at: j.created_at,
    started_at: j.started_at,
    completed_at: j.completed_at,
    cancelled_at: j.cancelled_at,
    last_error: j.last_error,
  };
}

// --- Central de Avisos ---
// Registro persistente de eventos que o lojista precisa ver: estoque
// esgotado, aguardando humano, limite de IA atingido (ver webhook.js pros
// pontos que criam esses registros). Diferente dos alertas operacionais de
// src/alerts.js, que avisam o DONO DA PLATAFORMA, não o lojista.
apiRouter.get('/api/notifications', requireAuth, (req, res) => {
  const includeArchived = req.query.archived === '1' || req.query.archived === 'true';
  const rows = includeArchived
    ? notificationQueries.listArchivedByTenant.all(req.tenant.id)
    : notificationQueries.listByTenant.all(req.tenant.id);
  res.json(rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    contact_phone: n.wa_phone || null,
    contact_name: n.contact_name || null,
    created_at: n.created_at,
    read_at: n.read_at,
    archived_at: n.archived_at || null,
  })));
});

apiRouter.get('/api/notifications/unread-count', requireAuth, (req, res) => {
  res.json({ count: notificationQueries.unreadCount.get(req.tenant.id).n });
});

apiRouter.post('/api/notifications/:id/read', requireAuth, requireCsrf, (req, res) => {
  const info = notificationQueries.markRead.run(Number(req.params.id), req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

apiRouter.post('/api/notifications/read-all', requireAuth, requireCsrf, (req, res) => {
  notificationQueries.markAllRead.run(req.tenant.id);
  res.json({ ok: true });
});

apiRouter.post('/api/notifications/:id/archive', requireAuth, requireCsrf, (req, res) => {
  const info = notificationQueries.archive.run(Number(req.params.id), req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

apiRouter.delete('/api/notifications/:id', requireAuth, requireCsrf, (req, res) => {
  const info = notificationQueries.delete.run(Number(req.params.id), req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// --- Cadastro inteligente do cliente (dados de PF/PJ, endereço, CRM leve) ---
// CPF/CNPJ nunca é retornado em texto puro aqui — só mascarado. Ver
// /reveal-document para a única rota que devolve o documento completo,
// mediante ação explícita do usuário (nunca em listagens/GETs de rotina).
function contactCrmView(contact) {
  const doc = decryptContactDocument(contact);
  return {
    tipo_cliente: contact.tipo_cliente || null,
    cpf_cnpj_masked: doc ? maskDocument(doc) : null,
    razao_social: contact.razao_social || '',
    nome_fantasia: contact.nome_fantasia || '',
    email: contact.email || '',
    cep: contact.cep || '',
    endereco: contact.endereco || '',
    cidade: contact.cidade || '',
    uf: contact.uf || '',
    lead_source: contact.lead_source || 'whatsapp_direto',
    lead_source_detail: contact.lead_source_detail || '',
    responsavel: contact.responsavel || '',
    prioridade: contact.prioridade || 'media',
    proxima_tarefa: contact.proxima_tarefa || '',
    prazo_resposta: contact.prazo_resposta || null,
    assigned_user_id: contact.assigned_user_id || null,
    assigned_team_id: contact.assigned_team_id || null,
    tags: contactTagQueries.byContact.all(contact.id).map((r) => r.tag),
  };
}

apiRouter.get('/api/contacts/:phone/crm', requireAuth, (req, res) => {
  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });
  res.json(contactCrmView(contact));
});

apiRouter.post('/api/contacts/:phone/crm', requireAuth, requireCsrf, (req, res) => {
  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });

  const b = req.body || {};
  let cpfCnpjEnc = contact.cpf_cnpj_enc;
  let cpfCnpjHash = contact.cpf_cnpj_hash;
  let tipoCliente = b.tipo_cliente || contact.tipo_cliente || null;

  // Só mexe no documento se o campo foi enviado — permite salvar o resto do
  // cadastro (endereço, e-mail etc) sem precisar reenviar o CPF/CNPJ.
  if (typeof b.cpf_cnpj === 'string') {
    const trimmed = b.cpf_cnpj.trim();
    if (!trimmed) {
      cpfCnpjEnc = null;
      cpfCnpjHash = null;
    } else {
      const { valid, type } = validateDocument(trimmed);
      if (!valid) {
        return res.status(400).json({ error: `${type === 'cnpj' ? 'CNPJ' : 'CPF'} inválido. Confira os números digitados.` });
      }
      const hash = hashDocument(trimmed);
      const dup = contactQueries.findByCpfCnpjHash.get(req.tenant.id, hash, contact.id);
      if (dup) {
        return res.status(409).json({ error: `Este documento já está cadastrado para ${dup.name || dup.wa_phone}.` });
      }
      cpfCnpjEnc = encryptSecret(trimmed);
      cpfCnpjHash = hash;
      tipoCliente = type;
    }
  }

  contactQueries.updateCrmFields.run({
    id: contact.id,
    tenant_id: req.tenant.id,
    tipo_cliente: tipoCliente,
    cpf_cnpj_enc: cpfCnpjEnc,
    cpf_cnpj_hash: cpfCnpjHash,
    razao_social: b.razao_social ?? contact.razao_social,
    nome_fantasia: b.nome_fantasia ?? contact.nome_fantasia,
    email: b.email ?? contact.email,
    cep: b.cep ?? contact.cep,
    endereco: b.endereco ?? contact.endereco,
    cidade: b.cidade ?? contact.cidade,
    uf: b.uf ?? contact.uf,
    lead_source: b.lead_source || contact.lead_source || 'whatsapp_direto',
    responsavel: b.responsavel ?? contact.responsavel,
    prioridade: b.prioridade || contact.prioridade || 'media',
    proxima_tarefa: b.proxima_tarefa ?? contact.proxima_tarefa,
    prazo_resposta: b.prazo_resposta ?? contact.prazo_resposta,
  });
  applyTipoClienteTag(req.tenant.id, contact.id, tipoCliente);

  res.json(contactCrmView(contactQueries.byId.get(contact.id)));
});

// Única rota que devolve o CPF/CNPJ completo — ação explícita do usuário (POST,
// nunca acionada por um GET/prefetch de rotina).
apiRouter.post('/api/contacts/:phone/crm/reveal-document', requireAuth, requireCsrf, (req, res) => {
  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });
  const doc = decryptContactDocument(contact);
  if (!doc) return res.status(404).json({ error: 'Nenhum documento cadastrado.' });
  res.json({ document: formatDocument(doc) });
});

// Consulta dados públicos de um CNPJ (BrasilAPI) para pré-preencher o cadastro.
// Falha de rede/API não bloqueia o fluxo — o lojista sempre pode preencher manualmente.
apiRouter.post('/api/cnpj-lookup', requireAuth, requireCsrf, async (req, res) => {
  const { valid, type } = validateDocument(req.body?.cnpj || '');
  if (type !== 'cnpj' || !valid) return res.status(400).json({ error: 'CNPJ inválido.' });
  try {
    const data = await lookupCnpj(req.body.cnpj);
    if (!data) return res.status(502).json({ error: 'Consulta indisponível no momento.' });
    res.json(data);
  } catch (err) {
    console.warn('cnpj-lookup:', err.message);
    res.status(502).json({ error: 'Consulta indisponível no momento.' });
  }
});

// Vocabulário sugerido de tags — o lojista pode usar estas ou digitar outra livre.
const SUGGESTED_TAGS = [
  'cliente quente', 'pediu frete', 'frete caro', 'aguardando pagamento', 'pediu desconto',
  'compra recorrente', 'reclamação', 'venda perdida', 'pessoa física', 'empresa',
  'falta cpf/cnpj', 'dados incompletos', 'alta intenção', 'cliente novo', 'cliente recorrente',
  'pós-venda', 'pagamento pendente', 'envio pendente', 'orçamento enviado', 'sem resposta',
];

// Tags em uso pelo tenant (para filtro) + vocabulário sugerido (para autocomplete ao adicionar).
apiRouter.get('/api/tags', requireAuth, (req, res) => {
  res.json({ suggested: SUGGESTED_TAGS, inUse: contactTagQueries.byTenant.all(req.tenant.id) });
});

apiRouter.post('/api/contacts/:phone/tags', requireAuth, requireCsrf, (req, res) => {
  const tag = (req.body?.tag || '').trim().toLowerCase().slice(0, 40);
  if (!tag) return res.status(400).json({ error: 'Informe uma tag.' });
  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });
  contactTagQueries.add.run(req.tenant.id, contact.id, tag);
  res.json({ tags: contactTagQueries.byContact.all(contact.id).map((r) => r.tag) });
});

apiRouter.delete('/api/contacts/:phone/tags/:tag', requireAuth, requireCsrf, (req, res) => {
  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });
  contactTagQueries.remove.run(contact.id, req.params.tag);
  res.json({ tags: contactTagQueries.byContact.all(contact.id).map((r) => r.tag) });
});

// Gerente envia mensagem diretamente para o cliente via WhatsApp.
apiRouter.post('/api/contacts/:phone/reply', requireAuth, requireCsrf, async (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text_required' });

  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });

  if (!config.whatsapp.phoneNumberId || !config.whatsapp.token) {
    return res.status(422).json({ error: 'whatsapp_not_configured' });
  }

  await sendText(req.tenant, req.params.phone, text);
  messageQueries.insert.run(contact.id, 'assistant', text);
  contactQueries.touch.run(contact.id);
  res.json({ ok: true });
});

// Gerente envia um arquivo (foto, vídeo ou documento) diretamente para o cliente via WhatsApp.
apiRouter.post('/api/contacts/:phone/send-media', requireAuth, requireCsrf, uploadGuard, upload.single('file'), requireMagicBytes, async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'file_required' });

  const room = hasStorageRoom(req.tenant, file.size);
  if (!room.ok) return res.status(413).json({ error: STORAGE_LIMIT_MESSAGE });

  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });

  if (!config.whatsapp.phoneNumberId || !config.whatsapp.token) {
    return res.status(422).json({ error: 'whatsapp_not_configured' });
  }

  const mime = file.mimetype || 'application/octet-stream';
  const caption = (req.body?.caption || '').trim();
  const mediaId = storage.save({
    tenantId: req.tenant.id,
    mime,
    filename: file.originalname || null,
    content: readUploadBuffer(file),
  });
  // URL assinada com expiração — o WhatsApp busca o arquivo sem cookie.
  const mediaUrl = `${config.appUrl}/api/media/${mediaId}${signedQuery(mediaId)}`;

  let kind = 'document';
  if (mime.startsWith('image/')) kind = 'image';
  else if (mime.startsWith('video/')) kind = 'video';

  try {
    if (kind === 'image') await sendImage(req.tenant, req.params.phone, mediaUrl, caption);
    else if (kind === 'video') await sendVideo(req.tenant, req.params.phone, mediaUrl, caption);
    else await sendDocument(req.tenant, req.params.phone, mediaUrl, file.originalname || 'arquivo');
  } catch (err) {
    return res.status(502).json({ error: 'send_failed', message: err.message });
  }

  const label = kind === 'image' ? '[imagem]' : kind === 'video' ? '[vídeo]' : '[documento]';
  messageQueries.insertWithMedia.run(contact.id, 'assistant', `${label}${caption ? ' ' + caption : ''}`, mediaId);
  contactQueries.touch.run(contact.id);
  res.json({ ok: true, mediaId });
});

// Download publico de midia (fotos/videos/documentos trocados no chat). O WhatsApp busca esta
// URL ao enviar arquivos do atendente; o dashboard tambem usa para exibir midia recebida do
// cliente. Seguranca via id aleatorio de 128 bits (nao listavel, nao enumeravel).
apiRouter.get('/api/media/:id', (req, res) => {
  const media = mediaQueries.get.get(req.params.id);
  if (!media) return res.status(404).send('Arquivo não encontrado.');
  // Acesso permitido por (a) URL assinada válida (WhatsApp) OU (b) sessão do
  // tenant dono da mídia (painel via cookie). Fecha o vetor de URL vazada.
  const signed = verifySignedQuery(req, req.params.id);
  if (!signed) {
    const t = optionalTenant(req);
    if (!t || t.id !== media.tenant_id) return res.status(403).send('Acesso negado.');
  }
  res.setHeader('Content-Type', media.mime || 'application/octet-stream');
  if (media.filename) {
    const safeName = media.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(media.content));
});

// Download publico do PDF de catalogo — o WhatsApp busca esta URL ao enviar o documento.
apiRouter.get('/api/catalog/download/:tenantId', (req, res) => {
  // Acesso por URL assinada (WhatsApp) OU sessão do próprio tenant (painel).
  if (!verifySignedQuery(req, req.params.tenantId)) {
    const t = optionalTenant(req);
    if (!t || t.id !== req.params.tenantId) return res.status(403).send('Acesso negado.');
  }
  const file = catalogFileQueries.get.get(req.params.tenantId);
  if (!file) return res.status(404).send('Catálogo não encontrado.');
  const safeName = (file.filename || 'catalogo.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(file.content));
});

// Proxy de PDF externo (ex: Google Drive) — re-serve com Content-Type correto.
// O WhatsApp busca esta URL; nós buscamos o arquivo no Drive e entregamos como PDF.
apiRouter.get('/api/catalog/proxy/:tenantId', async (req, res) => {
  if (!verifySignedQuery(req, req.params.tenantId)) {
    const t = optionalTenant(req);
    if (!t || t.id !== req.params.tenantId) return res.status(403).send('Acesso negado.');
  }
  const tenant = tenantQueries.byId.get(req.params.tenantId);
  if (!tenant) return res.status(404).send('Tenant não encontrado.');
  let biz = {};
  try { biz = JSON.parse(tenant.business_json || '{}'); } catch {}
  const rawUrl = biz.catalog_pdf_url;
  if (!rawUrl) return res.status(404).send('Nenhuma URL de catálogo configurada.');

  // Converte URL do Drive para download direto
  let downloadUrl = rawUrl;
  const m = rawUrl.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([A-Za-z0-9_-]+)/);
  if (m) downloadUrl = `https://drive.usercontent.google.com/download?id=${m[1]}&export=download&authuser=0&confirm=t`;

  // SSRF: valida que o destino não é interno/reservado antes de buscar.
  try {
    await assertPublicUrl(downloadUrl);
  } catch (e) {
    return res.status(400).send(e.message);
  }

  try {
    const upstream = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!upstream.ok) return res.status(502).send('Erro ao buscar PDF externo.');
    const buf = Buffer.from(await upstream.arrayBuffer());
    const safeName = `catalogo_${(tenant.business_name || 'catalogo').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch (err) {
    console.warn('Proxy catálogo:', err.message);
    res.status(504).send('Timeout ao buscar PDF externo.');
  }
});

// Metadados (etapas).
apiRouter.get('/api/meta', (_req, res) => {
  res.json({ stages: STAGES, supportPhone: config.supportPhone || '' });
});

// Templates por nicho (Fase 13) — sugestões de FAQs/objeções/respostas rápidas
// para reduzir o esforço inicial de configuração. Só leitura; a aplicação
// (mesclar com o que já existe) acontece no front, reusando o POST /api/settings normal.
apiRouter.get('/api/niche-templates', requireAuth, (_req, res) => {
  res.json({
    niches: NICHE_IDS.map((id) => ({ id, label: NICHE_TEMPLATES[id].label })),
    templates: NICHE_TEMPLATES,
  });
});

// --- Administracao ---
// Log de auditoria (LGPD, Art. 6º, X — accountability): últimas ações sensíveis
// de admin (impersonation, backup, restore, troca de plano) e exclusões de conta.
apiRouter.get('/api/admin/audit-log', requireAuth, requireAdmin, (_req, res) => {
  res.json(auditLogQueries.recent.all());
});

// Diagnóstico do vCard "Adicionar aos contatos" — dispara sob demanda para
// um número informado, sem depender do fluxo real de primeiro contato. Útil
// pra confirmar que WA_SERVER_PHONE está setado e que o cartão está sendo
// aceito pelo WhatsApp Cloud API (o próprio Meta pode rejeitar em modos
// específicos, ex: tenant não pertence à plataforma).
apiRouter.post('/api/admin/test-vcard', requireAuth, requireAdmin, requireCsrf, async (req, res) => {
  const to = String(req.body?.to || '').replace(/\D/g, '');
  const cardName = String(req.body?.name || 'Zapien').slice(0, 60);
  if (!to || to.length < 10) return res.status(400).json({ error: 'Informe um número de destino no formato E.164 (ex: 5511999998888).' });

  const serverPhone = (process.env.WA_SERVER_PHONE || '').replace(/\D/g, '');
  if (!serverPhone) return res.status(400).json({ error: 'WA_SERVER_PHONE não configurado no servidor. Sem essa variável o cartão não é enviado no primeiro contato.' });

  try {
    // Usa o próprio tenant admin como remetente da chamada Meta — o vCard
    // enviado contém sempre o WA_SERVER_PHONE (número da plataforma).
    const result = await sendContact(req.tenant, to, cardName, serverPhone);
    res.json({ ok: true, sent_to: to, server_phone: serverPhone, whatsapp_response: result });
  } catch (err) {
    console.error('[test-vcard]', err);
    res.status(502).json({ error: 'Falha ao enviar cartão de contato: ' + err.message });
  }
});

apiRouter.get('/api/admin/tenants', requireAuth, requireAdmin, (_req, res) => {
  const tenants = tenantQueries.listAll.all();
  const result = tenants.map((t) => {
    const c = db
      .prepare(`SELECT COUNT(*) AS n FROM contacts WHERE tenant_id = ?`)
      .get(t.id).n;
    const lastMsg = db
      .prepare(`SELECT MAX(m.created_at) AS last FROM messages m
                JOIN contacts ct ON ct.id = m.contact_id WHERE ct.tenant_id = ?`)
      .get(t.id)?.last || null;
    const usage = getTenantUsage(t);
    return {
      id: t.id,
      email: t.email,
      business_name: t.business_name,
      is_admin: Boolean(t.is_admin),
      active: Boolean(t.active),
      plan: t.plan || 'essencial',
      whatsapp_conectado: Boolean(t.wa_phone_number_id),
      subscription: subscriptionState(t),
      trial_ends_at: t.trial_ends_at || null,
      contatos: c,
      created_at: t.created_at,
      last_activity: lastMsg,
      usage: {
        ai: usage.ai,
        storage: usage.storage,
        audio: usage.audio,
        extraDocs: usage.extraDocs,
      },
    };
  });
  res.json(result);
});

apiRouter.post('/api/admin/tenants/:id/plan', requireAuth, requireAdmin, requireCsrf, (req, res) => {
  const { plan } = req.body || {};
  if (!PLAN_IDS.includes(plan)) return res.status(400).json({ error: 'Plano inválido.' });
  const tenant = tenantQueries.byId.get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });
  tenantQueries.setPlan.run({ plan, id: req.params.id });
  logAudit({
    actorTenantId: req.tenant.id, actorEmail: req.tenant.email,
    targetTenantId: tenant.id, targetEmail: tenant.email,
    action: 'plan_change', detail: `${tenant.plan} → ${plan}`,
  });
  res.json({ ok: true });
});

apiRouter.post('/api/admin/tenants/:id/grant-access', requireAuth, requireAdmin, requireCsrf, (req, res) => {
  const { plan, days } = req.body || {};
  if (!PLAN_IDS.includes(plan)) return res.status(400).json({ error: 'Plano inválido.' });
  const daysNum = Number(days);
  if (!Number.isInteger(daysNum) || daysNum < 1 || daysNum > 3650) {
    return res.status(400).json({ error: 'Informe uma duração entre 1 e 3650 dias.' });
  }

  const tenant = tenantQueries.byId.get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });

  tenantQueries.grantTemporaryAccess.run({ id: tenant.id, plan, days: daysNum });
  const updated = tenantQueries.byId.get(tenant.id);
  logAudit({
    actorTenantId: req.tenant.id, actorEmail: req.tenant.email,
    targetTenantId: tenant.id, targetEmail: tenant.email,
    action: 'temporary_access_grant',
    detail: `${tenant.plan}/${subscriptionState(tenant).status} → ${plan}/trial até ${updated.trial_ends_at}`,
  });

  res.json({
    ok: true,
    plan,
    status: 'trialing',
    trial_ends_at: updated.trial_ends_at,
  });
});

// Exclusão administrativa definitiva. Remove o tenant e todos os dados
// relacionados pela cascata do banco, revoga sessões e libera o e-mail para
// um cadastro futuro começar como uma conta totalmente nova.
apiRouter.delete('/api/admin/tenants/:id', requireAuth, requireAdmin, requireCsrf, (req, res) => {
  const target = tenantQueries.byId.get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Conta não encontrada.' });
  if (target.id === req.tenant.id || target.is_admin) {
    return res.status(400).json({ error: 'A conta administradora não pode ser excluída por esta ação.' });
  }

  const confirmation = String(req.body?.confirmation || '').trim().toLowerCase();
  if (confirmation !== String(target.email || '').trim().toLowerCase()) {
    return res.status(400).json({ error: 'Digite exatamente o e-mail da conta para confirmar.' });
  }

  const targetId = target.id;
  const targetEmail = target.email;
  const diskFile = join(BACKUP_DIR, `${targetId}.json`);

  try {
    logAudit({
      actorTenantId: req.tenant.id, actorEmail: req.tenant.email,
      targetTenantId: targetId, targetEmail,
      action: 'tenant_delete_admin',
      detail: 'Exclusão definitiva solicitada pelo administrador',
    });

    // ON DELETE CASCADE remove sessões, usuários, contatos, mensagens, vendas,
    // mídia, documentos, automações e demais registros ligados ao tenant.
    tenantQueries.delete.run(targetId);
    if (existsSync(diskFile)) {
      try { unlinkSync(diskFile); } catch { /* o banco já foi removido; não falha a operação */ }
    }
    res.json({ ok: true, deleted_email: targetEmail });
  } catch (err) {
    console.error('[admin tenant delete]', err);
    res.status(500).json({ error: 'Não foi possível excluir completamente a conta.' });
  }
});

apiRouter.post('/api/admin/tenants/:id/impersonate', requireAuth, requireAdmin, requireCsrf, (req, res) => {
  const target = tenantQueries.byId.get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Tenant não encontrado.' });
  if (target.id === req.tenant.id) return res.status(400).json({ error: 'Não pode impersonar a si mesmo.' });
  const token = randomBytes(32).toString('hex');
  sessionQueries.createImpersonation.run(token, target.id, req.tenant.id, req.sessionToken);
  setSessionCookie(res, token);
  logAudit({
    actorTenantId: req.tenant.id, actorEmail: req.tenant.email,
    targetTenantId: target.id, targetEmail: target.email,
    action: 'impersonate_start',
  });
  res.json({ ok: true, redirect: '/settings.html' });
});

apiRouter.post('/api/admin/stop-impersonate', requireAuth, requireCsrf, (req, res) => {
  if (!req.impersonatedBy) return res.status(400).json({ error: 'Não está em modo impersonation.' });
  const adminToken = req.adminToken;
  const admin = tenantQueries.byId.get(req.impersonatedBy);
  logAudit({
    actorTenantId: req.impersonatedBy, actorEmail: admin?.email,
    targetTenantId: req.tenant.id, targetEmail: req.tenant.email,
    action: 'impersonate_stop',
  });
  sessionQueries.delete.run(req.sessionToken);
  if (adminToken) {
    setSessionCookie(res, adminToken);
  } else {
    clearSessionCookie(res);
  }
  res.json({ ok: true, redirect: '/admin.html' });
});

apiRouter.post('/api/admin/seed-demo-self', requireAuth, requireAdmin, requireCsrf, (req, res) => {
  const tenant = req.tenant;
  try {
    backupTenantBusiness(tenant); // preserva config atual antes de sobrescrever
    tenantQueries.updateSettings.run({
      id: tenant.id,
      business_name: 'Amazônia Aromas',
      atendente_name: 'Bia',
      checkout_url: tenant.checkout_url || '',
      notify_phone: tenant.notify_phone || null,
      wa_phone_number_id: tenant.wa_phone_number_id || null,
      wa_token: tenant.wa_token || null,
      mp_access_token: tenant.mp_access_token || null,
      cep_origem: tenant.cep_origem || null,
      melhor_envio_token: tenant.melhor_envio_token || null,
      business_json: JSON.stringify(AMAZONIA_AROMAS_BUSINESS),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('admin seed-demo-self:', err);
    res.status(500).json({ error: 'Erro ao popular os dados.' });
  }
});

apiRouter.get('/api/admin/tenants/:id/backup', requireAuth, requireAdmin, (req, res) => {
  const tenant = tenantQueries.byId.get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });

  const diskFile = join(BACKUP_DIR, `${tenant.id}.json`);
  let backupJson;
  if (existsSync(diskFile)) {
    try { backupJson = readFileSync(diskFile, 'utf8'); } catch {}
  }

  if (!backupJson) {
    let business = {};
    try { business = JSON.parse(tenant.business_json || '{}'); } catch {}
    backupJson = JSON.stringify({
      exported_at: new Date().toISOString(),
      email: tenant.email,
      business_name: tenant.business_name,
      atendente_name: tenant.atendente_name,
      checkout_url: tenant.checkout_url,
      notify_phone: tenant.notify_phone,
      cep_origem: tenant.cep_origem,
      wa_phone_number_id: tenant.wa_phone_number_id,
      plan: tenant.plan,
      business,
    }, null, 2);
  }

  const filename = `backup-${tenant.email.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  logAudit({
    actorTenantId: req.tenant.id, actorEmail: req.tenant.email,
    targetTenantId: tenant.id, targetEmail: tenant.email,
    action: 'backup_download',
  });
  res.send(backupJson);
});

apiRouter.get('/api/admin/tenants/:id/backup/status', requireAuth, requireAdmin, (req, res) => {
  const tenant = tenantQueries.byId.get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });
  const diskFile = join(BACKUP_DIR, `${tenant.id}.json`);
  if (!existsSync(diskFile)) return res.json({ available: false });
  try {
    const data = JSON.parse(readFileSync(diskFile, 'utf8'));
    res.json({ available: true, saved_at: data.saved_at || null, business_name: data.business_name || null });
  } catch {
    res.json({ available: false });
  }
});

apiRouter.post('/api/admin/tenants/:id/restore', requireAuth, requireAdmin, requireCsrf, (req, res) => {
  const tenant = tenantQueries.byId.get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });
  const diskFile = join(BACKUP_DIR, `${tenant.id}.json`);
  if (!existsSync(diskFile)) return res.status(404).json({ error: 'Nenhum backup salvo encontrado para este cliente.' });
  let bk;
  try { bk = JSON.parse(readFileSync(diskFile, 'utf8')); } catch {
    return res.status(500).json({ error: 'Arquivo de backup corrompido.' });
  }
  try {
    tenantQueries.updateSettings.run({
      id: tenant.id,
      business_name: bk.business_name || tenant.business_name,
      atendente_name: bk.atendente_name || tenant.atendente_name,
      checkout_url: bk.checkout_url ?? tenant.checkout_url,
      notify_phone: bk.notify_phone ?? tenant.notify_phone,
      wa_phone_number_id: tenant.wa_phone_number_id,
      wa_token: tenant.wa_token,
      mp_access_token: tenant.mp_access_token,
      cep_origem: bk.cep_origem ?? tenant.cep_origem,
      melhor_envio_token: tenant.melhor_envio_token,
      business_json: JSON.stringify(bk.business || {}),
    });
    logAudit({
      actorTenantId: req.tenant.id, actorEmail: req.tenant.email,
      targetTenantId: tenant.id, targetEmail: tenant.email,
      action: 'backup_restore',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[restore]', err);
    res.status(500).json({ error: 'Erro ao restaurar backup.' });
  }
});

apiRouter.post('/api/admin/tenants/:id/active', requireAuth, requireAdmin, requireCsrf, (req, res) => {
  const target = tenantQueries.byId.get(req.params.id);
  tenantQueries.setActive.run(req.body?.active ? 1 : 0, req.params.id);
  logAudit({
    actorTenantId: req.tenant.id, actorEmail: req.tenant.email,
    targetTenantId: req.params.id, targetEmail: target?.email,
    action: req.body?.active ? 'tenant_activate' : 'tenant_deactivate',
  });
  res.json({ ok: true });
});

// Snapshot do estado atual do tenant em disco ANTES de qualquer sobrescrita
// destrutiva (seed/restore) — permite recuperação. Idempotente e tolerante a falha.
function backupTenantBusiness(tenant) {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    let business = {};
    try { business = JSON.parse(tenant.business_json || '{}'); } catch {}
    writeFileSync(
      join(BACKUP_DIR, `${tenant.id}.json`),
      JSON.stringify({
        saved_at: new Date().toISOString(),
        email: tenant.email,
        business_name: tenant.business_name,
        atendente_name: tenant.atendente_name,
        checkout_url: tenant.checkout_url,
        notify_phone: tenant.notify_phone,
        cep_origem: tenant.cep_origem,
        business,
      }, null, 2),
    );
  } catch (e) {
    console.error('[backup before overwrite]', e.message);
  }
}

function applySeed(tenant, name, atendente, business) {
  backupTenantBusiness(tenant);
  tenantQueries.updateSettings.run({
    id: tenant.id,
    business_name: name,
    atendente_name: atendente,
    checkout_url: tenant.checkout_url || '',
    notify_phone: tenant.notify_phone || null,
    wa_phone_number_id: tenant.wa_phone_number_id || null,
    wa_token: tenant.wa_token || null,
    mp_access_token: tenant.mp_access_token || null,
    cep_origem: tenant.cep_origem || null,
    melhor_envio_token: tenant.melhor_envio_token || null,
    business_json: JSON.stringify(normalizeBusiness(business)),
  });
  // Um seed muda toda a configuração; uma nota anterior deixaria de representar
  // a conta. A próxima análise passa a ser a nova referência oficial.
  db.prepare(`
    UPDATE tenants
       SET setup_analysis_score = NULL,
           setup_analysis_json = NULL,
           setup_analysis_at = NULL
     WHERE id = ?
  `).run(tenant.id);
}

// Popula um tenant com dados demo (painel admin).
apiRouter.post('/api/admin/tenants/:id/seed-demo', requireAuth, requireAdmin, requireCsrf, (req, res) => {
  const tenant = tenantQueries.byId.get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });
  const which = req.body?.seed || 'amazonia';
  const seeds = {
    amazonia:  ['Amazônia Aromas',       'Bia',    AMAZONIA_AROMAS_BUSINESS],
    brinquedo: ['Turma do Brinquedo',    'Tati',   TURMA_BRINQUEDO_BUSINESS],
    cafe:      ['Café & Lar Essencial',  'Bruno',  CAFE_LAR_BUSINESS],
    pizzaria:  ['Bella Napoli Pizzaria', 'Gi',     BELLA_NAPOLI_BUSINESS],
    zapien:     ['Zapien',                 'Zapi',   ZAPIEN_BUSINESS],
  };
  const [name, atendente, business] = seeds[which] || seeds.amazonia;
  try {
    applySeed(tenant, name, atendente, business);
    res.json({ ok: true, message: `Conta populada com dados de "${name}".` });
  } catch (err) {
    console.error('seed-demo:', err);
    res.status(500).json({ error: 'Erro ao popular os dados.' });
  }
});

// Comparação de senha de suporte em tempo constante.
function supportPasswordOk(provided) {
  if (!supportEnabled) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(SUPPORT_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Verifica a senha de suporte (sem alterar dados).
apiRouter.post('/api/support/verify', requireAuth, (req, res) => {
  if (!supportEnabled) return res.status(404).json({ error: 'Suporte não configurado.' });
  if (!supportPasswordOk(req.body?.password)) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }
  res.json({ ok: true });
});

// Popula a conta do proprio usuario autenticado (acessado via botao Suporte no app).
apiRouter.post('/api/support/seed-demo', requireAuth, requireCsrf, (req, res) => {
  if (!supportEnabled) return res.status(404).json({ error: 'Suporte não configurado.' });
  if (!supportPasswordOk(req.body?.password)) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }
  const tenant = req.tenant;
  try {
    backupTenantBusiness(tenant); // preserva config atual antes de sobrescrever
    tenantQueries.updateSettings.run({
      id: tenant.id,
      business_name: 'Amazônia Aromas',
      atendente_name: 'Bia',
      checkout_url: tenant.checkout_url || '',
      notify_phone: tenant.notify_phone || null,
      wa_phone_number_id: tenant.wa_phone_number_id || null,
      wa_token: tenant.wa_token || null,
      mp_access_token: tenant.mp_access_token || null,
      cep_origem: tenant.cep_origem || null,
      melhor_envio_token: tenant.melhor_envio_token || null,
      business_json: JSON.stringify(AMAZONIA_AROMAS_BUSINESS),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('support seed-demo:', err);
    res.status(500).json({ error: 'Erro ao popular os dados.' });
  }
});

// Importa configuracao de negocio lendo uma landing page / site de vendas.
apiRouter.post('/api/ai/import-url', requireAuth, requireCsrf, importLimiter, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL não informada.' });
  let target;
  try {
    target = await assertPublicUrl(url);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Zapien/2.0)' },
      redirect: 'error', // não seguir redirecionamentos — evita rebind para interno
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return res.status(422).json({ error: `Não foi possível acessar a página (HTTP ${r.status}).` });
    const html = await r.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10000);
    if (text.length < 50) return res.status(422).json({ error: 'Não foi possível extrair conteúdo da página.' });
    const result = await generateBusinessConfig(text, target.hostname);
    res.json(result);
  } catch (err) {
    if (err.name === 'TimeoutError') return res.status(504).json({ error: 'A página demorou demais para responder.' });
    console.error('import-url:', err);
    res.status(500).json({ error: 'Erro ao importar: ' + err.message });
  }
});

// Extrai produtos de uma imagem (foto de catalogo, cardapio, tabela de precos).
apiRouter.post('/api/catalog/import-image', requireAuth, requireCsrf, requirePlan('pro'), importLimiter, uploadGuard, upload.single('image'), requireMagicBytes, enforcePlanFileSize('productImageMb'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
  if (!ALLOWED_IMAGE_MIME.includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'Formato não suportado. Use JPG, PNG ou WebP.' });
  }
  try {
    const produtos = await parseCatalogImage(readUploadBuffer(req.file), req.file.mimetype);
    res.json({ produtos });
  } catch (err) {
    console.error('catalog import-image:', err);
    res.status(500).json({ error: 'Erro ao processar imagem: ' + err.message });
  }
});

// Simulador da atendente — testa a IA com a config ATUAL do tenant, sem enviar
// nada ao WhatsApp nem persistir em contato real. Permite ao lojista experimentar
// a atendente antes de compartilhar o link (reduz o "teste no número real").
apiRouter.post('/api/ai/simulate', requireAuth, requireCsrf, sandboxLimiter, async (req, res) => {
  const messages = sanitizeSimulationMessages(req.body?.messages);
  if (!messages.length) return res.status(400).json({ error: 'Envie ao menos uma mensagem.' });
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'A última mensagem deve ser do cliente.' });
  }

  const t = req.tenant;
  const biz = normalizeBusiness(t.business_json);
  const hasCatalog = Boolean(
    catalogFileQueries.exists.get(t.id) ||
    biz.catalog_pdf_url ||
    (Array.isArray(biz.produtos) && biz.produtos.length > 0)
  );

  try {
    const result = await generateReply(t, messages, hasCatalog, null);
    if (!result) return res.json({ mensagem: 'A atendente não respondeu. Verifique se o negócio e os produtos estão configurados.', simulated: true });
    res.json(buildSimulationResponse(result));
  } catch (err) {
    console.error('ai/simulate:', err.message);
    res.status(502).json({ error: 'Não foi possível simular agora. Tente novamente.' });
  }
});

// Rubrica oficial determinística: não chama provedor de IA e não compartilha
// o limitador do sandbox. É o endpoint usado pelo botão da porcentagem.
apiRouter.post('/api/ai/setup-readiness', requireAuth, requireCsrf, (req, res) => {
  const t = req.tenant;
  const biz = normalizeBusiness(t.business_json);
  const hasCatalog = Boolean(
    catalogFileQueries.exists.get(t.id) ||
    biz.catalog_pdf_url ||
    (Array.isArray(biz.produtos) && biz.produtos.length > 0)
  );

  try {
    const readiness = calculateSetupReadiness(t, hasCatalog);
    const missing = readiness.criterios.filter((criterio) => !criterio.completo);
    const result = {
      ...readiness,
      score_method: 'rubrica-fixa-v1',
      resumo: readiness.score === 100
        ? 'Configuração essencial completa. A nota oficial chegou a 100%.'
        : `Nota oficial: ${readiness.criterios.length - missing.length} de ${readiness.criterios.length} critérios concluídos.`,
      sugestoes: missing.slice(0, 8).map((criterio) => ({
        severidade: 'recomendado',
        area: 'ia-config',
        mensagem: `Complete o critério objetivo: ${criterio.nome}.`,
      })),
      advisory_status: 'not_requested',
    };
    const analyzedAt = new Date().toISOString();
    try {
      db.prepare(`
        UPDATE tenants
           SET setup_analysis_score = ?,
               setup_analysis_json = ?,
               setup_analysis_at = datetime('now')
         WHERE id = ?
      `).run(result.score, JSON.stringify(result), t.id);
    } catch (saveErr) {
      console.error('[setup-readiness persistence]', saveErr);
    }
    res.json({ ...result, analyzed_at: analyzedAt });
  } catch (err) {
    console.error('[setup-readiness]', err);
    res.status(500).json({
      error: 'Não foi possível calcular a rubrica objetiva.',
      code: 'SETUP_READINESS_ERROR',
    });
  }
});

// Analisa a configuracao atual (nao a conversa) e sugere o que falta/esta fraco —
// botao "Analisar IA" em Configuracoes. Sob demanda, mesmo limitador do simulador.
apiRouter.post('/api/ai/analyze-setup', requireAuth, requireCsrf, sandboxLimiter, async (req, res) => {
  const t = req.tenant;
  const biz = normalizeBusiness(t.business_json);
  const hasCatalog = Boolean(
    catalogFileQueries.exists.get(t.id) ||
    biz.catalog_pdf_url ||
    (Array.isArray(biz.produtos) && biz.produtos.length > 0)
  );
  try {
    const result = await analyzeBusinessSetup(t, hasCatalog);
    const analyzedAt = new Date().toISOString();
    let persistenceStatus = 'saved';
    try {
      db.prepare(`
        UPDATE tenants
           SET setup_analysis_score = ?,
               setup_analysis_json = ?,
               setup_analysis_at = datetime('now')
         WHERE id = ?
      `).run(result.score, JSON.stringify(result), t.id);
    } catch (saveErr) {
      // Persistência não pode esconder uma análise que já foi calculada.
      console.error('[setup-analysis persistence]', saveErr);
      persistenceStatus = 'not_saved';
    }
    res.json({ ...result, analyzed_at: analyzedAt, persistence_status: persistenceStatus });
  } catch (err) {
    console.error('ai/analyze-setup:', err);
    res.status(500).json({
      error: 'A rubrica objetiva não pôde ser calculada. Atualize a página e tente novamente.',
      code: 'SETUP_ANALYSIS_UNEXPECTED',
    });
  }
});

// Gera configuracao completa do negocio a partir de descricao em linguagem natural.
apiRouter.post('/api/ai/setup-business', requireAuth, requireCsrf, async (req, res) => {
  const { descricao, business_name } = req.body || {};
  if (!descricao || descricao.trim().length < 15) {
    return res.status(400).json({ error: 'Descreva seu negócio com mais detalhes (mínimo 15 caracteres).' });
  }
  try {
    const result = await generateBusinessConfig(descricao.trim(), (business_name || '').trim());
    res.json(result);
  } catch (err) {
    console.error('ai/setup-business:', err);
    res.status(500).json({ error: 'Erro ao gerar configuração: ' + err.message });
  }
});

// Testa o calculo de frete com o token e CEP de origem configurados pelo tenant.
apiRouter.get('/api/frete/test', requireAuth, requirePlan('elite'), async (req, res) => {
  const t = req.tenant;
  const meToken = t.melhor_envio_token || config.mePlatformToken;
  if (!meToken || !t.cep_origem) {
    return res.status(400).json({
      error: 'CEP de origem não configurado. Preencha nas configurações de frete.',
    });
  }
  const cepDestino = (req.query.cep || '01310100').replace(/\D/g, '');
  try {
    const b = (() => { try { return JSON.parse(t.business_json || '{}'); } catch { return {}; } })();
    const opcoes = await calcularFrete(meToken, t.cep_origem, cepDestino, b.peso_padrao_kg || 0.5);
    res.json({ ok: true, cep_origem: t.cep_origem, cep_destino: cepDestino, opcoes });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// --- Handoff summary ---
apiRouter.get('/api/handoffs/summary', requireAuth, (req, res) => {
  const tenantId = req.tenant.id;
  const waiting = contactQueries.handoffWaiting.all(tenantId);
  const inProgress = contactQueries.handoffInProgress.all(tenantId);
  const oldestWaitingAt = waiting.length > 0 ? waiting[0].handoff_requested_at : null;
  res.json({
    waiting: waiting.length,
    in_progress: inProgress.length,
    oldest_waiting_at: oldestWaitingAt,
    items: waiting.slice(0, 10).map(c => ({
      phone: c.wa_phone,
      name: c.name || c.wa_phone,
      reason: c.handoff_reason,
      summary: c.summary,
      requested_at: c.handoff_requested_at,
    })),
  });
});

// Handoff action endpoints
const csrfCheck = requireCsrf;

apiRouter.post('/api/contacts/:phone/handoff/request', requireAuth, csrfCheck, (req, res) => {
  const tenantId = req.tenant.id;
  const phone = req.params.phone;
  const contact = contactQueries.byPhone.get(tenantId, phone);
  if (!contact) return res.status(404).json({ error: 'not found' });
  if (contact.handoff_status === 'waiting' || contact.handoff_status === 'in_progress') {
    return res.json({ ok: true, status: contact.handoff_status });
  }
  contactQueries.setHandoffStatus.run('waiting', req.body.reason || 'pediu_humano', contact.id);
  res.json({ ok: true, status: 'waiting' });
});

apiRouter.post('/api/contacts/:phone/handoff/claim', requireAuth, csrfCheck, (req, res) => {
  const tenantId = req.tenant.id;
  const phone = req.params.phone;
  const contact = contactQueries.byPhone.get(tenantId, phone);
  if (!contact) return res.status(404).json({ error: 'not found' });
  if (contact.handoff_status === 'none') {
    contactQueries.setHandoffStatus.run('waiting', 'manual', contact.id);
  }
  contactQueries.claimHandoff.run(contact.id);
  res.json({ ok: true, status: 'in_progress' });
});

apiRouter.post('/api/contacts/:phone/handoff/release', requireAuth, csrfCheck, (req, res) => {
  const tenantId = req.tenant.id;
  const phone = req.params.phone;
  const contact = contactQueries.byPhone.get(tenantId, phone);
  if (!contact) return res.status(404).json({ error: 'not found' });
  contactQueries.releaseHandoff.run(contact.id);
  res.json({ ok: true, status: 'none' });
});

// --- Notas internas por contato ---
apiRouter.get('/api/contacts/:phone/notes', requireAuth, requirePlan('pro'), (req, res) => {
  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });
  res.json(noteQueries.byContact.all(contact.id));
});

apiRouter.post('/api/contacts/:phone/notes', requireAuth, requireCsrf, requirePlan('pro'), (req, res) => {
  const content = (req.body?.content || '').trim();
  if (!content) return res.status(400).json({ error: 'content_required' });
  const contact = contactQueries.byPhone.get(req.tenant.id, req.params.phone);
  if (!contact) return res.status(404).json({ error: 'not_found' });
  const info = noteQueries.insert.run(contact.id, req.tenant.id, content);
  res.json({ id: info.lastInsertRowid, content, created_at: new Date().toISOString() });
});

apiRouter.delete('/api/contacts/:phone/notes/:id', requireAuth, requireCsrf, requirePlan('pro'), (req, res) => {
  const info = noteQueries.delete.run(Number(req.params.id), req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// --- Exportação CSV de contatos ---
apiRouter.get('/api/contacts/export.csv', requireAuth, requirePlan('pro'), (req, res) => {
  const rows = contactQueries.listByTenant.all(req.tenant.id);
  const header = 'Nome,WhatsApp,Etapa,Intenção,Resumo,Último contato\n';
  const csv = rows.map((c) => {
    const cell = (v) => `"${sanitizeCsvCell(v).replace(/"/g, '""')}"`;
    return [
      cell(c.name), cell(c.wa_phone), cell(c.stage), cell(c.buy_intent),
      cell(c.summary), cell((c.last_message_at || '').replace('T', ' ').slice(0, 16)),
    ].join(',');
  }).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contatos.csv"');
  res.send('﻿' + header + csv); // BOM para Excel reconhecer UTF-8
});


// --- Planos (Mercado Pago Preapproval) ---
// Preço/nome vêm de plans.js (fonte única). O plano Especial é contactOnly —
// não entra aqui, pois não tem checkout self-service (fala com vendas via WhatsApp).
function publicPlanLimits(plan) {
  return {
    catalogPdfMb: plan.catalogPdfMb,
    catalogPdfPages: plan.catalogPdfPages,
    extraDocsMax: plan.extraDocsMax,
    extraDocMb: plan.extraDocMb,
    extraDocPages: plan.extraDocPages,
    knowledgePagesTotal: plan.knowledgePagesTotal,
  };
}

const PUBLIC_PLANS = Object.fromEntries(
  PLAN_IDS.map((id) => [
    id,
    {
      name: PLAN_LIMITS[id].label,
      price: PLAN_LIMITS[id].price,
      label: `Plano ${PLAN_LIMITS[id].label} Zapien`,
      contactOnly: Boolean(PLAN_LIMITS[id].contactOnly),
      limits: publicPlanLimits(PLAN_LIMITS[id]),
    },
  ])
);

const MP_PLANS = Object.fromEntries(
  Object.entries(PUBLIC_PLANS).filter(([, plan]) => !plan.contactOnly)
);

apiRouter.get('/api/plans', (_req, res) => {
  res.json({ plans: PUBLIC_PLANS, billingPeriods: BILLING_PERIODS, mpBillingEnabled });
});

apiRouter.post('/api/plans/subscribe', requireAuth, requireCsrf, async (req, res) => {
  if (!mpBillingEnabled) {
    return res.status(400).json({ error: 'Assinatura via MP não habilitada nesta instância.' });
  }
  const planId = req.body?.plan;
  const plan = MP_PLANS[planId];
  if (!plan) return res.status(400).json({ error: 'Plano inválido.' });

  const periodId = BILLING_PERIOD_IDS.includes(req.body?.period) ? req.body.period : 'mensal';
  const pricing = getPeriodPricing(plan.price, periodId);

  try {
    const periodLabel = BILLING_PERIODS[periodId].label;
    const body = JSON.stringify({
      reason: periodId === 'mensal' ? plan.label : `${plan.label} (${periodLabel})`,
      auto_recurring: {
        frequency: pricing.months,
        frequency_type: 'months',
        transaction_amount: pricing.total,
        currency_id: 'BRL',
      },
      back_url: `${config.appUrl}/dashboard.html?subscribed=1`,
      payer_email: req.tenant.email,
    });
    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.mpPlatformToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    if (!mpRes.ok) {
      const txt = await mpRes.text();
      throw new Error(`MP ${mpRes.status}: ${txt.slice(0, 200)}`);
    }
    const data = await mpRes.json();
    tenantQueries.setMpPreapproval.run({
      id: req.tenant.id,
      mp_preapproval_id: data.id,
      status: 'trialing', // será atualizado pelo webhook quando o pagamento for aprovado
      plan: planId,
      billing_period: periodId,
    });
    res.json({ init_point: data.init_point });
  } catch (err) {
    console.error('MP subscribe:', err.message);
    res.status(500).json({ error: 'Erro ao criar assinatura: ' + err.message });
  }
});

// Reconcilia o status da assinatura MP consultando a API do preapproval.
// Usada pelo webhook, pelo retorno do checkout (?subscribed=1) e por reconcile
// manual — garante consistência mesmo se o webhook falhar/atrasar.
const MP_STATUS_MAP = { authorized: 'active', paused: 'past_due', cancelled: 'canceled', pending: 'trialing' };
async function reconcileMpPreapproval(preapprovalId) {
  if (!preapprovalId || !config.mpPlatformToken) return null;
  const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${config.mpPlatformToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!mpRes.ok) return null;
  const data = await mpRes.json();
  const tenant = tenantQueries.byMpPreapproval.get(data.id);
  if (!tenant) return null;
  const newStatus = MP_STATUS_MAP[data.status] || data.status;
  tenantQueries.setMpPreapproval.run({
    id: tenant.id,
    mp_preapproval_id: data.id,
    status: newStatus,
    plan: tenant.plan || 'essencial',
    billing_period: tenant.billing_period || 'mensal',
  });
  return newStatus;
}

// Reconciliação sob demanda (chamada pelo dashboard ao retornar do checkout).
apiRouter.post('/api/plans/reconcile', requireAuth, requireCsrf, async (req, res) => {
  const t = req.tenant;
  if (!t.mp_preapproval_id) return res.json({ status: subscriptionState(t).status });
  try {
    const newStatus = await reconcileMpPreapproval(t.mp_preapproval_id);
    const fresh = tenantQueries.byId.get(t.id);
    res.json({ status: subscriptionState(fresh).status, mp_status: newStatus });
  } catch (err) {
    console.error('MP reconcile:', err.message);
    res.status(502).json({ error: 'Não foi possível reconciliar a assinatura agora.' });
  }
});

// Webhook do Mercado Pago para atualizar status de assinatura
apiRouter.post('/mercadopago/subscription-webhook', async (req, res) => {
  // Valida assinatura HMAC-SHA256 do MP (se secret configurado)
  if (config.mpWebhookSecret) {
    const xSig = req.headers['x-signature'] || '';
    const xReqId = req.headers['x-request-id'] || '';
    const notifId = req.query?.['data.id'] || req.body?.data?.id || '';
    const ts = xSig.match(/ts=([^,]+)/)?.[1] || '';
    const v1 = xSig.match(/v1=([^,]+)/)?.[1] || '';
    const template = `id:${notifId};request-date:${ts};`;
    const expected = createHmac('sha256', config.mpWebhookSecret).update(template).digest('hex');
    if (!v1 || expected !== v1) {
      console.warn('MP webhook: assinatura inválida', { xReqId, ts, notifId });
      return res.sendStatus(401);
    }
  }

  res.sendStatus(200); // responde rápido antes de processar
  try {
    const { id, type } = req.body || {};
    if (type !== 'subscription_preapproval' || !id) return;
    const newStatus = await reconcileMpPreapproval(id);
    if (newStatus) console.log(`MP webhook: preapproval ${id} → ${newStatus}`);
  } catch (e) {
    console.error('MP webhook:', e.message);
  }
});

// Webhook do Mercado Pago para vendas (Checkout Pro)
// Aceita dois formatos de notificação do MP: o novo (com header x-signature,
// validável) e o formato antigo por query string (sem assinatura). Só rejeita
// quando o header VEM presente e a assinatura NÃO bate — isso pega chamadas
// forjadas no formato novo sem quebrar notificações legítimas no formato
// antigo, que nunca tiveram como ser assinadas.
apiRouter.post('/mercadopago/checkout-webhook', async (req, res) => {
  if (config.mpWebhookSecret) {
    const xSig = req.headers['x-signature'];
    if (xSig) {
      const notifId = req.query?.['data.id'] || req.body?.data?.id || '';
      const ts = xSig.match(/ts=([^,]+)/)?.[1] || '';
      const v1 = xSig.match(/v1=([^,]+)/)?.[1] || '';
      const template = `id:${notifId};request-date:${ts};`;
      const expected = createHmac('sha256', config.mpWebhookSecret).update(template).digest('hex');
      if (!v1 || expected !== v1) {
        console.warn('MP checkout webhook: assinatura inválida', { xReqId: req.headers['x-request-id'], notifId });
        return res.sendStatus(401);
      }
    }
  }

  res.sendStatus(200); // MP requires fast response
  try {
    const tenantId = req.query.tenant;
    if (!tenantId) return;

    const tenant = tenantQueries.byId.get(tenantId);
    if (!tenant) return;
    const decTenant = decryptTenant(tenant);

    const type = req.body?.type || req.body?.action || req.query.topic;
    const paymentId = req.body?.data?.id || req.query.id;
    if (type !== 'payment' || !paymentId) return;

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${decTenant.mp_access_token}` },
    });
    if (!mpRes.ok) return;
    const payment = await mpRes.json();
    const externalReference = payment.external_reference;
    if (!externalReference) return;

    const statusMap = {
      approved: 'pago',
      pending: 'aguardando_pagamento',
      in_process: 'aguardando_pagamento',
      authorized: 'aguardando_pagamento',
      rejected: 'perdido',
      cancelled: 'perdido',
      charged_back: 'perdido',
      refunded: 'perdido'
    };
    const newStatus = statusMap[payment.status] || payment.status;

    if (newStatus === 'perdido') {
      // Pagamento recusado/cancelado/estornado: devolve o estoque reservado por esta venda.
      const saleBefore = saleQueries.byId.get(externalReference);
      if (saleBefore) restoreStockForSale(tenantId, saleBefore);
      // Automações: venda perdida invalida lembretes pendentes dela.
      cancelPendingJobsForSale(tenantId, externalReference, null);
    }
    saleQueries.updateStatusMp.run(newStatus, paymentId, externalReference);

    // Cobranças de taxa pertencem à Agenda, não ao funil de produtos.
    const paidAppointment = appointmentQueries.bySaleId.get(externalReference);
    if (paidAppointment) {
      if (newStatus === 'pago') {
        appointmentQueries.markFeePaid.run(externalReference);
        const text = `💳 Taxa recebida! Seu pedido de agendamento para ${paidAppointment.service_name} em ${formatBookingDateTime(paidAppointment.starts_at)} agora aguarda a confirmação do estabelecimento.`;
        const phone = paidAppointment.customer_phone
          || (paidAppointment.contact_id ? contactQueries.byId.get(paidAppointment.contact_id)?.wa_phone : '');
        if (phone) {
          await sendText(decTenant, phone, text).catch((e) =>
            console.error('[Agenda] aviso de taxa paga:', e.message)
          );
          if (paidAppointment.contact_id) {
            messageQueries.insert.run(paidAppointment.contact_id, 'assistant', text);
            contactQueries.touch.run(paidAppointment.contact_id);
          }
        }
      }
      return;
    }

    if (newStatus === 'pago') {
      const sale = saleQueries.byId.get(externalReference);
      if (sale && sale.contact_id) {
        contactQueries.updateAfterTurn.run({
          id: sale.contact_id,
          stage: 'fechado',
          buy_intent: 'alta',
          summary: 'Pagamento confirmado via Mercado Pago',
          name: null,
          last_produto_mencionado: null
        });
        
        const contact = contactQueries.byId.get(sale.contact_id);
        if (contact) {
          const amountVal = sale.total_cents ? (sale.total_cents / 100) : (sale.amount || 0);
          const mensagem = `🎉 Olá! Passando para confirmar que seu pagamento de R$ ${amountVal.toFixed(2).replace('.', ',')} foi aprovado com sucesso! Já estamos preparando o seu pedido.`;
          await sendText(decTenant, contact.wa_phone, mensagem);
          messageQueries.insert.run(contact.id, 'assistant', mensagem);
          contactQueries.touch.run(contact.id);

          // Integrações de saída (Bling + webhook genérico): mesmo ponto onde a
          // venda vira "pago" de verdade. Nunca deve travar a confirmação ao
          // cliente acima — por isso vêm depois e não são aguardadas com throw.
          pushOrderToBling(decTenant, sale).catch((e) => console.error('[Bling] push falhou:', e.message));
          dispatchWebhookEvent(decTenant, 'sale.paid', {
            sale_id: sale.id,
            contact_phone: contact.wa_phone,
            contact_name: contact.name,
            amount: sale.total_cents ? sale.total_cents / 100 : (sale.amount || 0),
          }).catch(() => {});
          sendPushEvent({
            tenantId: decTenant.id,
            event: 'sale_paid',
            title: 'Venda confirmada',
            body: 'Um novo pagamento foi aprovado.',
            url: '/vendas.html?filter=pago',
            dedupeKey: `sale_paid:${sale.id}`,
            cooldownMinutes: 60 * 24,
          }).catch(() => {});
          cancelPendingJobsForSale(decTenant.id, sale.id, sale.contact_id);
          emitDomainEvent({
            tenantId: decTenant.id,
            type: 'sale_paid',
            entityType: 'sale',
            entityId: sale.id,
            payload: { amount: sale.total_cents ? sale.total_cents / 100 : (sale.amount || 0) },
          });

          // Produtos digitais (ebook, curso, receita etc.): entrega automática
          // do link assim que o pagamento é confirmado de verdade — nunca antes.
          const biz = normalizeBusiness(decTenant.business_json);
          const entregas = getDigitalDeliveryItems(biz.produtos, sale.items_json);
          for (const entrega of entregas) {
            const msgEntrega = `📦 Aqui está o seu acesso a "${entrega.nome}":\n${entrega.link}`;
            await sendText(decTenant, contact.wa_phone, msgEntrega).catch((e) =>
              console.error(`Falha ao entregar produto digital "${entrega.nome}":`, e.message)
            );
            messageQueries.insert.run(contact.id, 'assistant', msgEntrega);
          }
        }
      }
    }
  } catch (e) {
    console.error('MP checkout webhook error:', e.message);
  }
});

// --- Hotmart (produtos digitais) — configuração (Elite/Especial) ---
apiRouter.post('/api/hotmart/config', requireAuth, requireCsrf, requirePlan('elite'), (req, res) => {
  const { hottok } = req.body || {};
  if (!hottok || typeof hottok !== 'string' || hottok.trim().length < 8) {
    return res.status(400).json({ error: 'Hottok inválido.' });
  }
  tenantQueries.setHotmartCredentials.run({ id: req.tenant.id, hotmart_hottok: encryptSecret(hottok.trim()) });
  res.json({ ok: true, webhook_url: `${config.appUrl.replace(/\/$/, '')}/api/hotmart/webhook/${req.tenant.id}` });
});

apiRouter.post('/api/hotmart/disconnect', requireAuth, requireCsrf, (req, res) => {
  tenantQueries.clearHotmartCredentials.run(req.tenant.id);
  res.json({ ok: true });
});

// Webhook do Hotmart (chamado pelo Hotmart, não pelo navegador do lojista —
// sem sessão/CSRF, autenticado só pelo Hottok cadastrado por tenant).
apiRouter.post('/api/hotmart/webhook/:tenantId', async (req, res) => {
  res.sendStatus(200); // Hotmart exige resposta rápida (2xx), processa depois
  try {
    const tenant = tenantQueries.byId.get(req.params.tenantId);
    if (!tenant) return;
    const decTenant = decryptTenant(tenant);
    if (!decTenant.hotmart_hottok || !planAtLeast(effectivePlanId(decTenant.plan, subscriptionState(decTenant).status), 'elite')) return;

    const received = req.headers['x-hotmart-hottok'] || req.body?.hottok;
    if (!hotmartTokenMatches(received, decTenant.hotmart_hottok)) {
      console.warn('Hotmart webhook: hottok inválido para tenant', decTenant.id);
      return;
    }

    const evt = parseHotmartEvent(req.body);
    if (!evt) return;

    if (evt.status === 'pago') {
      if (!evt.phone) return;
      let contact = contactQueries.byPhone.get(decTenant.id, evt.phone);
      if (!contact) {
        const info = contactQueries.insert.run(decTenant.id, evt.phone, evt.buyerName);
        contact = contactQueries.byId.get(info.lastInsertRowid);
      }

      const itemsJson = JSON.stringify([{ titulo: evt.productName || 'Produto Hotmart', quantidade: 1, valor_unitario: evt.priceValue }]);
      const saleId = randomUUID();
      saleQueries.create.run({
        id: saleId,
        tenant_id: decTenant.id,
        contact_id: contact.id,
        status: 'pago',
        items_json: itemsJson,
        total_cents: Math.round(evt.priceValue * 100),
        checkout_url: null,
        payment_provider: 'hotmart',
        external_payment_id: evt.transactionId,
        notes: null,
      });
      saleQueries.updateStatus.run({ id: saleId, tenant_id: decTenant.id, status: 'pago' });

      contactQueries.updateAfterTurn.run({
        id: contact.id,
        stage: 'fechado',
        buy_intent: 'alta',
        summary: `Compra aprovada via Hotmart: ${evt.productName || ''}`.trim(),
        name: null,
        last_produto_mencionado: null,
      });
      contactQueries.touch.run(contact.id);

      const mensagem = `🎉 Olá! Seu pagamento de R$ ${evt.priceValue.toFixed(2).replace('.', ',')} pelo Hotmart foi aprovado com sucesso!`;
      await sendText(decTenant, contact.wa_phone, mensagem).catch(() => {});
      messageQueries.insert.run(contact.id, 'assistant', mensagem);

      const biz = normalizeBusiness(decTenant.business_json);
      const entregas = getDigitalDeliveryItems(biz.produtos, itemsJson);
      for (const entrega of entregas) {
        const msgEntrega = `📦 Aqui está o seu acesso a "${entrega.nome}":\n${entrega.link}`;
        await sendText(decTenant, contact.wa_phone, msgEntrega).catch((e) =>
          console.error(`Falha ao entregar produto digital "${entrega.nome}":`, e.message)
        );
        messageQueries.insert.run(contact.id, 'assistant', msgEntrega);
      }

      pushOrderToBling(decTenant, saleQueries.byId.get(saleId)).catch((e) => console.error('[Bling] push falhou:', e.message));
      dispatchWebhookEvent(decTenant, 'sale.paid', {
        sale_id: saleId,
        contact_phone: contact.wa_phone,
        contact_name: contact.name,
        amount: evt.priceValue,
      }).catch(() => {});
      sendPushEvent({
        tenantId: decTenant.id,
        event: 'sale_paid',
        title: 'Venda confirmada',
        body: 'Um novo pagamento foi aprovado.',
        url: '/vendas.html?filter=pago',
        dedupeKey: `sale_paid:${saleId}`,
        cooldownMinutes: 60 * 24,
      }).catch(() => {});
      cancelPendingJobsForSale(decTenant.id, saleId, contact.id);
      emitDomainEvent({
        tenantId: decTenant.id,
        type: 'sale_paid',
        entityType: 'sale',
        entityId: saleId,
        payload: { amount: evt.priceValue },
      });
    } else if (evt.transactionId) {
      // Reembolso/chargeback/cancelamento: marca como perdido a venda com essa transação.
      const existing = db.prepare(`SELECT * FROM sales WHERE tenant_id = ? AND external_payment_id = ? AND payment_provider = 'hotmart'`).get(decTenant.id, evt.transactionId);
      if (existing) saleQueries.updateStatus.run({ id: existing.id, tenant_id: decTenant.id, status: 'perdido' });
    }
  } catch (e) {
    console.error('Hotmart webhook error:', e.message);
  }
});

// --- Google Sheets OAuth (planilha automática de CRM) ---
apiRouter.get('/api/google-sheets/oauth/start', requireAuth, (req, res) => {
  if (!googleSheetsEnabled) return res.redirect('/integrations.html?gs_error=not_configured');
  try {
    res.redirect(googleOAuthUrl(req.sessionToken));
  } catch (e) {
    console.error('[google-sheets] oauth start', e.message);
    res.redirect('/integrations.html?gs_error=not_configured');
  }
});
apiRouter.get('/api/google-sheets/oauth/callback', requireAuth, async (req, res) => {
  if (!googleSheetsEnabled) return res.redirect('/integrations.html?gs_error=not_configured');
  const { code, state } = req.query;
  if (!code || !verifyGoogleOAuthState(req.sessionToken, state)) {
    return res.redirect('/integrations.html?gs_error=invalid_state');
  }
  try {
    await connectGoogleSheets(req.tenant, String(code));
    res.redirect('/integrations.html?gs_connected=1');
  } catch (e) {
    console.error('[google-sheets] oauth callback', e.message);
    res.redirect('/integrations.html?gs_error=oauth_failed');
  }
});
apiRouter.get('/api/google-sheets/status', requireAuth, (req, res) => {
  res.json(googleSheetsStatus(req.tenant.id));
});
apiRouter.post('/api/google-sheets/sync', requireAuth, requireCsrf, async (req, res) => {
  try {
    const status = await syncGoogleSheets(req.tenant);
    res.json({ ok: true, ...status });
  } catch (e) {
    console.error('[google-sheets] sync', e.message);
    res.status(400).json({ error: 'Não foi possível sincronizar a planilha. Tente novamente.' });
  }
});
apiRouter.post('/api/google-sheets/disconnect', requireAuth, requireCsrf, (req, res) => {
  disconnectGoogleSheets(req.tenant.id);
  res.json({ ok: true });
});

// --- Nuvemshop (Tiendanube) OAuth — sincroniza produtos/estoque (Elite/Especial) ---
// Diferente do Bling/Mercado Pago, a Nuvemshop não aceita um parâmetro "state"
// na URL de autorização (o app_id vai no PATH, não em query string) — não dá
// pra validar um state que ela nunca ecoa de volta. A proteção contra CSRF
// aqui é o próprio requireAuth no callback: só o tenant já logado no navegador
// que iniciou o fluxo consegue completar a conexão.
apiRouter.get('/api/nuvemshop/oauth/start', requireAuth, requirePlan('elite'), (req, res) => {
  if (!nuvemshopOAuthEnabled) return res.status(404).json({ error: 'Nuvemshop OAuth não configurado.' });
  res.redirect(`https://www.tiendanube.com/apps/${config.nuvemshopOAuthAppId}/authorize`);
});

apiRouter.get('/api/nuvemshop/oauth/callback', requireAuth, async (req, res) => {
  if (!nuvemshopOAuthEnabled) return res.redirect('/integrations.html?nuvemshop_error=not_configured');
  const { code } = req.query;
  if (!code || typeof code !== 'string') return res.redirect('/integrations.html?nuvemshop_error=oauth_failed');

  try {
    const data = await exchangeNuvemshopCode(code);
    tenantQueries.setNuvemshopCredentials.run({
      id: req.tenant.id,
      nuvemshop_access_token: encryptSecret(data.access_token),
      nuvemshop_store_id: String(data.user_id),
    });
    res.redirect('/integrations.html?nuvemshop_connected=1');
  } catch (e) {
    console.error('Nuvemshop OAuth error:', e.message);
    res.redirect('/integrations.html?nuvemshop_error=oauth_failed');
  }
});

apiRouter.post('/api/nuvemshop/disconnect', requireAuth, requireCsrf, (req, res) => {
  tenantQueries.clearNuvemshopCredentials.run(req.tenant.id);
  res.json({ ok: true });
});

// --- Nuvemshop LGPD (exigido pela plataforma para qualquer app aprovado) ---
// O Zapien nunca lê nem armazena dados de CLIENTE da loja (só nome/estoque de
// produto, escopo "Products"), então não há nada pra apagar/exportar em
// nenhum dos três casos — só reconhecemos o evento.
apiRouter.post('/api/nuvemshop/webhooks/store-redact', (req, res) => res.sendStatus(200));
apiRouter.post('/api/nuvemshop/webhooks/customers-redact', (req, res) => res.sendStatus(200));
apiRouter.post('/api/nuvemshop/webhooks/customers-data-request', (req, res) => res.sendStatus(200));

// --- Tray OAuth — sincroniza produtos/estoque (Elite/Especial) ---
apiRouter.get('/api/tray/oauth/start', requireAuth, requirePlan('elite'), (req, res) => {
  if (!trayOAuthEnabled) return res.status(404).json({ error: 'Tray OAuth não configurado.' });
  const state = createHmac('sha256', config.sessionSecret).update(req.sessionToken).digest('hex');
  const base = `${req.protocol}://${req.get('host')}`;
  const params = new URLSearchParams({
    client_id: config.trayOAuthAppId,
    response_type: 'code',
    state,
    redirect_uri: `${base}/api/tray/oauth/callback`,
  });
  res.redirect(`https://www.tray.com.br/auth/oauth?${params}`);
});

apiRouter.get('/api/tray/oauth/callback', requireAuth, async (req, res) => {
  if (!trayOAuthEnabled) return res.redirect('/integrations.html?tray_error=not_configured');
  const { code, state, api_address } = req.query;
  const stateNorm = typeof state === 'string' ? state.toLowerCase() : '';
  const expected = createHmac('sha256', config.sessionSecret).update(req.sessionToken).digest('hex');
  const validState =
    stateNorm.length === expected.length &&
    /^[0-9a-f]+$/.test(stateNorm) &&
    timingSafeEqual(Buffer.from(stateNorm, 'hex'), Buffer.from(expected, 'hex'));
  if (!validState) return res.redirect('/integrations.html?tray_error=invalid_state');
  if (!api_address) return res.redirect('/integrations.html?tray_error=missing_api_address');

  try {
    const data = await exchangeTrayCode(code, api_address);
    const expiresAt = new Date(Date.now() + (Number(data.date_expiration ? new Date(data.date_expiration) - Date.now() : 14 * 24 * 60 * 60 * 1000)).valueOf()).toISOString();
    tenantQueries.setTrayCredentials.run({
      id: req.tenant.id,
      tray_access_token: encryptSecret(data.access_token),
      tray_refresh_token: encryptSecret(data.refresh_token),
      tray_token_expires_at: expiresAt,
      tray_api_address: String(api_address),
    });
    res.redirect('/integrations.html?tray_connected=1');
  } catch (e) {
    console.error('Tray OAuth error:', e.message);
    res.redirect('/integrations.html?tray_error=oauth_failed');
  }
});

apiRouter.post('/api/tray/disconnect', requireAuth, requireCsrf, (req, res) => {
  tenantQueries.clearTrayCredentials.run(req.tenant.id);
  res.json({ ok: true });
});

// Recebe o catalogo PDF e enfileira a leitura/indexacao em segundo plano.
apiRouter.post('/api/catalog/import', requireAuth, requireCsrf, requirePlan('pro'), importLimiter, uploadGuard, upload.single('catalog'), requireMagicBytes, enforcePlanFileSize('catalogPdfMb'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo PDF enviado.' });
  try {
    // Buffer lido só depois das validações de tipo/plano; não guardar cópias.
    if (!ALLOWED_DOCUMENT_MIME.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Apenas arquivos PDF sao aceitos.' });
    }
    const pdfBuffer = readUploadBuffer(req.file);
    const filename = req.file.originalname || 'catalogo.pdf';
    catalogFileQueries.upsert.run(req.tenant.id, filename, pdfBuffer);
    const created = createKnowledgeDocumentFromUpload({
      tenantId: req.tenant.id,
      sourceType: 'catalog',
      sourceId: req.tenant.id,
      file: req.file,
      buffer: pdfBuffer,
      active: 0,
    });
    if (created.duplicate) {
      return res.json({ ok: true, document_id: created.documentId, status: created.status, duplicate: true });
    }
    if (!created.queued) {
      return res.status(429).json({ error: 'Ha muitos documentos em processamento. Tente novamente em instantes.', document_id: created.documentId });
    }
    res.status(202).json({ ok: true, document_id: created.documentId, status: 'queued' });
  } catch (err) {
    console.error('catalog import:', err);
    res.status(500).json({ error: 'Erro ao receber o catalogo: ' + err.message });
  }
});

apiRouter.delete('/api/catalog/delete', requireAuth, requireCsrf, (req, res) => {
  const rows = db.prepare(`SELECT * FROM knowledge_documents WHERE tenant_id = ? AND source_type = 'catalog'`).all(req.tenant.id);
  deleteKnowledgeDocumentRows(rows);
  catalogFileQueries.delete.run(req.tenant.id);
  res.json({ ok: true });
});

// --- Documentos extras (biblioteca de PDFs do tenant, além do catálogo principal) ---
// Sujeitos a limites por plano: quantidade (extraDocsMax), tamanho por arquivo
// (extraDocMb) e armazenamento total (hasStorageRoom, que soma catálogo + mídia
// recebida + documentos extras). Essencial não tem acesso (extraDocsMax = 0).

apiRouter.get('/api/documents', requireAuth, (req, res) => {
  const documents = db.prepare(`
    SELECT ed.id, ed.filename, ed.mime, ed.size_bytes, ed.created_at,
           kd.id AS knowledge_document_id, kd.status, kd.progress_percent,
           kd.page_count, kd.indexed_pages, kd.chunks_count, kd.active,
           kd.error_code, kd.error_message, kd.processed_at
    FROM extra_documents ed
    LEFT JOIN knowledge_documents kd
      ON kd.tenant_id = ed.tenant_id
     AND kd.source_type = 'extra_document'
     AND kd.source_id = ed.id
    WHERE ed.tenant_id = ?
    ORDER BY ed.created_at DESC
  `).all(req.tenant.id);
  res.json({ documents });
});

apiRouter.post('/api/documents', requireAuth, requireCsrf, uploadGuard, upload.single('document'), requireMagicBytes, (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  if (!ALLOWED_DOCUMENT_MIME.includes(file.mimetype)) {
    return res.status(400).json({ error: 'Apenas arquivos PDF são aceitos.' });
  }

  const t = req.tenant;
  const limits = getPlanLimits(t.plan, subscriptionState(t).status);
  if (!limits.extraDocsMax) {
    return res.status(403).json({
      error: `Documentos extras não estão disponíveis no plano ${limits.label}. Faça upgrade para usar este recurso.`,
      upgrade_required: 'pro',
    });
  }
  if (file.size > limits.extraDocMb * 1024 * 1024) {
    return res.status(413).json({
      error: `Arquivo muito grande para o plano ${limits.label}. ${planLimitMessage(limits, 'extra_document')}`,
    });
  }
  const buffer = readUploadBuffer(file);
  const duplicate = db.prepare(`
    SELECT id, status
    FROM knowledge_documents
    WHERE tenant_id = ?
      AND sha256 = ?
      AND status NOT IN ('failed', 'rejected_limit', 'disabled')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(t.id, sha256Buffer(buffer));
  if (duplicate) {
    return res.json({ ok: true, document_id: duplicate.id, status: duplicate.status, duplicate: true });
  }
  if (extraDocumentQueries.countByTenant.get(t.id).n >= limits.extraDocsMax) {
    return res.status(400).json({
      error: `Seu plano ${limits.label} permite no máximo ${limits.extraDocsMax} documentos extras. Apague um documento antigo ou faça upgrade.`,
    });
  }
  const room = hasStorageRoom(t, file.size);
  if (!room.ok) return res.status(413).json({ error: STORAGE_LIMIT_MESSAGE });

  const id = randomUUID();
  const filename = file.originalname || 'documento.pdf';
  extraDocumentQueries.insert.run(id, t.id, filename, file.mimetype, buffer, file.size);
  const created = createKnowledgeDocumentFromUpload({
    tenantId: t.id,
    sourceType: 'extra_document',
    sourceId: id,
    file,
    buffer,
    active: 0,
  });
  if (created.duplicate) {
    extraDocumentQueries.delete.run(id, t.id);
    return res.json({ ok: true, document_id: created.documentId, status: created.status, duplicate: true });
  }
  if (!created.queued) {
    const row = knowledgeDocumentQueries.byId.get(created.documentId);
    if (row) deleteKnowledgeDocumentRows([row]);
    extraDocumentQueries.delete.run(id, t.id);
    return res.status(429).json({ error: 'Ha muitos documentos em processamento. Tente novamente em instantes.', id, document_id: created.documentId });
  }
  res.status(202).json({ ok: true, id, document_id: created.documentId, filename, size_bytes: file.size, status: 'queued' });
});

apiRouter.delete('/api/documents/:id', requireAuth, requireCsrf, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM knowledge_documents
    WHERE tenant_id = ? AND source_type = 'extra_document' AND source_id = ?
  `).all(req.tenant.id, req.params.id);
  deleteKnowledgeDocumentRows(rows);
  const info = extraDocumentQueries.delete.run(req.params.id, req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'Documento não encontrado.' });
  res.json({ ok: true });
});

// Download de documento extra — só a sessão do tenant dono (painel).
apiRouter.get('/api/documents/:id/download', requireAuth, (req, res) => {
  const doc = extraDocumentQueries.get.get(req.params.id, req.tenant.id);
  if (!doc) return res.status(404).send('Documento não encontrado.');
  const safeName = (doc.filename || 'documento.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  res.setHeader('Content-Type', doc.mime || 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.send(Buffer.from(doc.content));
});

apiRouter.get('/api/knowledge/documents', requireAuth, (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json({ documents: knowledgeDocumentQueries.listByTenant.all(req.tenant.id, limit, offset) });
});

apiRouter.get('/api/knowledge/documents/:id', requireAuth, (req, res) => {
  const doc = knowledgeDocumentQueries.byIdForTenant.get(req.params.id, req.tenant.id);
  if (!doc) return res.status(404).json({ error: 'Documento nao encontrado.' });
  res.json({ document: doc });
});

apiRouter.get('/api/knowledge/documents/:id/chunks', requireAuth, (req, res) => {
  const doc = knowledgeDocumentQueries.byIdForTenant.get(req.params.id, req.tenant.id);
  if (!doc) return res.status(404).json({ error: 'Documento nao encontrado.' });
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json({ chunks: knowledgeChunkQueries.listByDocument.all(req.tenant.id, req.params.id, limit, offset) });
});

apiRouter.get('/api/knowledge/documents/:id/products', requireAuth, (req, res) => {
  const doc = knowledgeDocumentQueries.byIdForTenant.get(req.params.id, req.tenant.id);
  if (!doc) return res.status(404).json({ error: 'Documento nao encontrado.' });
  const products = knowledgeProductQueries.listByDocument.all(req.tenant.id, req.params.id).map((row) => ({
    id: row.id,
    status: row.status,
    duplicate_hint: row.duplicate_hint,
    created_at: row.created_at,
    product: JSON.parse(row.product_json || '{}'),
  }));
  res.json({ products });
});

apiRouter.post('/api/knowledge/documents/:id/reprocess', requireAuth, requireCsrf, (req, res) => {
  const doc = knowledgeDocumentQueries.byIdForTenant.get(req.params.id, req.tenant.id);
  if (!doc) return res.status(404).json({ error: 'Documento nao encontrado.' });
  const queued = enqueueKnowledgeJob({ tenantId: req.tenant.id, documentId: doc.id, type: 'rebuild_index' });
  if (!queued.ok) return res.status(429).json({ error: 'Ha muitos documentos em processamento. Tente novamente em instantes.' });
  knowledgeDocumentQueries.updateQueued.run(doc.id);
  res.status(202).json({ ok: true, document_id: doc.id, status: 'queued' });
});

apiRouter.post('/api/knowledge/documents/:id/enable', requireAuth, requireCsrf, (req, res) => {
  const info = knowledgeDocumentQueries.enable.run(req.params.id, req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'Documento nao encontrado.' });
  res.json({ ok: true });
});

apiRouter.post('/api/knowledge/documents/:id/disable', requireAuth, requireCsrf, (req, res) => {
  const info = knowledgeDocumentQueries.disable.run(req.params.id, req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'Documento nao encontrado.' });
  res.json({ ok: true });
});

apiRouter.delete('/api/knowledge/documents/:id', requireAuth, requireCsrf, (req, res) => {
  const doc = knowledgeDocumentQueries.byIdForTenant.get(req.params.id, req.tenant.id);
  if (!doc) return res.status(404).json({ error: 'Documento nao encontrado.' });
  deleteKnowledgeDocumentRows([doc]);
  if (doc.source_type === 'catalog') {
    catalogFileQueries.delete.run(req.tenant.id);
  }
  res.json({ ok: true });
});

// --- Marketing & Conversões API Endpoints ---

// Schemas
const marketingLinkSchema = z.object({
  name: z.string().trim().min(2).max(100, 'Nome deve ter entre 2 e 100 caracteres.'),
  slug: z.string().trim().min(2).max(50, 'Slug deve ter entre 2 e 50 caracteres.').regex(/^[a-z0-9_-]+$/i, 'Slug com caracteres inválidos.'),
  source: z.string().trim().min(1).max(100, 'Origem é obrigatória.'),
  medium: z.string().trim().min(1).max(100, 'Mídia é obrigatória.'),
  campaign: z.string().trim().min(1).max(100, 'Campanha é obrigatória.'),
  content: z.string().trim().max(100).optional().nullable(),
  term: z.string().trim().max(100).optional().nullable(),
  meta_campaign_id: z.string().trim().max(100).optional().nullable(),
  meta_adset_id: z.string().trim().max(100).optional().nullable(),
  meta_ad_id: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  active: z.union([z.boolean(), z.number()]).optional().default(true),
});

const capiConfigSchema = z.object({
  capi_enabled: z.union([z.boolean(), z.number()]),
  capi_pixel_id: z.string().trim().max(100).optional().nullable(),
  capi_access_token: z.string().trim().max(1000).optional().nullable(),
  capi_test_code: z.string().trim().max(100).optional().nullable(),
  capi_graph_version: z.string().trim().max(20).optional().default('v21.0'),
});

apiRouter.get('/api/marketing/links', requireAuth, (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = db.prepare(`
    SELECT * FROM marketing_links
     WHERE tenant_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?
  `).all(req.tenant.id, limit, offset);
  const total = marketingLinkQueries.countByTenant.get(req.tenant.id).count;
  res.json({ links: rows, total });
});

apiRouter.post('/api/marketing/links', requireAuth, requireCsrf, (req, res) => {
  const sub = subscriptionState(req.tenant);
  const limits = getPlanLimits(req.tenant.plan, sub.status);
  const currentCount = marketingLinkQueries.countByTenant.get(req.tenant.id).count;
  if (currentCount >= limits.marketingLinksMax) {
    return res.status(403).json({ error: `Limite de links de marketing atingido para o seu plano (${limits.marketingLinksMax}).` });
  }

  let data;
  try {
    data = validate(marketingLinkSchema, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const existing = db.prepare(`SELECT id FROM marketing_links WHERE tenant_id = ? AND slug = ?`).get(req.tenant.id, data.slug);
  if (existing) {
    return res.status(400).json({ error: 'Este slug já está em uso por outro link de marketing.' });
  }

  const id = 'mlk_' + randomUUID().replace(/-/g, '').slice(0, 24);
  marketingLinkQueries.insert.run({
    id,
    tenant_id: req.tenant.id,
    name: data.name,
    slug: data.slug.toLowerCase(),
    source: data.source,
    medium: data.medium,
    campaign: data.campaign,
    content: data.content || null,
    term: data.term || null,
    meta_campaign_id: data.meta_campaign_id || null,
    meta_adset_id: data.meta_adset_id || null,
    meta_ad_id: data.meta_ad_id || null,
    notes: data.notes || null,
    active: data.active ? 1 : 0,
  });

  res.status(201).json({ id, slug: data.slug });
});

apiRouter.get('/api/marketing/links/:id', requireAuth, (req, res) => {
  const link = marketingLinkQueries.byId.get(req.params.id, req.tenant.id);
  if (!link) return res.status(404).json({ error: 'Link de marketing não encontrado.' });
  res.json({ link });
});

apiRouter.put('/api/marketing/links/:id', requireAuth, requireCsrf, (req, res) => {
  const link = marketingLinkQueries.byId.get(req.params.id, req.tenant.id);
  if (!link) return res.status(404).json({ error: 'Link de marketing não encontrado.' });

  let data;
  try {
    data = validate(marketingLinkSchema, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const existing = db.prepare(`
    SELECT id FROM marketing_links WHERE tenant_id = ? AND slug = ? AND id != ?
  `).get(req.tenant.id, data.slug, req.params.id);
  if (existing) {
    return res.status(400).json({ error: 'Este slug já está em uso por outro link de marketing.' });
  }

  marketingLinkQueries.update.run({
    id: req.params.id,
    tenant_id: req.tenant.id,
    name: data.name,
    source: data.source,
    medium: data.medium,
    campaign: data.campaign,
    content: data.content || null,
    term: data.term || null,
    meta_campaign_id: data.meta_campaign_id || null,
    meta_adset_id: data.meta_adset_id || null,
    meta_ad_id: data.meta_ad_id || null,
    notes: data.notes || null,
    active: data.active ? 1 : 0,
  });

  res.json({ ok: true });
});

apiRouter.delete('/api/marketing/links/:id', requireAuth, requireCsrf, (req, res) => {
  const info = marketingLinkQueries.delete.run(req.params.id, req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'Link de marketing não encontrado.' });
  res.json({ ok: true });
});

apiRouter.post('/api/marketing/links/:id/toggle', requireAuth, requireCsrf, (req, res) => {
  const link = marketingLinkQueries.byId.get(req.params.id, req.tenant.id);
  if (!link) return res.status(404).json({ error: 'Link de marketing não encontrado.' });
  const newActive = link.active ? 0 : 1;
  marketingLinkQueries.toggleActive.run(newActive, req.params.id, req.tenant.id);
  res.json({ ok: true, active: newActive === 1 });
});

apiRouter.post('/api/marketing/links/:id/duplicate', requireAuth, requireCsrf, (req, res) => {
  const sub = subscriptionState(req.tenant);
  const limits = getPlanLimits(req.tenant.plan, sub.status);
  const currentCount = marketingLinkQueries.countByTenant.get(req.tenant.id).count;
  if (currentCount >= limits.marketingLinksMax) {
    return res.status(403).json({ error: `Limite de links de marketing atingido para o seu plano (${limits.marketingLinksMax}).` });
  }

  const link = marketingLinkQueries.byId.get(req.params.id, req.tenant.id);
  if (!link) return res.status(404).json({ error: 'Link de marketing não encontrado.' });

  let newSlug = `${link.slug}-copia`;
  let attempts = 1;
  while (db.prepare(`SELECT id FROM marketing_links WHERE tenant_id = ? AND slug = ?`).get(req.tenant.id, newSlug)) {
    newSlug = `${link.slug}-copia-${attempts}`;
    attempts++;
  }

  const id = 'mlk_' + randomUUID().replace(/-/g, '').slice(0, 24);
  marketingLinkQueries.insert.run({
    id,
    tenant_id: req.tenant.id,
    name: `${link.name} (Cópia)`,
    slug: newSlug,
    source: link.source,
    medium: link.medium,
    campaign: link.campaign,
    content: link.content,
    term: link.term,
    meta_campaign_id: link.meta_campaign_id,
    meta_adset_id: link.meta_adset_id,
    meta_ad_id: link.meta_ad_id,
    notes: link.notes,
    active: link.active,
  });

  res.status(201).json({ id, slug: newSlug });
});

apiRouter.get('/api/marketing/links/:id/qr', requireAuth, (req, res) => {
  const link = marketingLinkQueries.byId.get(req.params.id, req.tenant.id);
  if (!link) return res.status(404).json({ error: 'Link de marketing não encontrado.' });

  const appUrl = config.appUrl || `${req.protocol}://${req.get('host')}`;
  const targetUrl = `${appUrl}/l/${link.slug}`;
  const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=300x300&chl=${encodeURIComponent(targetUrl)}`;

  res.json({ targetUrl, qrUrl });
});

apiRouter.get('/api/marketing/stats', requireAuth, (req, res) => {
  const model = req.query.attribution_model === 'first_touch' ? 'first_touch' : 'last_touch';
  const retentionDays = Number(req.query.days) || 30;
  const clickJoinCol = model === 'first_touch' ? 'first_touch_click_id' : 'last_touch_click_id';

  const stats = db.prepare(`
    SELECT
      ml.id,
      ml.name,
      ml.slug,
      ml.source,
      ml.medium,
      ml.campaign,
      ml.active,
      (SELECT COUNT(*) FROM attribution_clicks WHERE marketing_link_id = ml.id AND clicked_at >= datetime('now', '-' || ? || ' days')) as clicks,
      (SELECT COUNT(DISTINCT ca.contact_id)
         FROM contact_attributions ca
         JOIN attribution_clicks ac ON ac.id = ca.${clickJoinCol}
        WHERE ac.marketing_link_id = ml.id
          AND ca.created_at >= datetime('now', '-' || ? || ' days')) as contacts,
      (SELECT COUNT(DISTINCT s.id)
         FROM sales s
         JOIN contact_attributions ca ON ca.contact_id = s.contact_id
         JOIN attribution_clicks ac ON ac.id = ca.${clickJoinCol}
        WHERE ac.marketing_link_id = ml.id
          AND s.created_at >= datetime('now', '-' || ? || ' days')) as checkouts,
      (SELECT COUNT(DISTINCT s.id)
         FROM sales s
         JOIN contact_attributions ca ON ca.contact_id = s.contact_id
         JOIN attribution_clicks ac ON ac.id = ca.${clickJoinCol}
        WHERE ac.marketing_link_id = ml.id
          AND s.status = 'paid'
          AND s.paid_at >= datetime('now', '-' || ? || ' days')) as sales,
      (SELECT COALESCE(SUM(COALESCE(s.total_cents / 100, s.amount, 0)), 0)
         FROM sales s
         JOIN contact_attributions ca ON ca.contact_id = s.contact_id
         JOIN attribution_clicks ac ON ac.id = ca.${clickJoinCol}
        WHERE ac.marketing_link_id = ml.id
          AND s.status = 'paid'
          AND s.paid_at >= datetime('now', '-' || ? || ' days')) as revenue
    FROM marketing_links ml
    WHERE ml.tenant_id = ?
    ORDER BY revenue DESC, clicks DESC
  `).all(retentionDays, retentionDays, retentionDays, retentionDays, retentionDays, req.tenant.id);

  res.json({ stats });
});

apiRouter.get('/api/marketing/stats/export', requireAuth, (req, res) => {
  const model = req.query.attribution_model === 'first_touch' ? 'first_touch' : 'last_touch';
  const retentionDays = Number(req.query.days) || 30;
  const clickJoinCol = model === 'first_touch' ? 'first_touch_click_id' : 'last_touch_click_id';

  const stats = db.prepare(`
    SELECT
      ml.name,
      ml.slug,
      ml.source,
      ml.medium,
      ml.campaign,
      (SELECT COUNT(*) FROM attribution_clicks WHERE marketing_link_id = ml.id AND clicked_at >= datetime('now', '-' || ? || ' days')) as clicks,
      (SELECT COUNT(DISTINCT ca.contact_id)
         FROM contact_attributions ca
         JOIN attribution_clicks ac ON ac.id = ca.${clickJoinCol}
        WHERE ac.marketing_link_id = ml.id
          AND ca.created_at >= datetime('now', '-' || ? || ' days')) as contacts,
      (SELECT COUNT(DISTINCT s.id)
         FROM sales s
         JOIN contact_attributions ca ON ca.contact_id = s.contact_id
         JOIN attribution_clicks ac ON ac.id = ca.${clickJoinCol}
        WHERE ac.marketing_link_id = ml.id
          AND s.created_at >= datetime('now', '-' || ? || ' days')) as checkouts,
      (SELECT COUNT(DISTINCT s.id)
         FROM sales s
         JOIN contact_attributions ca ON ca.contact_id = s.contact_id
         JOIN attribution_clicks ac ON ac.id = ca.${clickJoinCol}
        WHERE ac.marketing_link_id = ml.id
          AND s.status = 'paid'
          AND s.paid_at >= datetime('now', '-' || ? || ' days')) as sales,
      (SELECT COALESCE(SUM(COALESCE(s.total_cents / 100, s.amount, 0)), 0)
         FROM sales s
         JOIN contact_attributions ca ON ca.contact_id = s.contact_id
         JOIN attribution_clicks ac ON ac.id = ca.${clickJoinCol}
        WHERE ac.marketing_link_id = ml.id
          AND s.status = 'paid'
          AND s.paid_at >= datetime('now', '-' || ? || ' days')) as revenue
    FROM marketing_links ml
    WHERE ml.tenant_id = ?
    ORDER BY revenue DESC, clicks DESC
  `).all(retentionDays, retentionDays, retentionDays, retentionDays, retentionDays, req.tenant.id);

  const sanitizeCsvCell = (val) => {
    if (val === null || val === undefined) return '';
    let s = String(val).replace(/"/g, '""');
    if (s.startsWith('=') || s.startsWith('+') || s.startsWith('-') || s.startsWith('@') || s.startsWith('\t') || s.startsWith('\r')) {
      s = `'${s}`;
    }
    return `"${s}"`;
  };

  let csv = '\ufeff';
  csv += ['Nome', 'Slug', 'Origem (Source)', 'Mídia (Medium)', 'Campanha', 'Cliques', 'Contatos', 'Checkouts', 'Vendas', 'Faturamento (R$)'].map(sanitizeCsvCell).join(',') + '\n';

  for (const r of stats) {
    csv += [
      r.name,
      r.slug,
      r.source,
      r.medium,
      r.campaign,
      r.clicks,
      r.contacts,
      r.checkouts,
      r.sales,
      r.revenue.toFixed(2)
    ].map(sanitizeCsvCell).join(',') + '\n';
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="marketing-stats.csv"');
  res.send(csv);
});

apiRouter.get('/api/marketing/conversions', requireAuth, (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = marketingConversionQueries.listRecentByTenant.all(req.tenant.id, limit, offset);
  const total = marketingConversionQueries.countByTenant.get(req.tenant.id).count;
  res.json({ conversions: rows, total });
});

apiRouter.get('/api/meta-capi/config', requireAuth, (req, res) => {
  const sub = subscriptionState(req.tenant);
  const limits = getPlanLimits(req.tenant.plan, sub.status);
  if (!limits.metaCapiEnabled) {
    return res.status(403).json({ error: 'Integração Conversions API desativada no seu plano.' });
  }

  res.json({
    capi_enabled: req.tenant.capi_enabled === 1,
    capi_pixel_id: req.tenant.capi_pixel_id || '',
    capi_test_code: req.tenant.capi_test_code || '',
    capi_graph_version: req.tenant.capi_graph_version || 'v21.0',
    has_access_token: Boolean(req.tenant.capi_access_token),
  });
});

apiRouter.put('/api/meta-capi/config', requireAuth, requireCsrf, (req, res) => {
  const sub = subscriptionState(req.tenant);
  const limits = getPlanLimits(req.tenant.plan, sub.status);
  if (!limits.metaCapiEnabled) {
    return res.status(403).json({ error: 'Integração Conversions API desativada no seu plano.' });
  }

  let data;
  try {
    data = validate(capiConfigSchema, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let encryptedToken = req.tenant.capi_access_token || null;
  if (data.capi_access_token) {
    encryptedToken = encryptSecret(data.capi_access_token);
  }

  tenantQueries.updateCapiConfig.run({
    id: req.tenant.id,
    capi_enabled: data.capi_enabled ? 1 : 0,
    capi_pixel_id: data.capi_pixel_id || null,
    capi_access_token: encryptedToken,
    capi_test_code: data.capi_test_code || null,
    capi_graph_version: data.capi_graph_version || 'v21.0',
  });

  clearTenantCache();

  res.json({ ok: true });
});

apiRouter.post('/api/meta-capi/test', requireAuth, requireCsrf, async (req, res) => {
  const sub = subscriptionState(req.tenant);
  const limits = getPlanLimits(req.tenant.plan, sub.status);
  if (!limits.metaCapiEnabled) {
    return res.status(403).json({ error: 'Integração Conversions API desativada no seu plano.' });
  }

  const testCode = String(req.body.test_code || '').trim();
  try {
    const response = await sendTestEvent(req.tenant, testCode || null);
    res.json({ ok: true, response });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/api/meta-capi/status', requireAuth, (req, res) => {
  const sub = subscriptionState(req.tenant);
  const limits = getPlanLimits(req.tenant.plan, sub.status);
  if (!limits.metaCapiEnabled) {
    return res.status(403).json({ error: 'Integração Conversions API desativada no seu plano.' });
  }

  const success24h = conversionJobQueries.countRecentSuccess24h.get(req.tenant.id).count;
  const pending = conversionJobQueries.countPending.get(req.tenant.id).count;
  const lastErr = conversionJobQueries.lastError.get(req.tenant.id);
  const lastDone = conversionJobQueries.lastCompleted.get(req.tenant.id);

  res.json({
    success_24h: success24h,
    pending_jobs: pending,
    last_error: lastErr ? { code: lastErr.last_error_code, summary: lastErr.last_error_summary, created_at: lastErr.created_at } : null,
    last_completed: lastDone ? { completed_at: lastDone.completed_at, conversion_event_id: lastDone.conversion_event_id } : null,
  });
});

// --- PR 2: Equipes, Usuários, Permissões e Distribuição ---

const userInviteSchema = z.object({
  email: z.string().trim().email('E-mail inválido.'),
  role: z.enum(['admin', 'agent'], { errorMap: () => ({ message: 'Papel inválido.' }) }),
});

const teamSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(100),
  description: z.string().trim().max(300).optional().nullable(),
});

const teamMembersSchema = z.object({
  user_ids: z.array(z.string()),
});

const acceptInviteSchema = z.object({
  name: z.string().trim().min(2, 'Nome deve ter pelo menos 2 caracteres.').max(100),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres.').max(100),
});

const assignSchema = z.object({
  user_id: z.string().nullable().optional(),
  team_id: z.string().nullable().optional(),
});

// Usuários: Listar usuários e convites pendentes
apiRouter.get('/api/users', requireAuth, requireRole(['admin']), (req, res) => {
  const users = userQueries.listByTenant.all(req.tenant.id);
  const invites = userInvitationQueries.listByTenant.all(req.tenant.id);
  res.json({ users, invitations: invites });
});

// Usuários: Convidar colaborador por e-mail
apiRouter.post('/api/users/invite', requireAuth, requireRole(['admin']), requireCsrf, async (req, res) => {
  let data;
  try {
    data = validate(userInviteSchema, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const normalizedEmail = data.email.toLowerCase();
  
  // Verifica se já é o dono ou um usuário existente
  if (req.tenant.email === normalizedEmail) {
    return res.status(400).json({ error: 'Este e-mail pertence ao dono da conta principal.' });
  }
  const existingUser = userQueries.byEmail.get(normalizedEmail);
  if (existingUser) {
    return res.status(400).json({ error: 'Um usuário com este e-mail já existe.' });
  }

  // Cancela convites pendentes antigos para o mesmo e-mail
  db.prepare(`DELETE FROM user_invitations WHERE tenant_id = ? AND email = ?`).run(req.tenant.id, normalizedEmail);

  const id = 'inv_' + randomUUID().replace(/-/g, '').slice(0, 24);
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString(); // 48h

  userInvitationQueries.create.run({
    id,
    tenant_id: req.tenant.id,
    email: normalizedEmail,
    role: data.role,
    token,
    expires_at: expiresAt,
  });

  const appUrl = config.appUrl || `${req.protocol}://${req.get('host')}`;
  const inviteUrl = `${appUrl}/accept-invite.html?token=${token}`;

  try {
    await sendInvitationEmail({
      to: data.email,
      inviteUrl,
      companyName: req.tenant.business_name || 'Zapien',
      role: data.role,
    });
    res.json({ ok: true });
  } catch (err) {
    userInvitationQueries.delete.run(id);
    res.status(500).json({ error: `Falha ao enviar e-mail: ${err.message}` });
  }
});

// Usuários: Excluir usuário
apiRouter.delete('/api/users/:id', requireAuth, requireRole(['admin']), requireCsrf, (req, res) => {
  const info = userQueries.delete.run(req.params.id, req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json({ ok: true });
});

// Usuários: Alterar papel
apiRouter.put('/api/users/:id/role', requireAuth, requireRole(['admin']), requireCsrf, (req, res) => {
  const role = req.body.role;
  if (role !== 'admin' && role !== 'agent') {
    return res.status(400).json({ error: 'Papel inválido.' });
  }
  const info = userQueries.updateRole.run(role, req.params.id, req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json({ ok: true });
});

// Usuários: Ativar/desativar
apiRouter.post('/api/users/:id/toggle', requireAuth, requireRole(['admin']), requireCsrf, (req, res) => {
  const user = userQueries.byId.get(req.params.id);
  if (!user || user.tenant_id !== req.tenant.id) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }
  const newActive = user.active ? 0 : 1;
  userQueries.toggleActive.run(newActive, req.params.id, req.tenant.id);
  res.json({ ok: true, active: newActive === 1 });
});

// Usuários: Cancelar convite pendente
apiRouter.delete('/api/users/invitations/:token', requireAuth, requireRole(['admin']), requireCsrf, (req, res) => {
  const info = userInvitationQueries.deleteByToken.run(req.params.token);
  if (!info.changes) return res.status(404).json({ error: 'Convite não encontrado.' });
  res.json({ ok: true });
});

// Equipes: Listar equipes
apiRouter.get('/api/teams', requireAuth, requireRole(['admin']), (req, res) => {
  const teams = teamQueries.listByTenant.all(req.tenant.id);
  res.json({ teams });
});

// Equipes: Criar equipe
apiRouter.post('/api/teams', requireAuth, requireRole(['admin']), requireCsrf, (req, res) => {
  let data;
  try {
    data = validate(teamSchema, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const id = 'team_' + randomUUID().replace(/-/g, '').slice(0, 24);
  teamQueries.create.run({
    id,
    tenant_id: req.tenant.id,
    name: data.name,
    description: data.description || null,
  });
  res.status(201).json({ id });
});

// Equipes: Editar equipe
apiRouter.put('/api/teams/:id', requireAuth, requireRole(['admin']), requireCsrf, (req, res) => {
  let data;
  try {
    data = validate(teamSchema, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const info = teamQueries.update.run(data.name, data.description || null, req.params.id, req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'Equipe não encontrada.' });
  res.json({ ok: true });
});

// Equipes: Excluir equipe
apiRouter.delete('/api/teams/:id', requireAuth, requireRole(['admin']), requireCsrf, (req, res) => {
  const info = teamQueries.delete.run(req.params.id, req.tenant.id);
  if (!info.changes) return res.status(404).json({ error: 'Equipe não encontrada.' });
  res.json({ ok: true });
});

// Equipes: Listar membros
apiRouter.get('/api/teams/:id/members', requireAuth, requireRole(['admin']), (req, res) => {
  const team = teamQueries.byId.get(req.params.id, req.tenant.id);
  if (!team) return res.status(404).json({ error: 'Equipe não encontrada.' });
  const members = teamUserQueries.listMembers.all(req.params.id);
  res.json({ members });
});

// Equipes: Gerenciar membros
apiRouter.post('/api/teams/:id/members', requireAuth, requireRole(['admin']), requireCsrf, (req, res) => {
  const team = teamQueries.byId.get(req.params.id, req.tenant.id);
  if (!team) return res.status(404).json({ error: 'Equipe não encontrada.' });

  let data;
  try {
    data = validate(teamMembersSchema, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  teamUserQueries.clearTeam.run(req.params.id);
  for (const userId of data.user_ids) {
    const user = userQueries.byId.get(userId);
    if (user && user.tenant_id === req.tenant.id) {
      teamUserQueries.add.run(req.params.id, userId);
    }
  }
  res.json({ ok: true });
});

// Atendente: Meu status/perfil
apiRouter.get('/api/agent/me', requireAuth, (req, res) => {
  if (req.user === null) {
    return res.json({
      is_owner: true,
      name: req.tenant.business_name || 'Dono',
      email: req.tenant.email,
      role: 'admin',
      available: 1,
      teams: [],
    });
  }
  const userTeams = teamUserQueries.listUserTeams.all(req.user.id).map(t => t.id);
  res.json({
    is_owner: false,
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    available: req.user.available,
    teams: userTeams,
  });
});

// Atendente: Alterar status de disponibilidade
apiRouter.post('/api/agent/status', requireAuth, requireCsrf, (req, res) => {
  if (req.user === null) {
    return res.status(400).json({ error: 'O Dono principal está sempre disponível.' });
  }
  const available = req.body.available ? 1 : 0;
  userQueries.updateAvailable.run(available, req.user.id, req.tenant.id);
  res.json({ ok: true, available });
});

// Convites: Verificar convite público
apiRouter.get('/api/invite/:token', (req, res) => {
  const invite = userInvitationQueries.byToken.get(req.params.token);
  if (!invite) return res.status(404).json({ error: 'Convite inválido ou expirado.' });
  const tenant = tenantQueries.byId.get(invite.tenant_id);
  res.json({ email: invite.email, role: invite.role, company: tenant?.business_name || 'Zapien' });
});

// Convites: Aceitar convite público
apiRouter.post('/api/invite/:token/accept', loginLimiter, (req, res) => {
  const invite = userInvitationQueries.byToken.get(req.params.token);
  if (!invite) return res.status(404).json({ error: 'Convite inválido ou expirado.' });

  let data;
  try {
    data = validate(acceptInviteSchema, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const passwordHash = hashPassword(data.password);
  const userId = 'usr_' + randomUUID().replace(/-/g, '').slice(0, 24);

  try {
    userQueries.create.run({
      id: userId,
      tenant_id: invite.tenant_id,
      email: invite.email,
      password_hash: passwordHash,
      name: data.name,
      role: invite.role,
      active: 1,
      available: 1,
    });

    userInvitationQueries.delete.run(invite.id);

    const token = randomBytes(32).toString('hex');
    sessionQueries.create.run(token, invite.tenant_id, userId);
    setSessionCookie(res, token);
    res.json({ ok: true });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Conversas: Atribuir manualmente conversa a atendente/equipe
apiRouter.post('/api/contacts/:id/assign', requireAuth, requireCsrf, (req, res) => {
  const contact = contactQueries.byId.get(Number(req.params.id));
  if (!contact || contact.tenant_id !== req.tenant.id) {
    return res.status(404).json({ error: 'Contato não encontrado.' });
  }

  let data;
  try {
    data = validate(assignSchema, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let targetUser = null;
  if (data.user_id) {
    targetUser = userQueries.byId.get(data.user_id);
    if (!targetUser || targetUser.tenant_id !== req.tenant.id) {
      return res.status(400).json({ error: 'Atendente inválido.' });
    }
  }

  let targetTeam = null;
  if (data.team_id) {
    targetTeam = teamQueries.byId.get(data.team_id, req.tenant.id);
    if (!targetTeam) {
      return res.status(400).json({ error: 'Equipe inválida.' });
    }
  }

  contactQueries.assign.run(data.user_id || null, data.team_id || null, contact.id, req.tenant.id);

  let sysMsg = '';
  if (data.user_id && data.team_id) {
    sysMsg = `Conversa atribuída a ${targetUser.name} (${targetTeam.name})`;
  } else if (data.user_id) {
    sysMsg = `Conversa atribuída a ${targetUser.name}`;
  } else if (data.team_id) {
    sysMsg = `Conversa atribuída à equipe ${targetTeam.name}`;
  } else {
    sysMsg = 'Atribuição removida desta conversa';
  }

  db.prepare(`
    INSERT INTO messages (contact_id, role, content, created_at)
    VALUES (?, 'system', ?, datetime('now'))
  `).run(contact.id, sysMsg);

  logAudit(req.tenant.id, 'contact.assign', `Contact ${contact.id} assigned to user=${data.user_id || 'none'} team=${data.team_id || 'none'}`);

  res.json({ ok: true, message: sysMsg });
});

// Listar atendentes e equipes para fins de transferência de chat
apiRouter.get('/api/agent/list-assignables', requireAuth, (req, res) => {
  const users = userQueries.listByTenant.all(req.tenant.id).map(u => ({ id: u.id, name: u.name }));
  const teams = teamQueries.listByTenant.all(req.tenant.id).map(t => ({ id: t.id, name: t.name }));
  res.json({ users, teams });
});
