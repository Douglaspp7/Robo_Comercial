/**
 * Módulo central de roteamento por pontuação natural — WhatsApp Entry Route.
 *
 * Cada loja recebe uma combinação permanente: entry_handle + entry_code.
 * O entry_code é formado por 3 símbolos: opening + middle + question.
 *
 * Mensagem de ativação gerada:
 *   "Olá❕ Conheci a @vilaflor◇ e queria tirar uma dúvida❔"
 *
 * Capacidade: 2 × 16 × 2 = 64 combinações por handle.
 * O mesmo handle pode ser reutilizado em lojas diferentes (entry_handle não é único globalmente).
 * O par (entry_handle, entry_code) deve ser único.
 */
import { randomInt } from 'node:crypto';

export const OPENING_SYMBOLS = [
  '❕',
  '❗',
];

export const MIDDLE_SYMBOLS = [
  '·', '•', '◦', '○', '●',
  '◇', '◆', '□', '■',
  '△', '▲', '▽', '▼',
  '☆', '★', '✦',
];

export const QUESTION_SYMBOLS = [
  '❔',
  '❓',
];

/**
 * Valida se `code` é exatamente 3 símbolos nas posições corretas:
 *   [0] ∈ OPENING_SYMBOLS, [1] ∈ MIDDLE_SYMBOLS, [2] ∈ QUESTION_SYMBOLS.
 * Usa Array.from() para tratar corretamente codepoints > U+FFFF.
 */
export function isValidEntryCode(code) {
  if (!code) return false;
  const chars = Array.from(code);
  return (
    chars.length === 3 &&
    OPENING_SYMBOLS.includes(chars[0]) &&
    MIDDLE_SYMBOLS.includes(chars[1]) &&
    QUESTION_SYMBOLS.includes(chars[2])
  );
}

/**
 * Gera um candidato aleatório de entry_code (3 símbolos: opening + middle + question).
 * Usa crypto.randomInt — nunca Math.random.
 * Não garante unicidade dentro de um handle — use generateAvailableEntryCode() em db.js.
 */
export function generateEntryCode() {
  const opening  = OPENING_SYMBOLS[randomInt(OPENING_SYMBOLS.length)];
  const middle   = MIDDLE_SYMBOLS[randomInt(MIDDLE_SYMBOLS.length)];
  const question = QUESTION_SYMBOLS[randomInt(QUESTION_SYMBOLS.length)];
  return opening + middle + question;
}

/**
 * Converte nome comercial em entry_handle.
 * Regras: lowercase, sem acentos, espaços → hífen, apenas [a-z0-9-], máx 60 chars.
 * Nunca adiciona números automaticamente.
 */
export function createEntryHandle(businessName) {
  return (businessName || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // remove diacríticos
    .replace(/[^a-z0-9]+/g, '-')      // não-alfanumérico → hífen
    .replace(/^-+|-+$/g, '')          // remove hífens nas extremidades
    .replace(/-{2,}/g, '-')           // colapsa hífens consecutivos
    .slice(0, 60) || 'loja';
}

/**
 * Constrói a mensagem de ativação do WhatsApp a partir do tenant.
 * Requer que o tenant tenha entry_handle e entry_code válidos.
 *
 * Formato: "Olá❕ Conheci a @vilaflor◇ e queria tirar uma dúvida❔"
 * Regras de espaçamento:
 *  - Sem espaço entre "Olá" e opening symbol
 *  - Sem espaço entre @handle e middle symbol
 *  - Sem espaço entre "dúvida" e question symbol
 */
export function buildWhatsAppEntryMessage(tenant) {
  const [openingSymbol, middleSymbol, questionSymbol] =
    Array.from(tenant.entry_code);

  return (
    `Olá${openingSymbol} Conheci a @${tenant.entry_handle}${middleSymbol} ` +
    `e queria tirar uma dúvida${questionSymbol}`
  );
}
