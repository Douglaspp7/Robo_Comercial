/**
 * Ponte worker → atendente.
 *
 * Quando um lead RESPONDE ao disparo, o worker (que é dono do chip via Baileys)
 * encaminha a resposta para o ATENDENTE — a cópia do Zapien configurada para
 * vender o próprio Zapien. O atendente pensa, e responde o lead pelo MESMO chip
 * chamando de volta o POST /send do worker (ver server.js).
 *
 * Desacoplado de propósito: o worker não conhece o banco nem a IA do atendente.
 * Só entrega { number_id, phone, jid, text, name } e segue a vida. Assim o
 * disparo (anti-ban, pool de leads, agendador) e o atendimento (dashboard,
 * handoff) ficam em ledgers separados, ligados apenas pelo número de telefone.
 *
 * Nunca logamos o conteúdo das mensagens — só telefone abreviado (em wa.js).
 */
import { config } from "./config.js";

/**
 * Decide o que fazer com uma mensagem recebida de um lead.
 *   "optout"  → contém palavra de opt-out: o worker suprime e NÃO encaminha.
 *   "forward" → texto normal: encaminhar ao atendente (qualquer palavra ativa).
 *   "ignore"  → vazio/sem texto (ex.: mídia pura): não faz nada.
 */
export function classifyInbound(text, optoutKeywords = config.optoutKeywords) {
  const clean = (text || "").trim().toLowerCase();
  if (!clean) return "ignore";
  const words = clean.split(/\s+/);
  if (words.some((w) => optoutKeywords.includes(w))) return "optout";
  return "forward";
}

/** Sinal simples e auditável de interesse. A IA do atendente continua fazendo
 * a qualificação completa; aqui só marcamos intenção inicial para o relatório. */
export function classifyInterest(text) {
  const clean = String(text || '').trim().toLowerCase();
  if (!clean) return false;
  return /\b(pre[cç]o|valor|quanto|demonstra[cç][aã]o|demo|quero|tenho interesse|como funciona|plano|contratar|assinatura)\b/u.test(clean);
}

/**
 * Encaminha uma resposta ao atendente. Best-effort: nunca lança — uma falha de
 * rede não pode derrubar a sessão do WhatsApp. Retorna true se entregou (2xx).
 *
 * `deps` permite injetar url/token/fetch nos testes.
 */
export async function forwardToAttendant(payload, deps = {}) {
  const url = deps.attendantUrl ?? config.attendantUrl;
  const token = deps.attendantToken ?? config.attendantToken;
  const doFetch = deps.fetch ?? fetch;
  if (!url) return false; // sem atendente configurado → só disparo + opt-out
  try {
    const res = await doFetch(`${url}/inbound`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-worker-token": token } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}
