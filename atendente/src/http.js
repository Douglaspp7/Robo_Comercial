/**
 * Helpers de HTTP com timeout e retry — protegem o servidor contra chamadas
 * externas penduradas.
 *
 * Sem timeout, um fetch para o WhatsApp/Mercado Pago/Melhor Envio que nunca
 * responde congela para sempre um slot da fila de IA (concorrência limitada).
 * Cinco chamadas penduradas travam o atendimento automático de TODOS os tenants.
 */

/**
 * fetch com timeout. Aborta a requisição após timeoutMs e lança um erro claro
 * em vez de pendurar indefinidamente.
 * @param {string} url
 * @param {object} [options]  opções normais de fetch (headers, method, body...)
 * @param {number} [timeoutMs=15000]
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  // Respeita um signal já fornecido; caso contrário cria um por timeout.
  const signal = options.signal || AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(url, { ...options, signal });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      let host = url;
      try { host = new URL(url).host; } catch { /* url pode não ser absoluta */ }
      const e = new Error(`Timeout (${timeoutMs}ms) ao chamar ${host}`);
      e.code = 'ETIMEDOUT';
      throw e;
    }
    throw err;
  }
}

/**
 * fetch com timeout + retry. USE SOMENTE para operações idempotentes/seguras
 * de repetir (ex.: GET de download de mídia). NÃO use para envios (POST de
 * mensagem, criação de pagamento) — repetir pode gerar duplicidade.
 * Retenta apenas em erros de rede/timeout/5xx, com backoff exponencial.
 * @param {string} url
 * @param {object} [options]
 * @param {{timeoutMs?:number, retries?:number, baseDelayMs?:number}} [cfg]
 */
export async function fetchWithRetry(url, options = {}, cfg = {}) {
  const { timeoutMs = 15000, retries = 2, baseDelayMs = 500 } = cfg;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);
      // 5xx é transitório → retenta; 4xx é definitivo → devolve como está.
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (err) {
      lastErr = err; // timeout/erro de rede → retenta
      if (attempt >= retries) break;
    }
    await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
  }
  throw lastErr;
}
