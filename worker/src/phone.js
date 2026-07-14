/**
 * Normalização de telefone → JID do WhatsApp.
 * Espelha o getWaNumber() do painel (src/app/page.tsx): limpa não-dígitos e
 * garante o DDI. Mantém a mesma regra para não haver divergência entre o que
 * o painel mostra e o que o worker envia.
 */
import { config } from "./config.js";

/** "(11) 99999-9999" -> "5511999999999" (ou null se claramente inválido). */
export function normalizeNumber(phone) {
  if (!phone) return null;
  const clean = String(phone).replace(/\D/g, "");
  if (clean.length < 10) return null;
  const ddi = config.defaultCountryCode;
  return clean.startsWith(ddi) ? clean : `${ddi}${clean}`;
}

/** Número normalizado -> JID individual do WhatsApp. */
export function numberToJid(phone) {
  const n = normalizeNumber(phone);
  return n ? `${n}@s.whatsapp.net` : null;
}

/**
 * Expande spintax: cada grupo {opção1|opção2|...} vira uma opção sorteada.
 * Cada destinatário recebe uma variação diferente → reduz a "assinatura" de
 * mensagem idêntica (anti-ban). Suporta aninhamento (passes repetidos).
 * Grupos sem "|" (ex.: {nome}) NÃO são tocados.
 */
export function expandSpintax(text) {
  if (!text) return "";
  let out = String(text);
  const groupRe = /\{([^{}]*\|[^{}]*)\}/;
  let guard = 0;
  while (groupRe.test(out) && guard++ < 100) {
    out = out.replace(groupRe, (_, body) => {
      const opts = body.split("|");
      return opts[Math.floor(Math.random() * opts.length)];
    });
  }
  return out;
}

/** Expande spintax, aplica {nome} e anexa a URL do app. */
export function renderMessage(template, name, appUrl) {
  let text = expandSpintax(template || "");
  text = text.replace(/\{nome\}/gi, name || "");
  if (appUrl && appUrl.trim()) {
    text = `${text}\n\n${appUrl.trim()}`;
  }
  return text;
}
