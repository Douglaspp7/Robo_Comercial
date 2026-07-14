// Extração de telefone/WhatsApp a partir de texto livre (bio do Instagram,
// legenda de post, site). Foco em números brasileiros. É a peça que decide a
// qualidade do lead vindo do Instagram, por isso vive isolada e testável.

// Normaliza para dígitos com DDI 55; retorna null se claramente não for um
// telefone brasileiro válido (celular 11 díg. ou fixo 10 díg., + DDI opcional).
export function normalizeBrPhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return null;

  // Remove DDI 55 duplicado / com zero à esquerda de operadora (0XX).
  let d = digits;
  if (d.length === 13 && d.startsWith("55")) d = d.slice(2); // 55 + 11 díg.
  else if (d.length === 12 && d.startsWith("55")) d = d.slice(2); // 55 + 10 díg.
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1); // 0XX...
  // Agora d deve ser o número nacional: 10 (fixo) ou 11 (celular) dígitos.
  if (d.length !== 10 && d.length !== 11) return null;

  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null; // DDD válido no Brasil

  // Celular: 11 díg. e o 3º dígito é 9. Fixo: 10 díg. e começa 2–5.
  if (d.length === 11 && d[2] !== "9") return null;
  if (d.length === 10 && !/[2-5]/.test(d[2])) return null;

  return `55${d}`;
}

// Varre um texto e devolve os telefones brasileiros únicos (normalizados).
// Cobre links wa.me / api.whatsapp.com e números escritos por extenso.
export function extractPhones(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();

  // 1) Links de WhatsApp com o número embutido.
  const linkRe =
    /(?:wa\.me\/|whatsapp\.com\/send\?phone=|api\.whatsapp\.com\/send\?phone=)(\+?\d[\d]{7,14})/gi;
  for (const m of text.matchAll(linkRe)) {
    const n = normalizeBrPhone(m[1]);
    if (n) found.add(n);
  }

  // 2) Números soltos: DDI/DDD opcionais + bloco final de 8–9 dígitos.
  //    Ex.: "(11) 99999-9999", "+55 11 99999 9999", "11999999999".
  const phoneRe =
    /(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4}/g;
  for (const m of text.matchAll(phoneRe)) {
    const n = normalizeBrPhone(m[0]);
    if (n) found.add(n);
  }

  return [...found];
}

// Formata para exibição amigável: (11) 99999-9999.
export function formatBrPhone(normalized: string): string {
  const d = normalized.startsWith("55") ? normalized.slice(2) : normalized;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return normalized;
}
