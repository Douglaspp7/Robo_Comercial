/**
 * Integração com o Hotmart (produtos digitais) — diferente do Bling/Nuvemshop/
 * Tray, não é OAuth: o lojista cola no Zapien o Hottok (token do webhook) que
 * o próprio Hotmart gera, e cadastra a URL de webhook deste tenant no painel
 * do Hotmart. A cada compra aprovada, o Hotmart chama essa URL — nunca o
 * contrário (não há chamada de saída pra API do Hotmart).
 *
 * Confirmação de pagamento pelo Hotmart é tratada com o mesmo cuidado do
 * webhook do Mercado Pago: só fecha a venda e entrega o produto digital
 * quando o evento é PURCHASE_APPROVED, nunca por classificação da IA.
 */
import { timingSafeEqual } from 'node:crypto';

const STATUS_BY_EVENT = {
  PURCHASE_APPROVED: 'pago',
  PURCHASE_COMPLETE: 'pago',
  PURCHASE_REFUNDED: 'perdido',
  PURCHASE_CHARGEBACK: 'perdido',
  PURCHASE_CANCELED: 'perdido',
  PURCHASE_EXPIRED: 'perdido',
  PURCHASE_PROTEST: 'perdido',
};

/** Compara o Hottok recebido com o cadastrado, em tempo constante. */
export function hotmartTokenMatches(received, expected) {
  if (!received || !expected) return false;
  const a = Buffer.from(String(received));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Normaliza um telefone de checkout do Hotmart pro mesmo formato usado em contacts.wa_phone (dígitos, com DDI). */
export function normalizeHotmartPhone(ddd, phone, phoneFull) {
  const raw = (phoneFull || `${ddd || ''}${phone || ''}`).replace(/\D/g, '');
  if (!raw) return null;
  if (raw.startsWith('55') && raw.length >= 12) return raw;
  if (raw.length === 10 || raw.length === 11) return `55${raw}`;
  return raw;
}

/**
 * Extrai da carga do webhook do Hotmart só o que o Zapien precisa. Retorna
 * null se o evento não for reconhecido (versões novas de evento, testes do
 * próprio painel do Hotmart etc.) — quem chama ignora nesse caso.
 */
export function parseHotmartEvent(body) {
  const event = body?.event;
  const status = STATUS_BY_EVENT[event];
  if (!status) return null;

  const purchase = body?.data?.purchase || {};
  const buyer = body?.data?.buyer || {};
  const product = body?.data?.product || {};

  const phone = normalizeHotmartPhone(buyer.checkout_phone_code, buyer.checkout_phone, buyer.checkout_phone_full_number);
  const transactionId = purchase.transaction || body?.data?.subscription?.subscriber?.code || null;
  const priceValue = Number(purchase.price?.value || purchase.full_price?.value || 0);

  return {
    event,
    status,
    transactionId,
    buyerName: buyer.name || null,
    phone,
    productName: product.name || null,
    priceValue: Number.isFinite(priceValue) ? priceValue : 0,
  };
}
