import { Router } from 'express';
import { createHmac, timingSafeEqual, randomBytes, createHash, randomUUID } from 'node:crypto';
import { config, audioTranscriptionEnabled } from './config.js';
import { isValidRouteCode } from './braille.js';         // compat — formato Braille antigo
import { isValidEntryCode } from './entry.js';            // formato com pontuação natural
import { isValidAttendanceCode } from './db.js';          // novo formato TX579
import {
  tenantQueries,
  customerRouteQueries,
  contactQueries,
  messageQueries,
  aiUsageQueries,
  saleQueries,
  catalogFileQueries,
  waTokenQueries,
  mediaQueries,
  getOrCreateContact,
  getConversation,
  subscriptionState,
  decryptTenant,
  isDuplicateInboundMessage,
  productWaitlistQueries,
  notificationQueries,
  attributionClickQueries,
  contactAttributionQueries,
  marketingLinkQueries,
  userQueries,
  db,
} from './db.js';
import { generateReply } from './ai.js';
import { normalizeBusiness } from './business.js';
import { signedQuery } from './urlsign.js';
import { getTenantUsage, canTranscribeAudio } from './usage.js';
import { audioTranscriptionQueries } from './db.js';
import { getPlanLimits } from './plans.js';
import { deductStockForSale, restoreStockForSale } from './stock.js';
import {
  classifyIncomingMessage,
  isAiDodgingWithoutHandoff,
  handleOffTopicMessage,
  checkContactAiLimits,
} from './conversation-guard.js';
import { sendText, sendImage, sendDocument, sendContact, markAsRead, downloadMedia } from './whatsapp.js';
import { transcribeAudio } from './transcribe.js';
import { createPaymentLink, areItemsEqual } from './mercadopago.js';
import { pushOrderToBling } from './bling.js';
import { dispatchWebhookEvent } from './webhook-dispatch.js';
import { aiQueue } from './queue.js';
import { debounce, cancelDebounce } from './debounce.js';
import { applyStageTag, applyBuyIntentTag, applyHandoffReasonTag } from './auto-tags.js';
import { recordKnowledgeUsage } from './knowledge/search.js';
import { recordInbound, recordProcessed } from './meta-health.js';
import { sendPushEvent } from './push.js';
import { isWithinBusinessHours } from './business-hours.js';
import {
  emitDomainEvent,
  handleInboundMessageForAutomations,
  cancelPendingJobsForSale,
} from './domain-events.js';

export const webhookRouter = Router();

// Números que já receberam o aviso de "use o link" — evita spam por sessão de servidor.
const fallbackRepliedTo = new Set();

// Tenants já avisados sobre o limite diário de IA — chave inclui a data (YYYY-MM-DD)
// para rotacionar naturalmente a cada dia sem precisar limpar o Set.
const tenantDailyLimitNotified = {
  _set: new Set(),
  _key(tenantId) { return `${tenantId}:${new Date().toISOString().slice(0, 10)}`; },
  has(tenantId) { return this._set.has(this._key(tenantId)); },
  add(tenantId) { this._set.add(this._key(tenantId)); },
};

// Tenants já avisados sobre o limite MENSAL — chave inclui o início do ciclo
// de cobrança (não a data do dia), para avisar só 1x por ciclo. Reusar o
// tracker diário aqui faria o lojista receber o aviso todo dia pelo resto do mês.
const tenantMonthlyLimitNotified = {
  _set: new Set(),
  _key(tenantId, cycleStart) { return `${tenantId}:${cycleStart}`; },
  has(tenantId, cycleStart) { return this._set.has(this._key(tenantId, cycleStart)); },
  add(tenantId, cycleStart) { this._set.add(this._key(tenantId, cycleStart)); },
};

/**
 * Verifica a assinatura HMAC-SHA256 do Meta para o webhook POST.
 */
function verifyMetaSignature(req) {
  const secret = config.meta.appSecret;
  if (!secret) return true; // skip in dev if not configured

  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;

  const body = req.rawBody || (req.body ? JSON.stringify(req.body) : '');
  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  try {
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}


// Verificacao do webhook (handshake da Meta) — token global da plataforma.
webhookRouter.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('Webhook verificado com sucesso.');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// isWithinBusinessHours foi extraído para src/business-hours.js (compartilhado
// com as condições within/outside_business_hours das automações).

const DIA_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function buildDefaultMsgFora(businessName, horario) {
  const nome = businessName || 'nossa loja';
  if (!horario?.ativo || !horario?.inicio || !horario?.fim) {
    return `Olá! 😊 Recebemos sua mensagem. No momento não temos atendimento automático disponível. Em breve entraremos em contato!`;
  }
  const dias = Array.isArray(horario.dias)
    ? horario.dias.map(Number)
    : String(horario.dias || '1,2,3,4,5').split(',').map(Number).filter(Number.isFinite);
  const diasNomes = dias.map(d => DIA_NOME[d]).filter(Boolean);
  const diasStr = diasNomes.length > 1
    ? diasNomes.slice(0, -1).join(', ') + ' e ' + diasNomes.at(-1)
    : diasNomes[0] || '';
  return `Olá! 😊 Obrigado por entrar em contato com *${nome}*!\n\nNo momento estamos fora do horário de atendimento. Funcionamos:\n📅 ${diasStr}\n🕐 Das ${horario.inicio} às ${horario.fim}\n\nAssim que abrirmos, nossa equipe vai te atender. Fique à vontade para deixar sua mensagem! 📩`;
}

const MEDIA_TYPE_LABEL = { image: 'imagem', document: 'documento', video: 'vídeo', audio: 'áudio' };
const IMAGE_REFERENCE_CACHE_TTL_MS = 1000 * 60 * 60;
const IMAGE_REFERENCE_CACHE_MAX_ENTRIES = 50;
const imageReferenceCache = new Map();

/**
 * Monta a saudação inicial determinística enviada quando o cliente abre o link
 * de atendimento (nova rota). Não chama a IA — garante que nunca envie catálogo
 * espontaneamente e economiza crédito. A IA assume a partir da próxima mensagem.
 */
function buildGreeting(tenant) {
  // Brasil (UTC-3, sem horário de verão desde 2019) — evita saudação errada no servidor UTC.
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const h = now.getUTCHours();
  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const empresa = tenant.business_name || 'nossa loja';
  const atendente = (tenant.atendente_name || '').trim();
  const quem = atendente ? `Sou ${atendente}, da ${empresa}` : `Aqui é da ${empresa}`;
  // Aviso de transparência (LGPD, Art. 9º) — só aparece uma vez, na primeira
  // mensagem de cada contato novo, avisando que o atendimento é feito por IA
  // e onde consultar a política de privacidade.
  const avisoIa = `_Este atendimento é feito por uma inteligência artificial 🤖 — saiba como cuidamos dos seus dados: ${config.appUrl}/privacy-policy/_`;
  return `${saudacao}! 👋 ${quem}. Em que posso te ajudar hoje? 😊\n\n${avisoIa}`;
}

/** Baixa e persiste em message_media um arquivo recebido (imagem/documento/vídeo). Retorna o id gerado. */
function persistIncomingMedia(tenant, mime, filename, buffer) {
  const mediaId = randomBytes(16).toString('hex');
  mediaQueries.insert.run(mediaId, tenant.id, mime, filename || null, buffer);
  return mediaId;
}

function parseTenantBusiness(tenant) {
  try { return JSON.parse(tenant.business_json || '{}'); } catch { return {}; }
}

function productVisualCandidates(tenant, limit = 4) {
  const biz = parseTenantBusiness(tenant);
  const produtos = Array.isArray(biz.produtos) ? biz.produtos : [];
  const candidates = [];
  for (const produto of produtos) {
    if (produto?.imagem_url) candidates.push({ nome: produto.nome || 'Produto sem nome', imageUrl: produto.imagem_url });
    const variacoes = Array.isArray(produto?.variacoes_estr) ? produto.variacoes_estr : [];
    for (const variacao of variacoes) {
      if (variacao?.imagem_url) {
        candidates.push({
          nome: `${produto.nome || 'Produto'} — ${variacao.nome || 'variação'}`,
          imageUrl: variacao.imagem_url,
        });
      }
    }
  }
  return candidates.slice(0, limit);
}

function isSafeCatalogImageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) return false;
    return true;
  } catch {
    return false;
  }
}

