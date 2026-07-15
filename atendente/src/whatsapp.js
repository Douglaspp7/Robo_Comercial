import { config } from './config.js';
import { fetchWithTimeout, fetchWithRetry } from './http.js';
import { checkMetaBillingError } from './alerts.js';
import { recordOutboundSuccess, recordOutboundError } from './meta-health.js';
import { sendViaWorker } from './gateway.js';

// Telemetria da Central de Saúde da Meta — melhor esforço, nunca afeta o envio.
// tenant é null em envios de plataforma (alertas operacionais) → não registra.
function trackSend(tenant, res, body) {
  if (!tenant?.id) return;
  if (res?.ok) recordOutboundSuccess(tenant.id);
  else recordOutboundError(tenant.id, res?.status, body);
}

const { apiVersion, phoneNumberId, token } = config.whatsapp;

// Timeouts: os envios usam o padrão de 15s do fetchWithTimeout (nunca penduram
// um slot da fila de IA). Download de mídia pode ser maior.
const MEDIA_TIMEOUT_MS = 30000;

function baseUrl() {
  return `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;
}

function authHeader() {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function sendText(tenant, to, text) {
  if (config.gateway.enabled) return sendViaWorker(tenant, to, text);
  const res = await fetchWithTimeout(`${baseUrl()}/messages`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  });
  if (!res.ok) {
    const body = await res.text();
    checkMetaBillingError(res.status, body); // alerta se for pagamento/limite
    trackSend(tenant, res, body);
    throw new Error(`Falha ao enviar ao WhatsApp (${res.status}): ${body}`);
  }
  trackSend(tenant, res);
  return res.json();
}

export async function sendImage(tenant, to, imageUrl, caption = '') {
  // Modo gateway: o /send do worker é texto. Envia a legenda (se houver) para
  // não perder a mensagem; imagem por Baileys fica para uma evolução do worker.
  if (config.gateway.enabled) return sendViaWorker(tenant, to, caption);
  const res = await fetchWithTimeout(`${baseUrl()}/messages`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: { link: imageUrl, caption },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    checkMetaBillingError(res.status, body); // alerta se for pagamento/limite
    trackSend(tenant, res, body);
    throw new Error(`Falha ao enviar imagem (${res.status}): ${body}`);
  }
  trackSend(tenant, res);
  return res.json();
}

export async function sendDocument(tenant, to, link, filename) {
  if (config.gateway.enabled) return sendViaWorker(tenant, to, `📎 ${filename || 'documento'}: ${link}`);
  const res = await fetchWithTimeout(`${baseUrl()}/messages`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: { link, filename },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    checkMetaBillingError(res.status, body); // alerta se for pagamento/limite
    trackSend(tenant, res, body);
    throw new Error(`Falha ao enviar documento (${res.status}): ${body}`);
  }
  trackSend(tenant, res);
  return res.json();
}

export async function sendVideo(tenant, to, videoUrl, caption = '') {
  if (config.gateway.enabled) return sendViaWorker(tenant, to, caption);
  const res = await fetchWithTimeout(`${baseUrl()}/messages`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'video',
      video: { link: videoUrl, caption },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    checkMetaBillingError(res.status, body); // alerta se for pagamento/limite
    trackSend(tenant, res, body);
    throw new Error(`Falha ao enviar vídeo (${res.status}): ${body}`);
  }
  trackSend(tenant, res);
  return res.json();
}

/**
 * Envia uma mensagem de template aprovado (Meta Message Templates) — única
 * forma permitida de iniciar conversa fora da janela de atendimento de 24h.
 * @param {string[]} bodyParams valores para preencher {{1}}, {{2}}... do corpo do template, na ordem.
 */
export async function sendTemplate(tenant, to, templateName, languageCode, bodyParams = []) {
  // Modo gateway: não há "template" no Baileys (isso é regra da janela 24h da
  // Meta). Pelo chip, mensagem proativa é texto normal — mas sem o corpo
  // resolvido aqui, o mais seguro é não enviar (evita spam sem contexto).
  if (config.gateway.enabled) return {};
  const template = { name: templateName, language: { code: languageCode } };
  if (bodyParams.length) {
    template.components = [
      { type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })) },
    ];
  }
  const res = await fetchWithTimeout(`${baseUrl()}/messages`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template }),
  });
  if (!res.ok) {
    const body = await res.text();
    checkMetaBillingError(res.status, body); // alerta se for pagamento/limite
    trackSend(tenant, res, body);
    throw new Error(`Falha ao enviar template (${res.status}): ${body}`);
  }
  trackSend(tenant, res);
  return res.json();
}

/**
 * Envia um cartão de contato (vCard) — o WhatsApp renderiza com um botão
 * nativo "Adicionar aos contatos" na conversa. Usado no primeiro contato pra
 * o cliente salvar o número da loja com o nome certo, sem precisar digitar.
 * @param {string} name nome a salvar (ex: nome do negócio)
 * @param {string} phoneDigits número da loja, apenas dígitos com DDI (ex: "5511999998888")
 */
export async function sendContact(_tenant, to, name, phoneDigits) {
  if (config.gateway.enabled) return {}; // vCard não suportado pelo /send do worker
  const res = await fetchWithTimeout(`${baseUrl()}/messages`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'contacts',
      contacts: [
        {
          name: { formatted_name: name, first_name: name },
          phones: [{ phone: `+${phoneDigits}`, type: 'CELL', wa_id: phoneDigits }],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Falha ao enviar cartão de contato (${res.status}): ${body}`);
  }
  return res.json();
}

export async function markAsRead(_tenant, messageId) {
  if (config.gateway.enabled) return; // recibos de leitura ficam a cargo do worker
  try {
    await fetchWithTimeout(`${baseUrl()}/messages`, {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
    });
  } catch (err) {
    console.warn('Não foi possível marcar como lida:', err.message);
  }
}

/**
 * Baixa uma mídia (imagem/áudio) recebida pelo WhatsApp via Meta Cloud API.
 * @returns {Promise<{buffer:Buffer, mime:string}>}
 */
export async function downloadMedia(_tenant, mediaId) {
  // Download é idempotente (GET) → timeout + retry seguro em falha transitória.
  const metaRes = await fetchWithRetry(
    `https://graph.facebook.com/${apiVersion}/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } },
    { timeoutMs: MEDIA_TIMEOUT_MS },
  );
  if (!metaRes.ok) throw new Error(`Falha ao obter mídia: ${metaRes.status}`);
  const meta = await metaRes.json();

  const fileRes = await fetchWithRetry(
    meta.url,
    { headers: { Authorization: `Bearer ${token}` } },
    { timeoutMs: MEDIA_TIMEOUT_MS },
  );
  if (!fileRes.ok) throw new Error(`Falha ao baixar mídia: ${fileRes.status}`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { buffer, mime: meta.mime_type || 'application/octet-stream' };
}
