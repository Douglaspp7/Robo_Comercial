/**
 * Conversation guard — protects AI credits and routes complaints to humans.
 * All classification is deterministic / local — no AI call to classify.
 */

// ── Human request detection ──────────────────────────────────────────────────
const HUMAN_REQUEST_RE = /\b(atendente|atendimento\s+humano|falar\s+com\s+(algu[eé]m|uma\s+pessoa|o\s+respons[aá]vel|um\s+humano|voc[eê]s|a\s+equipe)|pessoa\s+real|humano|gerente|respons[aá]vel|vendedor|suporte|fala\s+com\s+algu[eé]m|me\s+passa\s+pra|quero\s+falar\s+com|falar\s+diretamente|dono\s+da\s+loja|loja\s+me\s+(ligue|liga|chame))\b/i;

export function isExplicitHumanRequest(text) {
  return HUMAN_REQUEST_RE.test(text);
}

// ── Complaint / post-sale detection ─────────────────────────────────────────
const COMPLAINT_RE = /\b(reclama[cç][aã]o|reclamar|produto\s+(quebrado|com\s+defeito|danificado|errado|diferente|veio?\s+errado)|item\s+(errado|faltando|incompleto)|pedido\s+(n[aã]o\s+chegou|atrasado|desapareceu|incompleto|errado|cancelar)|entrega\s+atrasada|cobran[cç]a\s+(indevida|duplicada|errada)|pagamento\s+(n[aã]o\s+confirmado|n[aã]o\s+caiu|estornar)|quero\s+(cancelar|estorno|reembolso|devolver|troca|trocar)|est[ao]\s+(insatisfeito|decepcionado|revoltado|bravo\s+com|com\s+raiva)|propaganda\s+enganosa|produto\s+vencido|problema\s+com\s+garantia|problema\s+no\s+pedido|meu\s+pedido\s+n[aã]o|n[aã]o\s+recebi\s+(meu|o)\s+pedido|fui\s+enganado|procon|reclame\s+aqui|ir\s+pra\s+justi[cç]a|medida\s+judicial|risco\s+[aà]\s+sa[uú]de|risco\s+de\s+seguran[cç]a)\b/i;

export function isComplaintOrPostSaleProblem(text) {
  return COMPLAINT_RE.test(text);
}

// ── Prompt injection detection ───────────────────────────────────────────────
const INJECTION_RE = /\b(ignore\s+(as\s+)?(instru[cç][oõ]es|regras|prompt)|mostre?\s+(o\s+)?(prompt|sistema|instru[cç][oõ]es|configura[cç][oõ]es)|finja\s+(ser|que|n[aã]o)|voc[eê]\s+[eé]\s+(agora|na\s+verdade)|esquece?\s+tudo|aja\s+como\s+(chatgpt|gpt|openai|assistente|rob[oô]|sem\s+regras)|sem\s+regras|sem\s+restri[cç][oõ]es|revele?\s+(suas\s+)?(regras|prompt|instru[cç][oõ]es|chave|token|senha)|repita\s+(o\s+)?(que\s+)?(est[aá]\s+no\s+sistema|suas\s+regras|o\s+prompt)|responda\s+sem\s+seguir|modo\s+desenvolvedor|dan?mode|fa[cç]a\s+qualquer\s+coisa|diga-me\s+seus\s+segredos|instru[cç][aã]o\s+do\s+sistema)\b/i;

export function isPromptInjectionAttempt(text) {
  return INJECTION_RE.test(text);
}