function setImageReferenceCache(imageUrl, source) {
  if (imageReferenceCache.size >= IMAGE_REFERENCE_CACHE_MAX_ENTRIES) {
    const oldestKey = imageReferenceCache.keys().next().value;
    if (oldestKey) imageReferenceCache.delete(oldestKey);
  }
  imageReferenceCache.set(imageUrl, { source, savedAt: Date.now() });
}

async function getCachedImageReference(imageUrl) {
  if (!isSafeCatalogImageUrl(imageUrl)) return null;
  const cached = imageReferenceCache.get(imageUrl);
  if (cached && Date.now() - cached.savedAt < IMAGE_REFERENCE_CACHE_TTL_MS) return cached.source;

  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(contentType)) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length || buffer.length > 4 * 1024 * 1024) return null;

  const source = { type: 'base64', media_type: contentType, data: buffer.toString('base64') };
  setImageReferenceCache(imageUrl, source);
  return source;
}

async function buildCatalogImageReferenceBlocks(tenant) {
  const blocks = [];
  for (const item of productVisualCandidates(tenant)) {
    try {
      const source = await getCachedImageReference(item.imageUrl);
      if (!source) continue;
      blocks.push({ type: 'text', text: `Imagem de referência do catálogo: ${item.nome}` });
      blocks.push({ type: 'image', source });
    } catch (err) {
      console.warn('[catalog image reference] ignored:', err.message);
    }
  }
  return blocks;
}

/**
 * Constroi o conteudo de uma mensagem de MIDIA (imagem/audio/documento/video) para a IA.
 * Retorna { contentForAI, textForDB, mediaId } ou null se ja respondemos (audio sem
 * transcricao / tipo nao suportado pela IA).
 */
async function buildMedia(tenant, contact, message) {
  if (message.type === 'image') {
    const caption = message.image.caption || '';
    const { buffer, mime } = await downloadMedia(tenant, message.image.id);
    const mediaId = persistIncomingMedia(tenant, mime, null, buffer);
    const referenceBlocks = await buildCatalogImageReferenceBlocks(tenant);
    const content = [
      {
        type: 'text',
        text:
          'O cliente enviou a imagem abaixo. Analise visualmente e responda em português. ' +
          'Se parecer um produto, compare com os produtos cadastrados e com as imagens de referência do catálogo anexadas nesta mensagem. ' +
          'Se encontrar algo parecido, indique a opção mais provável, preço/variações conhecidas e faça uma pergunta curta para confirmar. ' +
          'Se não houver semelhança suficiente, seja honesto e peça mais detalhes. ' +
          (caption ? `Legenda do cliente: ${caption}` : 'O cliente não enviou legenda.'),
      },
      ...referenceBlocks,
      { type: 'text', text: 'Imagem enviada pelo cliente:' },
      { type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } },
    ];
    return { contentForAI: content, textForDB: `[imagem]${caption ? ' ' + caption : ''}`, mediaId };
  }

  if (message.type === 'audio') {
    const { buffer, mime } = await downloadMedia(tenant, message.audio.id);
    const mediaId = persistIncomingMedia(tenant, mime, 'audio', buffer);
    if (audioTranscriptionEnabled && canTranscribeAudio(tenant)) {
      const result = await transcribeAudio(buffer, mime);
      if (result?.text) {
        audioTranscriptionQueries.insert.run(tenant.id, contact.id, result.seconds);
        return { contentForAI: `[Transcrição do áudio do cliente]: ${result.text}`, textForDB: `[áudio] ${result.text}`, mediaId };
      }
    }
    messageQueries.insertWithMedia.run(contact.id, 'user', '[áudio recebido — transcrição indisponível]', mediaId);
    contactQueries.touch.run(contact.id);
    await sendText(
      tenant,
      message.from,
      'Recebi seu áudio! 🙏 A transcrição automática não está disponível agora. Pode me contar por texto?'
    );
    return null;
  }

  if (message.type === 'document' || message.type === 'video') {
    const field = message[message.type];
    try {
      const { buffer, mime } = await downloadMedia(tenant, field.id);
      const mediaId = persistIncomingMedia(tenant, field.mime_type || mime, field.filename, buffer);
      const label = MEDIA_TYPE_LABEL[message.type];
      const caption = field.caption || '';
      messageQueries.insertWithMedia.run(contact.id, 'user', `[${label}]${caption ? ' ' + caption : ''}`, mediaId);
    } catch (err) {
      console.error('[media download]', err);
    }
    await sendText(
      tenant,
      message.from,
      'Recebi seu arquivo! 🙏 Por aqui consigo te ajudar melhor por mensagem escrita. Pode me contar por texto?'
    );
    return null;
  }

  await sendText(
    tenant,
    message.from,
    'Recebi sua mensagem! Pode me escrever em texto que eu te ajudo? 🙂'
  );
  return null;
}


function orderTotalCents(pedido) {
  return (pedido?.itens || []).reduce((sum, item) => {
    const qty = Math.max(1, Math.round(Number(item.quantidade) || 1));
    const unit = Math.max(0, Number(item.valor_unitario) || 0);
    return sum + Math.round(unit * 100) * qty;
  }, 0);
}

function recordSaleFromAi({ tenant, contact, pedido, checkoutUrl, provider }) {
  if (!pedido?.itens?.length) return [];

  const totalCents = orderTotalCents(pedido);
  const amount = totalCents / 100;
  const itemsJson = JSON.stringify(pedido.itens);

  // Deduplicação: verificar venda aberta recente
  const existing = saleQueries.latestOpenByContact.get(contact.id);
  if (existing) {
    let existingItems = [];
    try {
      existingItems = JSON.parse(existing.items_json || existing.items || '[]');
    } catch {}

    if (areItemsEqual(existingItems, pedido.itens)) {
      // Reutiliza a venda existente. Se ela era rascunho e agora temos link, atualiza
      if (existing.status === 'rascunho' && checkoutUrl) {
        try {
          saleQueries.updateCheckoutDetails.run({
            id: existing.id,
            tenant_id: tenant.id,
            status: 'checkout_enviado',
            checkout_url: checkoutUrl,
            payment_provider: provider || '',
            mp_preference_id: '',
            total_cents: totalCents,
            amount: amount,
          });
          emitDomainEvent({
            tenantId: tenant.id,
            type: 'checkout_sent',
            entityType: 'sale',
            entityId: existing.id,
            payload: { amount },
          });
        } catch (err) {
          console.error('Erro ao atualizar checkout em venda existente no recordSaleFromAi:', err.message);
        }
      }
      // Garante que o estoque já foi descontado pra esta venda (idempotente —
      // deductStockForSale não faz nada se stock_adjusted já estiver marcado).
      return deductStockForSale(tenant.id, existing);
    } else {
      // Itens mudaram: cancela a venda aberta anterior marcando como perdida
      // e devolve ao estoque o que havia sido reservado por ela.
      try {
        saleQueries.updateStatus.run({
          id: existing.id,
          tenant_id: tenant.id,
          status: 'perdido'
        });
        restoreStockForSale(tenant.id, existing);
      } catch (err) {
        console.error('Erro ao cancelar venda antiga no recordSaleFromAi:', err.message);
      }
    }
  }

  // Cria uma nova venda se não houver aberta ou se os itens mudaram
  const newSaleId = randomBytes(16).toString('hex');
  try {
    saleQueries.create.run({
      id: newSaleId,
      tenant_id: tenant.id,
      contact_id: contact.id,
      status: checkoutUrl ? 'checkout_enviado' : 'rascunho',
      items_json: itemsJson,
      total_cents: totalCents,
      checkout_url: checkoutUrl || '',
      payment_provider: provider || '',
      external_payment_id: '',
      notes: '',
      amount: amount,
      items: itemsJson,
      mp_preference_id: '',
    });

    if (checkoutUrl) {
      emitDomainEvent({
        tenantId: tenant.id,
        type: 'checkout_sent',
        entityType: 'sale',
        entityId: newSaleId,
        payload: { amount },
      });
    }

    // Persist food service fields if present (delivery/mesa orders from restaurants).
    if (pedido.tipo || pedido.endereco || pedido.mesa || pedido.taxa_entrega != null) {
      const deliveryFeeCents = pedido.taxa_entrega != null ? Math.round(pedido.taxa_entrega * 100) : null;
      saleQueries.setFoodServiceFields.run({
        id: newSaleId,
        order_type: pedido.tipo || null,
        delivery_address: pedido.endereco ? JSON.stringify(pedido.endereco) : null,
        table_number: pedido.mesa || null,
        estimated_minutes: null,
        delivery_fee: deliveryFeeCents,
      });
    }

    return deductStockForSale(tenant.id, saleQueries.byId.get(newSaleId));
  } catch (err) {
    console.error('Erro ao salvar nova venda no recordSaleFromAi:', err.message);
  }
  return [];
}

