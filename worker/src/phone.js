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

/** Aplica {nome} e anexa a URL do app (mesma composição do painel). */
export function renderMessage(template, name, appUrl) {
  let text = (template || "").replace(/\{nome\}/gi, name || "");
  if (appUrl && appUrl.trim()) {
    text = `${text}\n\n${appUrl.trim()}`;
  }
  return text;
}