// ── Off-topic detection ──────────────────────────────────────────────────────
// Only high-confidence patterns that couldn't be commercial messages.
// Uses phrase-level patterns, not isolated keywords.
const OFF_TOPIC_PATTERNS = [
  /\bme?\s+conta?\s+uma?\s+piada\b/i,
  /\bfaz?\s+uma?\s+piada\b/i,
  /\bconta?\s+uma?\s+hist[oó]ria\b/i,
  /\bme?\s+conta?\s+uma?\s+hist[oó]ria\b/i,
  /\bescreve?\s+(um\s+)?(poema|texto\s+longo|conto|reda[cç][aã]o|disserta[cç][aã]o)\b/i,
  /\bcanta?\s+uma?\s+m[uú]sica\b/i,
  /\bme?\s+ajuda?\s+(na?\s+)?li[cç][aã]o\b/i,
  /\bfaz?\s+um?\s+trabalho\s+(escolar|da\s+escola|faculdade)\b/i,
  /\bresolv[ea]\s+(esta?\s+)?(conta|equa[cç][aã]o|exerc[ií]cio|problema\s+de\s+matem[aá]tica)\b/i,
  /\bquem\s+[eé]\s+o\s+(presidente|governador|prefeito)\b/i,
  /\bfale?\s+sobre\s+(futebol|pol[ií]tica|religi[aã]o|not[ií]cia|esporte|novela)\b/i,
  /\bme?\s+d[eê]\s+um?\s+conselho\s+(amoroso|pessoal|de\s+vida|sentimental|de\s+relacionamento)\b/i,
  /\bqual\s+o\s+sentido\s+da\s+vida\b/i,
  /\bvamos\s+(jogar|brincar|fazer\s+um\s+jogo)\b/i,
  /\bme?\s+passa\s+uma?\s+receita\s+(culin[aá]ria|de\s+bolo|de\s+comida)\b/i,
  /\btraduz?\s+(para|p[r']a)\s+ingl[eê]s\b/i,
  /\bdigite\s+[0-9]+\s+vezes\b/i,
];

export function isClearlyOffTopic(text, tenantProductNames = []) {
  // Check against product names to avoid false positives
  const lowerText = text.toLowerCase();
  for (const pattern of OFF_TOPIC_PATTERNS) {
    if (pattern.test(text)) {
      // Check if any product name appears in the text — might be commercial
      if (tenantProductNames.some(name => lowerText.includes(name.toLowerCase()))) {
        return false;
      }
      return true;
    }
  }
  return false;
}

/**
 * AI response validation — catch cases where AI said "contact team" without handoff.
 * Returns true if the response looks like a responsibility dodge without real handoff.
 */
const DODGE_PHRASES_RE = /\b(n[aã]o\s+tenho\s+essa\s+informa[cç][aã]o|n[aã]o\s+sei\s+informar|consulte?\s+(nossa\s+)?(equipe|loja)|entre\s+em\s+contato\s+com\s+(a\s+)?equipe|fale\s+com\s+um\s+atendente|algu[eé]m\s+da\s+equipe\s+poder[aá]\s+informar|vou\s+verificar\s+e\s+retorno|n[aã]o\s+posso\s+confirmar|n[aã]o\s+tenho\s+acesso|procure\s+nosso\s+suporte|confirme\s+diretamente\s+com\s+a\s+loja)\b/i;

// Phrases that are VALID "we don't have" responses (not dodges)
const VALID_NO_PHRASES_RE = /\b(n[aã]o\s+temos?\s+(esse|este|o|este\s+tipo\s+de|dispon[ií]vel)\s+(produto|item|modelo|tamanho|varia[cç][aã]o|cor)|n[aã]o\s+trabalhamos?\s+com|infelizmente\s+n[aã]o\s+temos?)\b/i;

export function isAiDodgingWithoutHandoff(responseText) {
  if (VALID_NO_PHRASES_RE.test(responseText)) return false;
  return DODGE_PHRASES_RE.test(responseText);
}

// ── Classification ───────────────────────────────────────────────────────────
export function classifyIncomingMessage(text, tenantProductNames = []) {
  if (isPromptInjectionAttempt(text)) {
    return { category: 'prompt_injection', reason: 'prompt_injection_detected', confidence: 'high' };
  }
  if (isExplicitHumanRequest(text)) {
    return { category: 'human_request', reason: 'explicit_human_request', confidence: 'high' };
  }
  if (isComplaintOrPostSaleProblem(text)) {
    return { category: 'complaint', reason: 'complaint_or_post_sale', confidence: 'high' };
  }
  if (isClearlyOffTopic(text, tenantProductNames)) {
    return { category: 'off_topic', reason: 'clearly_off_topic', confidence: 'high' };
  }
  return { category: 'unknown', reason: 'not_classified', confidence: 'low' };
}

// ── Off-topic rate limiting ─────────────────────────────────────────────────
/**
 * Returns { muted: bool, count: number, replyText: string|null }
 * Updates contact off_topic_count and muted_until in DB via returned mutations.
 */
export function handleOffTopicMessage(contact, offTopicMuteMinutes = 30) {
  const now = Date.now();
  const windowMs = offTopicMuteMinutes * 60 * 1000;

  // Check if currently muted
  if (contact.off_topic_muted_until) {
    const mutedUntil = new Date(contact.off_topic_muted_until).getTime();
    if (now < mutedUntil) {
      return { muted: true, silent: true, newCount: contact.off_topic_count, newWindowStart: contact.off_topic_window_started_at, newMutedUntil: contact.off_topic_muted_until };
    }
  }

  // Check/reset window
  let count = contact.off_topic_count || 0;
  let windowStart = contact.off_topic_window_started_at;

  if (!windowStart || (now - new Date(windowStart).getTime()) > windowMs) {
    count = 0;
    windowStart = new Date().toISOString();
  }

  count++;
  let newMutedUntil = contact.off_topic_muted_until;
  let replyText = null;
  let silent = false;

  if (count === 1) {
    replyText = 'Posso ajudar com produtos, pedidos, pagamentos, entregas e outras informações desta empresa 😊\n\nO que você gostaria de saber sobre a loja?';
  } else if (count === 2) {
    replyText = 'Por aqui consigo ajudar somente com assuntos relacionados à empresa e ao atendimento comercial.';
  } else {
    // 3rd+ attempt: mute for window
    newMutedUntil = new Date(now + windowMs).toISOString();
    silent = true;
  }

  return {
    muted: count >= 3,
    silent,
    replyText,
    newCount: count,
    newWindowStart: windowStart,
    newMutedUntil,
  };
}

// ── AI rate limiting ─────────────────────────────────────────────────────────
export function checkContactAiLimits(contact, limits) {
  const now = Date.now();
  const tenMinMs = 10 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;

  // Check 10-min window
  let calls10 = contact.ai_calls_10min || 0;
  let win10Start = contact.ai_window_10min_started_at;
  if (!win10Start || (now - new Date(win10Start).getTime()) > tenMinMs) {
    calls10 = 0;
    win10Start = new Date().toISOString();
  }

  // Check day window
  let callsDay = contact.ai_calls_day || 0;
  let winDayStart = contact.ai_window_day_started_at;
  if (!winDayStart || (now - new Date(winDayStart).getTime()) > dayMs) {
    callsDay = 0;
    winDayStart = new Date().toISOString();
  }

  if (calls10 >= limits.maxCalls10Min) {
    return { allowed: false, reason: 'rate_10min', newCalls10: calls10, newWin10Start: win10Start, newCallsDay: callsDay, newWinDayStart: winDayStart };
  }
  if (callsDay >= limits.maxCallsDay) {
    return { allowed: false, reason: 'rate_day', newCalls10: calls10, newWin10Start: win10Start, newCallsDay: callsDay, newWinDayStart: winDayStart };
  }

  return {
    allowed: true,
    reason: null,
    newCalls10: calls10 + 1,
    newWin10Start: win10Start,
    newCallsDay: callsDay + 1,
    newWinDayStart: winDayStart,
  };
}