/**
 * Distribui automaticamente a conversa para um atendente disponível (Round-Robin).
 */
export function distributeContact(tenantId, contactId) {
  const contact = contactQueries.byId.get(contactId);
  if (!contact) return null;

  // Se já possui atendente, não redistribui
  if (contact.assigned_user_id) {
    return contact.assigned_user_id;
  }

  let assignedUser = null;

  // 1. Tenta distribuir para a equipe atual
  if (contact.assigned_team_id) {
    assignedUser = userQueries.getAvailableRoundRobinForTeam.get(contact.assigned_team_id);
  }

  // 2. Se não conseguiu (ou não tinha equipe), tenta distribuir globalmente
  if (!assignedUser) {
    assignedUser = userQueries.getAvailableRoundRobin.get(tenantId);
  }

  if (assignedUser) {
    contactQueries.assign.run(assignedUser.id, contact.assigned_team_id || null, contact.id, tenantId);

    const sysMsg = `Conversa atribuída a ${assignedUser.name} via rodízio automático`;
    db.prepare(`
      INSERT INTO messages (contact_id, role, content, created_at)
      VALUES (?, 'system', ?, datetime('now'))
    `).run(contact.id, sysMsg);

    console.log(`[distributeContact] Contato ${contact.id} atribuído a ${assignedUser.name} (${assignedUser.role})`);
    return assignedUser.id;
  }

  return null;
}

/**
 * Encaminha a conversa para um atendente humano.
 * Idempotente — se já estiver waiting ou in_progress, só notifica uma vez.
 */
async function requestHumanHandoff({ tenant, contact, phone, reason, summary, customerMessage, isComplaint = false }) {
  // Idempotent: if already waiting or in_progress, skip notification
  const alreadyPending = contact.handoff_status === 'waiting' || contact.handoff_status === 'in_progress';

  // Update status
  contactQueries.setHandoffStatus.run('waiting', reason, contact.id);
  applyHandoffReasonTag(tenant.id, contact.id, reason);

  const confirmMsg = isComplaint
    ? 'Sinto muito pelo problema. Vou encaminhar sua conversa agora para uma pessoa da equipe analisar o caso.\n\nO atendimento automático ficará pausado enquanto você aguarda. 🙋'
    : 'Entendi. Vou encaminhar sua conversa agora para uma pessoa da equipe.\n\nSeu atendimento automático ficará pausado enquanto você aguarda. Assim que alguém estiver disponível, continuará por aqui. 🙋';

  if (!alreadyPending) {
    // Tenta distribuir a conversa
    distributeContact(tenant.id, contact.id);
    await sendText(tenant, phone, confirmMsg).catch(() => {});

    // Notifica o lojista (WhatsApp + Central de Avisos), uma única vez por handoff.
    if (!contact.handoff_notified) {
      const reasonLabel = {
        pediu_humano: 'Solicitou atendente',
        reclamacao: 'Reclamação',
        pos_venda: 'Problema com pedido',
        sem_informacao: 'IA não encontrou a informação',
        muito_irritado: 'Cliente muito irritado',
        risco_sensivel: 'Assunto sensível',
        limite_ia: 'Limite de atendimento automático',
        solicitacao_dados: 'Pedido de dados pessoais (LGPD)',
        outro: 'Outro motivo',
      }[reason] || reason;

      if (tenant.notify_phone) {
        const notifyMsg = `🚨 Atendimento humano solicitado\n\nCliente: ${contact.name || phone}\nWhatsApp: ${phone}\nMotivo: ${reasonLabel}\nResumo: ${summary || customerMessage?.slice(0, 100) || '—'}\n\nAcesse o painel para assumir a conversa.`;
        await sendText(tenant, tenant.notify_phone, notifyMsg).catch(() => {});
      }
      notificationQueries.create.run({
        tenant_id: tenant.id,
        type: 'aguardando_humano',
        title: 'Atendimento humano solicitado',
        message: `${contact.name || phone} — ${reasonLabel}${summary ? `: ${summary}` : ''}`,
        contact_id: contact.id,
      });
      dispatchWebhookEvent(tenant, 'handoff.requested', {
        contact_phone: phone,
        contact_name: contact.name,
        reason,
      }).catch(() => {});
      // Push no aparelho do lojista — texto genérico de propósito (aparece em
      // tela bloqueada): nunca telefone/nome/conteúdo da conversa.
      sendPushEvent({
        tenantId: tenant.id,
        event: 'handoff_requested',
        title: 'Cliente aguardando atendimento',
        body: 'Uma conversa precisa da sua equipe.',
        url: '/dashboard.html?focus=handoff',
        dedupeKey: `handoff:${contact.id}`,
        cooldownMinutes: 30,
      }).catch(() => {});
      emitDomainEvent({
        tenantId: tenant.id,
        type: 'handoff_requested',
        entityType: 'contact',
        entityId: contact.id,
        payload: { reason },
      });
      contactQueries.setHandoffNotified.run(contact.id);
    }
  }

  return { handedOff: true };
}

/**
 * Processa um turno de conversa: chama a IA com o historico, envia a resposta
 * e atualiza a etapa do funil. Roda dentro da fila de concorrencia.
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {number} opts.contactId
 * @param {Array|string} [opts.mediaContent] conteudo de imagem/audio para anexar
 * @param {string} [opts.mediaPlaceholder] texto a registrar no historico p/ a midia
 * @param {string} [opts.mediaId] id do arquivo em message_media associado ao mediaPlaceholder
 * @param {string} [opts.profileName]
 * @param {boolean} [opts.isFirstContact] true when this is the very first message
 */
// Wrapper: garante que pending_ai_at seja SEMPRE limpo ao final (sucesso, saída
// antecipada ou erro). Assim a varredura de recuperação só re-enfileira turnos
// que realmente não rodaram (restart/crash antes de concluir), sem risco de
// responder mensagens intencionalmente não respondidas (off-topic, fora de horário).
async function processTurn(opts) {
  try {
    return await processTurnInner(opts);
  } finally {
    try { contactQueries.clearPendingAi.run(opts.contactId); } catch { /* noop */ }
    // Telemetria: último turno processado deste tenant (Central de Saúde).
    try { recordProcessed(opts.tenantId); } catch { /* noop */ }
  }
}

async function processTurnInner({ tenantId, contactId, mediaContent, mediaPlaceholder, mediaId, profileName, isFirstContact = false }) {
  const tenant = decryptTenant(tenantQueries.byId.get(tenantId));
  const contact = contactQueries.byId.get(contactId);
  if (!tenant || !tenant.active || !contact) {
    console.warn(`[processTurn] tenant/contact inválido — tenantId:${tenantId} contactId:${contactId}`);
    return;
  }
  console.log(`[processTurn] [${tenant.business_name}] ${contact.wa_phone} — iniciando`);

  // Estado pode ter mudado durante o debounce/fila: revalida.
  const subState = subscriptionState(tenant);
  if (!subState.canUseBot) {
    console.warn(`[processTurn] [${tenant.business_name}] canUseBot=false após debounce — status:${subState.status} plano:${tenant.plan}`);
    return;
  }
  if (contact.handoff_status === 'in_progress') {
    console.warn(`[processTurn] [${tenant.business_name}] ${contact.wa_phone} — handoff in_progress, pulando IA`);
    return;
  }
  // Also skip if needs_human is set (backwards compat) and no handoff_status set
  if (contact.needs_human && contact.handoff_status === 'none') {
    console.warn(`[processTurn] [${tenant.business_name}] ${contact.wa_phone} — needs_human=true, pulando IA`);
    return;
  }

  // Limites de IA do PLANO — protegem o custo de Anthropic. O app não vende IA
  // ilimitada: ao atingir 100% do mês, bloqueia até o próximo ciclo ou upgrade
  // (nunca cobrança automática de excedente). O diário é uma proteção extra
  // contra picos dentro do mês (evita estourar o mês inteiro num único dia).
  const usage = getTenantUsage(tenant);
  if (usage.ai.status === 'blocked') {
    console.warn(`[${tenant.business_name}] Limite MENSAL de IA do plano ${usage.plan} atingido (${usage.ai.used}/${usage.ai.limit}) — pausando IA até o próximo ciclo`);
    if (!tenantMonthlyLimitNotified.has(tenant.id, usage.cycleStart)) {
      tenantMonthlyLimitNotified.add(tenant.id, usage.cycleStart);
      const limitMsg = `⚠️ Seu plano ${usage.limits.label} atingiu o limite de ${usage.limits.aiCallsMonth} respostas de IA deste mês. ` +
        'As conversas continuam registradas no painel — assuma manualmente ou faça upgrade para retomar o atendimento automático.';
      if (tenant.notify_phone) await sendText(tenant, tenant.notify_phone, limitMsg).catch(() => {});
      notificationQueries.create.run({
        tenant_id: tenant.id, type: 'limite_ia', title: 'Limite mensal de IA atingido',
        message: limitMsg, contact_id: null,
      });
    }
    return;
  }
  if (usage.limits.aiCallsDay && (aiUsageQueries.countByTenantDay.get(tenant.id)?.calls || 0) >= usage.limits.aiCallsDay) {
    console.warn(`[${tenant.business_name}] Limite DIÁRIO de IA do plano ${usage.plan} atingido (${usage.limits.aiCallsDay}/dia) — pausando IA hoje`);
    if (!tenantDailyLimitNotified.has(tenant.id)) {
      tenantDailyLimitNotified.add(tenant.id);
      const limitMsg = '⚠️ Seu atendimento automático atingiu o limite diário de mensagens da IA. As conversas continuam registradas no painel — assuma manualmente ou aguarde a renovação amanhã.';
      if (tenant.notify_phone) await sendText(tenant, tenant.notify_phone, limitMsg).catch(() => {});
      notificationQueries.create.run({
        tenant_id: tenant.id, type: 'limite_ia', title: 'Limite diário de IA atingido',
        message: limitMsg, contact_id: null,
      });
    }
    return;
  }

  const prior = getConversation(contact.id);
  // Novo contato sem histórico: injeta um 'Olá' sintético para que a IA envie a saudação
  // inicial. O prior vazio faz generateReply retornar null — isso corrige o silêncio.
  const messages = mediaContent
    ? [...prior, { role: 'user', content: mediaContent }]
    : prior.length > 0 ? prior : [{ role: 'user', content: 'Olá' }];

  const biz = normalizeBusiness(tenant.business_json);
  const hasCatalog = Boolean(
    catalogFileQueries.exists.get(tenant.id) ||
    biz.catalog_pdf_url ||
    (Array.isArray(biz.produtos) && biz.produtos.length > 0)
  );

  console.log(`[processTurn] [${tenant.business_name}] ${contact.wa_phone} — chamando IA (${messages.length} msgs no histórico)`);
  const result = await generateReply(tenant, messages, hasCatalog, contactId);
  if (!result) {
    console.warn(`[processTurn] [${tenant.business_name}] ${contact.wa_phone} — generateReply retornou null/undefined`);
    return;
  }

  // Fix: if first contact, never send catalog unsolicited
  if (isFirstContact && result.enviar_catalogo) {
    result.enviar_catalogo = false;
    result.imagem_url = null;
  }

  // Pedido confirmado: registra a oportunidade e gera o link de pagamento real (Mercado Pago) quando disponível.
  let mensagem = result.mensagem;
  let checkoutUrl = '';
  let checkoutProvider = '';
  let stockZeroedOut = [];
  if (result.pedido && tenant.mp_access_token) {
    try {
      const { link, zeroedOut } = await createPaymentLink(tenant, contact, result.pedido);
      stockZeroedOut = stockZeroedOut.concat(zeroedOut);
      if (link) {
        mensagem += `\n\n💳 Pague aqui (Pix, cartão ou boleto):\n${link}`;
        checkoutUrl = link;
        checkoutProvider = 'mercadopago';
      }
    } catch (e) {
      console.warn('Falha ao gerar link Mercado Pago:', e.message);
    }
  }
  if (result.pedido) {
    stockZeroedOut = stockZeroedOut.concat(
      recordSaleFromAi({ tenant, contact, pedido: result.pedido, checkoutUrl, provider: checkoutProvider })
    );
  } else if (result.etapa === 'fechado') {
    // Captura a venda aberta ANTES de marcar como paga, pra poder buscá-la de
    // volta (com status/paid_at atualizados) e disparar as integrações de
    // saída — mesmo ponto de gancho do webhook do Mercado Pago em api.js.
    const openSale = saleQueries.latestOpenByContact.get(contact.id);
    saleQueries.markLatestOpenPaid.run(contact.id);
    if (openSale) {
      const paidSale = saleQueries.byId.get(openSale.id);
      pushOrderToBling(tenant, paidSale).catch((e) => console.error('[Bling] push falhou:', e.message));
      dispatchWebhookEvent(tenant, 'sale.paid', {
        sale_id: paidSale.id,
        contact_phone: contact.wa_phone,
        contact_name: contact.name,
        amount: paidSale.total_cents ? paidSale.total_cents / 100 : (paidSale.amount || 0),
      }).catch(() => {});
      sendPushEvent({
        tenantId: tenant.id,
        event: 'sale_paid',
        title: 'Venda confirmada',
        body: 'Um novo pagamento foi aprovado.',
        url: '/vendas.html?filter=pago',
        dedupeKey: `sale_paid:${paidSale.id}`,
        cooldownMinutes: 60 * 24,
      }).catch(() => {});
      cancelPendingJobsForSale(tenant.id, paidSale.id, contact.id);
      emitDomainEvent({
        tenantId: tenant.id,
        type: 'sale_paid',
        entityType: 'sale',
        entityId: paidSale.id,
        payload: { amount: paidSale.total_cents ? paidSale.total_cents / 100 : (paidSale.amount || 0) },
      });
    }
  }

  if (mediaPlaceholder) {
    if (mediaId) messageQueries.insertWithMedia.run(contact.id, 'user', mediaPlaceholder, mediaId);
    else messageQueries.insert.run(contact.id, 'user', mediaPlaceholder);
  }
  const assistantMessage = messageQueries.insert.run(contact.id, 'assistant', mensagem);
  if (result.knowledge_chunks?.length) {
    recordKnowledgeUsage({
      tenantId: tenant.id,
      contactId: contact.id,
      messageId: assistantMessage.lastInsertRowid,
      chunks: result.knowledge_chunks,
    });
  }
  contactQueries.updateAfterTurn.run({
    id: contact.id,
    stage: result.etapa,
    buy_intent: result.intencao_compra,
    summary: result.resumo,
    name: profileName || null,
    last_produto_mencionado: result.produto_mencionado || null,
  });
  applyStageTag(tenant.id, contact.id, result.etapa);
  applyBuyIntentTag(tenant.id, contact.id, result.intencao_compra);
  // Automações: eventos de mudança de etapa/intenção (a IA moveu o funil).
  if (result.etapa && result.etapa !== contact.stage) {
    emitDomainEvent({
      tenantId: tenant.id,
      type: 'stage_changed',
      entityType: 'contact',
      entityId: contact.id,
      payload: { from: contact.stage, to: result.etapa, produto: result.produto_mencionado || null },
    });
  }
  if (result.intencao_compra && result.intencao_compra !== contact.buy_intent) {
    emitDomainEvent({
      tenantId: tenant.id,
      type: 'buy_intent_changed',
      entityType: 'contact',
      entityId: contact.id,
      payload: { from: contact.buy_intent, to: result.intencao_compra, produto: result.produto_mencionado || null },
    });
  }

  // Lista de espera de reposição: só aceita produto que realmente existe e
  // está marcado esgotado no catálogo — evita que a IA "invente" um nome e
  // suje a lista de espera com entradas que nunca vão ser notificadas.
  if (result.entrar_lista_espera) {
    const produtoEsgotado = (biz.produtos || []).find(
      (p) => p.esgotado && p.nome === result.entrar_lista_espera
    );
    if (produtoEsgotado && !productWaitlistQueries.existsActive.get(tenant.id, contact.id, produtoEsgotado.nome)) {
      productWaitlistQueries.add.run(tenant.id, contact.id, produtoEsgotado.nome);
    }
  }

  await sendText(tenant, contact.wa_phone, mensagem);

  // Controle de estoque: avisa o lojista (WhatsApp + Central de Avisos) quando
  // uma venda acabou de zerar o estoque de um produto.
  for (const produtoNome of new Set(stockZeroedOut)) {
    const notifyMsg = `📦 Estoque esgotado\n\n"${produtoNome}" acabou de chegar a 0 unidades após uma venda.\n\nAtualize o estoque em Configurações assim que repuser.`;
    if (tenant.notify_phone) {
      await sendText(tenant, tenant.notify_phone, notifyMsg).catch(() => {});
    }
    notificationQueries.create.run({
      tenant_id: tenant.id,
      type: 'estoque_esgotado',
      title: 'Produto esgotado',
      message: `"${produtoNome}" chegou a 0 unidades em estoque.`,
      contact_id: null,
    });
  }

  if (result.imagem_url) {
    await sendImage(tenant, contact.wa_phone, result.imagem_url).catch((e) =>
      console.warn('Falha ao enviar imagem do produto:', e.message)
    );
  }

  if (result.enviar_catalogo && hasCatalog) {
    // Descobre se há PDF disponível.
    // Em ambos os casos usamos uma URL nossa (que serve application/pdf correto):
    //   - arquivo armazenado → /api/catalog/download/:id
    //   - URL externa (Drive) → /api/catalog/proxy/:id  (nós buscamos e re-servimos)
    const storedFile = catalogFileQueries.exists.get(tenant.id);
    const hasExternalUrl = Boolean(biz.catalog_pdf_url);
    const hasPdf = Boolean(storedFile || hasExternalUrl);
    const pdfFilename = `catalogo_${(tenant.business_name || 'catalogo').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

    if (hasPdf) {
      // Tem PDF: envia só o arquivo — sem texto e sem imagens individuais
      const pdfUrl = storedFile
        ? `${config.appUrl}/api/catalog/download/${tenant.id}${signedQuery(tenant.id)}`
        : `${config.appUrl}/api/catalog/proxy/${tenant.id}${signedQuery(tenant.id)}`;
      await sendDocument(tenant, contact.wa_phone, pdfUrl, pdfFilename).catch((e) =>
        console.warn('Catálogo: falha ao enviar PDF:', e.message)
      );
    } else {
      // Sem PDF: envia imagens individuais; se a imagem falhar, cai para lista de texto.
      const produtos = biz.produtos || [];
      const semImagem = [];
      for (const p of produtos) {
        if (p.imagem_url) {
          const linhas = [p.nome, p.preco].filter(Boolean);
          if (p.descricao) linhas.push(p.descricao);
          const vars = (p.variacoes || []).join(', ');
          if (vars) linhas.push(`Variações: ${vars}`);
          const enviou = await sendImage(tenant, contact.wa_phone, p.imagem_url, linhas.join('\n'))
            .then(() => true)
            .catch((e) => { console.warn(`Catálogo: falha ao enviar imagem de "${p.nome}":`, e.message); return false; });
          if (!enviou) semImagem.push(p);
        } else {
          semImagem.push(p);
        }
      }
      if (semImagem.length) {
        const bloco = semImagem.map((p) => {
          const vars = (p.variacoes || []).join(', ');
          return [
            `*${p.nome}*${p.preco ? ' — ' + p.preco : ''}`,
            p.descricao || '',
            vars ? `Variações: ${vars}` : '',
          ].filter(Boolean).join('\n');
        }).join('\n\n');
        await sendText(tenant, contact.wa_phone, bloco).catch((e) =>
          console.warn('Catálogo: falha ao enviar lista de produtos:', e.message)
        );
      } else if (produtos.length === 0) {
        // hasCatalog era true mas não há produtos — não deixar o bot em silêncio.
        await sendText(tenant, contact.wa_phone,
          'Nosso catálogo está sendo atualizado. Em breve você receberá todas as informações! 😊'
        ).catch(() => {});
      }
    }
  }

  if (result.precisa_humano) {
    await requestHumanHandoff({
      tenant,
      contact,
      phone: contact.wa_phone,
      reason: result.motivo || 'pediu_humano',
      summary: result.resumo,
      isComplaint: result.motivo === 'reclamacao',
    }).catch((e) => console.warn('Falha ao fazer handoff:', e.message));
  } else if (isAiDodgingWithoutHandoff(result.mensagem)) {
    // AI responded with "consult our team" without triggering handoff
    console.warn(`[${tenant.business_name}] AI dodge detected — triggering handoff automatically`);
    await requestHumanHandoff({
      tenant,
      contact,
      phone: contact.wa_phone,
      reason: 'sem_informacao',
      summary: result.resumo,
    }).catch((e) => console.warn('Falha ao fazer handoff (dodge):', e.message));
  }

  console.log(`[${tenant.business_name}] ${contact.wa_phone} → etapa: ${result.etapa}${result.precisa_humano ? ' (handoff)' : ''}`);
}

// Recebimento de mensagens — número servidor compartilhado, roteado por slug.
webhookRouter.post('/webhook', async (req, res) => {
  console.log('[Webhook] POST recebido — ip:', req.ip,
    '| content-type:', req.headers['content-type'],
    '| assinatura:', req.headers['x-hub-signature-256'] ? 'presente' : 'ausente');

  if (!verifyMetaSignature(req)) {
    console.warn('[Webhook] Assinatura Meta inválida ou ausente — respondendo 401');
    return res.sendStatus(401);
  }
  res.sendStatus(200);

  try {
    let parsed = {};
    try {
      const raw = req.rawBody ?? req.body;
      parsed = raw ? JSON.parse(Buffer.isBuffer(raw) ? raw.toString() : raw) : {};
    } catch { /* não era JSON válido */ }

    const value = parsed?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return;

    if (isDuplicateInboundMessage(message.id)) {
      console.log(`[Webhook] message.id duplicado (${message.id}) — ignorado`);
      return;
    }

    const from = message.from;
    const profileName = value?.contacts?.[0]?.profile?.name;

    await markAsRead(null, message.id);

    let isNewRoute = false;
    let tenantId = null;
    let matchedClick = null;

    if (message.type === 'text') {
      const text = (message.text?.body || '').trim().normalize('NFC')
        .replace(/[\uFE00-\uFE0F\u200B-\u200D\uFEFF]/g, '');

      let cleanText = text;

      const mktTokenMatch = text.match(/\(([A-Z0-9]{6})\)/i);
      if (mktTokenMatch) {
        const rawToken = mktTokenMatch[1].toUpperCase();
        const tokenHash = createHash('sha256').update(rawToken).digest('hex');
        const click = attributionClickQueries.byTokenHash.get(tokenHash);
        if (click) {
          matchedClick = click;
          tenantId = click.tenant_id;
          isNewRoute = true;
          console.log(`[Router] ${from} → resolved via marketing token "${rawToken}" for tenant "${tenantId}"`);
        }
        cleanText = text.replace(/\s*\([A-Z0-9]{6}\)/i, '');
      }

      const MAX_ROUTE_MSG_LEN = 200;

      const ATTENDANCE_ROUTE_RE = /\bAtendimento\s+([A-Z]{2}[0-9]{3})\b/i;
      const attendanceMatch = !tenantId && cleanText.length <= 400 ? cleanText.match(ATTENDANCE_ROUTE_RE) : null;

      if (!tenantId && attendanceMatch) {
        const code = attendanceMatch[1].toUpperCase();
        if (isValidAttendanceCode(code)) {
          const found = decryptTenant(tenantQueries.byAttendanceCode.get(code));
          if (found && found.active) {
            customerRouteQueries.upsert.run(from, found.id);
            tenantId = found.id;
            isNewRoute = true;
            console.log(`[Router] ${from} → "${found.business_name}" via attendance code "${code}"`);
          } else {
            console.warn(`[Router] attendance code "${code}" — não encontrado ou inativo`);
            await sendText(null, from, 'Olá! 👋 Não consegui identificar a loja deste link. Volte ao link que a loja compartilhou e toque em Enviar para começarmos. 😊').catch(() => {});
            return;
          }
        }
      }

      const ENTRY_ROUTE_REGEX =
        /^ol[aá]\s*([❕❗])\s+conheci a\s+@([a-z0-9-]{2,60})([·•◦○●◇◆□■△▲▽▼☆★✦])\s+e queria tirar uma d[uú]vida\s*([❔❓])\s*$/iu;

      const entryMatch = !tenantId && !attendanceMatch && cleanText.length <= MAX_ROUTE_MSG_LEN
        ? cleanText.match(ENTRY_ROUTE_REGEX)
        : null;

      if (!tenantId && entryMatch) {
        const openingSymbol  = entryMatch[1];
        const entryHandle    = entryMatch[2].toLowerCase();
        const middleSymbol   = entryMatch[3];
        const questionSymbol = entryMatch[4];
        const entryCode = openingSymbol + middleSymbol + questionSymbol;

        if (isValidEntryCode(entryCode)) {
          const found = decryptTenant(tenantQueries.byEntryRoute.get(entryHandle, entryCode));
          if (found && found.active) {
            customerRouteQueries.upsert.run(from, found.id);
            tenantId = found.id;
            isNewRoute = true;
            console.log(`[Router] ${from} → "${found.business_name}" via entry route "@${entryHandle}"`);
          } else {
            console.warn(`[Router] entry route "@${entryHandle}" + "${entryCode}" — não encontrado`);
          }
        }
      }

      if (!tenantId && !attendanceMatch && entryMatch) {
        await sendText(null, from, 'Olá! 👋 Não consegui identificar a loja deste link. Volte ao link que a loja compartilhou e toque em Enviar para começarmos. 😊').catch(() => {});
        return;
      }

      if (!tenantId && !attendanceMatch && !entryMatch && cleanText.length <= MAX_ROUTE_MSG_LEN) {
        const BROAD_ENTRY_RE = /ol[aá].*[❕❗].*@[a-z0-9-]{2,60}.*[❔❓]/iu;
        if (BROAD_ENTRY_RE.test(cleanText)) {
          console.warn(`[Router] ${from} — mensagem parece link de entrada mas não casou com nenhum tenant`);
          await sendText(null, from, 'Olá! 👋 Não consegui identificar a loja deste link. Volte ao link que a loja compartilhou e toque em Enviar para começarmos. 😊').catch(() => {});
          return;
        }
      }

      const brailleMatch = !tenantId && !attendanceMatch && !entryMatch && cleanText.match(
        /^ol[aá]!\s+vim conhecer\s+([⠁-⣿]{3})\s+@([a-z0-9-]{2,60})\s+e gostaria de ver os produtos\s*😊?\s*$/iu
      );

      if (!tenantId && brailleMatch) {
        const rawCode = brailleMatch[1];
        if (isValidRouteCode(rawCode)) {
          const found = decryptTenant(tenantQueries.byRouteCode.get(rawCode));
          if (found && found.active) {
            customerRouteQueries.upsert.run(from, found.id);
            tenantId = found.id;
            isNewRoute = true;
            console.log(`[Router] ${from} → "${found.business_name}" via braille legado "${rawCode}"`);
          } else {
            console.warn(`[Router] route_code braille "${rawCode}" — não encontrado ou inativo`);
            await sendText(null, from, 'Olá! 👋 Não consegui identificar a loja deste atendimento. Volte ao link que a loja compartilhou e toque em Enviar para começarmos. 😊').catch(() => {});
            return;
          }
        }
      }

      const legacySlugMatch = !tenantId && !attendanceMatch && !entryMatch && !brailleMatch && cleanText.match(
        /^ol[aá]!\s+vim conhecer a loja\s+@([a-z0-9-]{3,50})\s+e gostaria de ver os produtos\s*(?:😊)?\s*$/iu
      );

      if (!tenantId && legacySlugMatch) {
        const slug = legacySlugMatch[1].toLowerCase();
        const found = decryptTenant(tenantQueries.bySlug.get(slug));
        if (found && found.active) {
          customerRouteQueries.upsert.run(from, found.id);
          tenantId = found.id;
          isNewRoute = true;
          console.log(`[Router] ${from} → "${found.business_name}" via slug legado "${slug}"`);
        } else {
          console.warn(`[Router] slug legado "${slug}" — não encontrado ou inativo`);
          await sendText(null, from,
            'Olá! 👋 Não consegui identificar a loja deste atendimento. Volte ao link que a loja compartilhou e toque em Enviar para começarmos. 😊'
          ).catch(() => {});
          return;
        }
      }

      const startMatch = !tenantId && !attendanceMatch && !entryMatch && !brailleMatch && !legacySlugMatch && text.match(/^start\s+([a-z0-9-]+)/i);
      const tokenMatch = !tenantId && !attendanceMatch && !entryMatch && !brailleMatch && !legacySlugMatch && !startMatch && text.match(/\(([A-Z0-9]{6})\)/i);

      if (!tenantId && (startMatch || tokenMatch)) {
        let slug = null;
        let via = '';
        if (startMatch) {
          slug = startMatch[1].toLowerCase();
          via = 'START';
        } else if (tokenMatch) {
          const row = waTokenQueries.byToken.get(tokenMatch[1].toUpperCase(), Date.now());
          if (row) {
            slug = row.slug;
            waTokenQueries.delete.run(tokenMatch[1].toUpperCase());
            via = 'token legado';
          }
        }
        if (slug) {
          const found = decryptTenant(tenantQueries.bySlug.get(slug));
          if (found && found.active) {
            customerRouteQueries.upsert.run(from, found.id);
            tenantId = found.id;
            isNewRoute = true;
            console.log(`[Router] ${from} → "${found.business_name}" via ${via} "${slug}"`);
          } else if (startMatch) {
            console.warn(`[Router] slug "${slug}" via ${via} — não encontrado ou inativo`);
          }
        }
      }

      // Verificação ampla: previne fallback para rota salva quando a mensagem parece
      // um código de atendimento TX579 mas o regex estrito não casou (ex: código não existe no BD).
      if (!tenantId) {
        const BROAD_ATTENDANCE_RE = /\bAtendimento\s+[A-Z]{2}[0-9]{3}\b/i;
        if (BROAD_ATTENDANCE_RE.test(text)) {
          console.warn(`[Router] ${from} — mensagem parece código TX579 mas não casou com nenhum tenant`);
          await sendText(null, from,
            'Olá! 👋 Não consegui identificar a loja deste link. Volte ao link que a loja compartilhou e toque em Enviar para começarmos. 😊'
          ).catch(() => {});
          return;
        }
      }
    }

    // 4. Sem ativação: usa rota salva (conversa já iniciada anteriormente).
    if (!tenantId) {
      tenantId = customerRouteQueries.byPhone.get(from)?.tenant_id ?? null;
    }

    if (!tenantId) {
      // Sem rota conhecida: orienta o cliente a usar o link correto.
      if (message.type === 'text' && !fallbackRepliedTo.has(from)) {
        fallbackRepliedTo.add(from);
        await sendText(null, from,
          'Olá! 👋 Não consegui identificar a loja deste atendimento. Volte ao link que a loja compartilhou e toque em Enviar para começarmos. 😊'
        ).catch(() => {});
      }
      return;
    }

    const tenant = decryptTenant(tenantQueries.byId.get(tenantId));
    if (!tenant || !tenant.active) {
      console.warn(`[Webhook] ${from} — tenant ${tenantId} não encontrado ou inativo, ignorando mensagem`);
      return;
    }

    // Telemetria da Central de Saúde: último webhook válido recebido deste tenant.
    recordInbound(tenant.id);

    const contact = getOrCreateContact(tenant.id, from, profileName, message.referral);

    if (matchedClick) {
      try {
        db.transaction(() => {
          // 1. Vincula o clique ao contato
          attributionClickQueries.linkContact.run(contact.id, matchedClick.id);

          // 2. Cria ou atualiza as atribuições do contato
          const existingAttr = contactAttributionQueries.get.get(contact.id, tenant.id);
          if (!existingAttr) {
            const attrId = 'cat_' + randomUUID().replace(/-/g, '').slice(0, 24);
            contactAttributionQueries.insert.run({
              id: attrId,
              tenant_id: tenant.id,
              contact_id: contact.id,
              first_touch_click_id: matchedClick.id,
              last_touch_click_id: matchedClick.id,
              first_touch_at: new Date().toISOString(),
              last_touch_at: new Date().toISOString(),
            });
          } else {
            // Apenas atualiza a última atribuição (idempotente)
            if (existingAttr.last_touch_click_id !== matchedClick.id) {
              contactAttributionQueries.updateLastTouch.run(
                matchedClick.id,
                new Date().toISOString(),
                contact.id,
                tenant.id
              );
            }
          }

          // 3. Atualiza lead_source do contato se estiver como whatsapp_direto
          const linkRow = marketingLinkQueries.byId.get(matchedClick.marketing_link_id, tenant.id);
          if (linkRow) {
            contactQueries.setLeadSource.run(
              linkRow.source,
              linkRow.campaign || linkRow.medium || null,
              contact.id
            );
          }

          // 4. Emitir evento de domínio
          emitDomainEvent({
            tenantId: tenant.id,
            type: 'attribution_connected',
            entityType: 'contact',
            entityId: contact.id,
            payload: {
              click_id: matchedClick.id,
              marketing_link_id: matchedClick.marketing_link_id,
              source: linkRow?.source || 'direct',
              campaign: linkRow?.campaign || 'none',
            },
          });
        })();
      } catch (err) {
        console.error('[Attribution] Falha ao vincular clique:', err.message);
      }
    }

    if (contact._wasCreated) {
      dispatchWebhookEvent(tenant, 'contact.created', {
        contact_phone: contact.wa_phone,
        contact_name: contact.name,
      }).catch(() => {});
      emitDomainEvent({
        tenantId: tenant.id,
        type: 'contact_created',
        entityType: 'contact',
        entityId: contact.id,
        payload: { lead_source: contact.lead_source || null },
      });
    }
    // Automações: cancela lembretes de inatividade (o cliente respondeu) e
    // agenda os próximos — persistente, sobrevive a reinício.
    handleInboundMessageForAutomations(tenant, contact);
    const key = `c:${contact.id}`;
    const subState = subscriptionState(tenant);
    const canUse = subState.canUseBot;
    if (!canUse) {
      console.warn(`[Webhook] [${tenant.business_name}] canUseBot=false — status: ${subState.status}, plano: ${tenant.plan}`);
    }

    if (canUse && !contact.needs_human) {
      const biz = normalizeBusiness(tenant.business_json);
      if (!isWithinBusinessHours(biz)) {
        const msgFora = biz?.horario_atendimento?.msg_fora || biz?.horario_atendimento?.mensagem_fora;
        const msgParaEnviar = msgFora || buildDefaultMsgFora(tenant.business_name, biz?.horario_atendimento);
        console.warn(`[Webhook] [${tenant.business_name}] fora do horário de atendimento — usando: ${msgFora ? 'msg personalizada' : 'msg padrão automática'}`);
        if (message.type === 'text') {
          messageQueries.insert.run(contact.id, 'user', message.text.body);
          contactQueries.touch.run(contact.id);
          await sendText(tenant, from, msgParaEnviar).catch(() => {});
        }
        return;
      }
    }

    if (message.type === 'text') {
      // Mensagens de ativação (natural @slug / START / token) não entram no histórico —
      // o bot responde com saudação proativa como se fosse o primeiro contato.
      if (!isNewRoute) {
        // Guard checks — before calling AI (only for non-new-route messages)
        if (canUse) {
          const biz2 = normalizeBusiness(tenant.business_json);
          const productNames = (biz2.produtos || []).map(p => p.nome).filter(Boolean);
          const text2 = message.text.body;
          const guardResult = classifyIncomingMessage(text2, productNames);

          if (guardResult.category === 'human_request') {
            if (contact.handoff_status === 'none') {
              messageQueries.insertWithFlag.run(contact.id, 'user', text2, 1);
              contactQueries.touch.run(contact.id);
              await requestHumanHandoff({ tenant, contact, phone: from, reason: 'pediu_humano', summary: `Cliente solicitou: "${text2.slice(0, 100)}"` }).catch(() => {});
            } else {
              messageQueries.insertWithFlag.run(contact.id, 'user', text2, 1);
              contactQueries.touch.run(contact.id);
            }
            return;
          }

          if (guardResult.category === 'complaint') {
            if (contact.handoff_status === 'none') {
              messageQueries.insertWithFlag.run(contact.id, 'user', text2, 1);
              contactQueries.touch.run(contact.id);
              await requestHumanHandoff({ tenant, contact, phone: from, reason: 'reclamacao', summary: `Cliente relatou: "${text2.slice(0, 100)}"`, isComplaint: true }).catch(() => {});
            } else {
              messageQueries.insertWithFlag.run(contact.id, 'user', text2, 1);
              contactQueries.touch.run(contact.id);
            }
            return;
          }

          if (guardResult.category === 'prompt_injection') {
            messageQueries.insertWithFlag.run(contact.id, 'user', text2, 0); // exclude from AI
            contactQueries.touch.run(contact.id);
            await sendText(tenant, from, 'Posso ajudar somente com informações e atendimento relacionados a esta empresa. Como posso ajudar com sua compra?').catch(() => {});
            return;
          }

          if (guardResult.category === 'off_topic') {
            const offTopicResult = handleOffTopicMessage(contact, config.ai.offTopicMuteMinutes);
            contactQueries.updateOffTopic.run(offTopicResult.newCount, offTopicResult.newWindowStart, offTopicResult.newMutedUntil, contact.id);
            messageQueries.insertWithFlag.run(contact.id, 'user', text2, 0); // exclude from AI
            contactQueries.touch.run(contact.id);
            if (!offTopicResult.silent && offTopicResult.replyText) {
              await sendText(tenant, from, offTopicResult.replyText).catch(() => {});
            }
            return;
          }
        }

        // Skip AI if human is actively attending
        if (contact.handoff_status === 'in_progress') {
          messageQueries.insert.run(contact.id, 'user', message.text.body);
          contactQueries.touch.run(contact.id);
          return;
        }

        messageQueries.insert.run(contact.id, 'user', message.text.body);
        contactQueries.touch.run(contact.id);
        if (!canUse || contact.needs_human) return;

        // Check AI rate limits — números vêm do PLANO do tenant, não mais globais.
        const planLimits = getPlanLimits(tenant.plan, subscriptionState(tenant).status);
        const limitsCheck = checkContactAiLimits(contact, {
          maxCalls10Min: planLimits.aiCallsContact10Min,
          maxCallsDay: planLimits.aiCallsContactDay,
        });
        contactQueries.updateAiCalls.run(limitsCheck.newCalls10, limitsCheck.newWin10Start, limitsCheck.newCallsDay, limitsCheck.newWinDayStart, contact.id);
        if (!limitsCheck.allowed) {
          await requestHumanHandoff({ tenant, contact, phone: from, reason: 'limite_ia', summary: 'Limite de atendimento automático atingido' }).catch(() => {});
          return;
        }

        // Marca "devendo resposta" — se o servidor reiniciar antes do turno
        // concluir, a varredura de recuperação re-enfileira.
        contactQueries.setPendingAi.run(contact.id);
        console.log(`[Webhook] [${tenant.business_name}] ${from} — enfileirando IA (debounce ${config.debounceMs}ms)`);
        debounce(
          key,
          () => {
            // Mensagem nova de cliente = prioridade alta. Se a fila recusar
            // (limite global/por tenant), o turno NÃO se perde: pending_ai_at
            // já está marcado e a varredura de recuperação re-enfileira.
            const queued = aiQueue.add(
              () => processTurn({ tenantId: tenant.id, contactId: contact.id, profileName }),
              { tenantId: tenant.id, contactId: contact.id, type: 'mensagem', priority: 'high' },
            );
            if (!queued.ok) {
              console.warn(`[Webhook] fila de IA cheia (${queued.reason}) — turno do contato ${contact.id} ficará para a recuperação`);
            }
          },
          config.debounceMs,
        );
      } else {
        // New route (activation message) — saudação determinística, SEM IA.
        // Nunca envia catálogo espontaneamente e economiza crédito; a IA assume
        // a partir da próxima mensagem real do cliente.
        contactQueries.touch.run(contact.id);
        if (!canUse || contact.needs_human) return;
        const greeting = buildGreeting(tenant);
        messageQueries.insert.run(contact.id, 'assistant', greeting);
        await sendText(tenant, from, greeting).catch((e) =>
          console.warn('Falha ao enviar saudação inicial:', e.message)
        );

        // Cartão de contato da loja — o WhatsApp mostra um botão nativo
        // "Adicionar aos contatos" na conversa, sem a pessoa precisar digitar
        // nome/número manualmente. Só no contato de verdade novo (não em
        // reenvios do link/reativação de rota de quem já é contato).
        if (contact._wasCreated) {
          const serverPhoneRaw = process.env.WA_SERVER_PHONE || '';
          const serverPhone = serverPhoneRaw.replace(/\D/g, '');
          if (!serverPhone) {
            // Silêncio aqui era a causa reportada pelos lojistas ("cartão de
            // apresentação sumiu"): o env não estava setado e nada aparecia
            // nos logs. Agora avisa explicitamente.
            console.warn(
              `[vCard] WA_SERVER_PHONE não configurado — cartão "Adicionar aos contatos" não será enviado para ${from}. Defina a variável de ambiente no formato E.164 sem "+" (ex: 5511999998888).`,
            );
          } else {
            const cardName = tenant.business_name || 'Nossa loja';
            console.log(`[vCard] enviando cartão da loja "${cardName}" (${serverPhone}) para ${from}`);
            await sendContact(tenant, from, cardName, serverPhone).catch((e) =>
              console.error(`[vCard] Falha ao enviar cartão de contato para ${from}: ${e.message}`),
            );
          }
        }
      }
      return;
    }

    cancelDebounce(key);

    if (!canUse || contact.needs_human || contact.handoff_status === 'in_progress') {
      if (['image', 'document', 'video'].includes(message.type)) {
        try {
          const field = message[message.type];
          const { buffer, mime } = await downloadMedia(tenant, field.id);
          const mediaId = persistIncomingMedia(tenant, field.mime_type || mime, field.filename, buffer);
          const label = MEDIA_TYPE_LABEL[message.type];
          const caption = field.caption || '';
          messageQueries.insertWithMedia.run(contact.id, 'user', `[${label}]${caption ? ' ' + caption : ''}`, mediaId);
        } catch (err) {
          console.error('[media download]', err);
          messageQueries.insert.run(contact.id, 'user', `[${message.type}]`);
        }
      } else {
        messageQueries.insert.run(contact.id, 'user', `[${message.type}]`);
      }
      contactQueries.touch.run(contact.id);
      return;
    }

    const incoming = await buildMedia(tenant, contact, message);
    if (!incoming) return;

    contactQueries.setPendingAi.run(contact.id); // devendo resposta (recuperável em restart)
    const queued = aiQueue.add(
      () =>
        processTurn({
          tenantId: tenant.id,
          contactId: contact.id,
          mediaContent: incoming.contentForAI,
          mediaPlaceholder: incoming.textForDB,
          mediaId: incoming.mediaId,
          profileName,
        }),
      { tenantId: tenant.id, contactId: contact.id, type: 'mensagem', priority: 'high' },
    );
    if (!queued.ok) {
      // pending_ai_at ficou marcado — a varredura de recuperação re-enfileira.
      console.warn(`[Webhook] fila de IA cheia (${queued.reason}) — turno do contato ${contact.id} ficará para a recuperação`);
    }
  } catch (err) {
    console.error('Erro ao processar mensagem:', err);
  }
});

/**
 * Varredura de recuperação: re-enfileira turnos de IA que ficaram presos
 * (enfileirados mas não concluídos — tipicamente por restart/deploy do servidor
 * no meio do processamento). Idempotente e seguro: só pega contatos com
 * pending_ai_at antigo (> 90s), ativos, sem humano e sem handoff. processTurn
 * limpa o pending_ai_at ao concluir, então cada turno é recuperado uma vez.
 */
function recoverStuckTurns() {
  let stuck;
  try {
    stuck = contactQueries.pendingAiStuck.all();
  } catch (e) {
    console.error('[recovery] Falha ao buscar turnos presos:', e.message);
    return;
  }
  if (!stuck.length) return;
  console.log(`[recovery] Recuperando ${stuck.length} turno(s) de IA preso(s) (restart/crash)`);
  for (const row of stuck) {
    // Re-marca o timestamp para evitar re-seleção imediata caso demore na fila.
    contactQueries.setPendingAi.run(row.id);
    // Retomada de turno interrompido = prioridade alta. Se a fila recusar,
    // pending_ai_at segue marcado e a próxima varredura tenta de novo.
    aiQueue.add(() => processTurn({ tenantId: row.tenant_id, contactId: row.id }), {
      tenantId: row.tenant_id,
      contactId: row.id,
      type: 'recuperacao',
      priority: 'high',
    });
  }
}

export function startInboundRecovery() {
  // Primeira varredura 30s após o boot — recupera o que a reinicialização perdeu.
  setTimeout(() => {
    recoverStuckTurns();
    setInterval(recoverStuckTurns, 60 * 1000).unref();
  }, 30 * 1000).unref();
  console.log('Recuperação de turnos de IA iniciada (verifica a cada 60s).');
}

