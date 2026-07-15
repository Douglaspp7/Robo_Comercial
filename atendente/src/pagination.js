/**
 * Paginação por cursor.
 *
 * Por que cursor e não OFFSET:
 *  - OFFSET fica progressivamente mais lento em listas grandes (o banco tem
 *    que varrer e descartar as N linhas anteriores);
 *  - com escritas concorrentes (novas mensagens, novos contatos), OFFSET
 *    "pula" ou "duplica" registros — o usuário vê a mesma mensagem duas
 *    vezes ou pula uma na paginação.
 *
 * O cursor é sempre a chave de ordenação da última linha da página. Para
 * as listagens do Zapien, a ordenação estável é `(timestamp DESC, id DESC)`
 * — assim empates de timestamp são resolvidos pelo id, evitando dropout.
 *
 * Formato do cursor: base64url de JSON `{t, id}`. Opaco para o cliente,
 * validado no servidor, sem dados sensíveis. Tamanho pequeno (~40 bytes).
 */

export const DEFAULT_LIMIT = 50;
export const MIN_LIMIT = 10;
export const MAX_LIMIT = 100;
const MAX_CURSOR_LEN = 256;

/**
 * Codifica um cursor a partir da última linha da página.
 * @param {{t: string|number, id: number|string}} v
 * @returns {string}
 */
export function encodeCursor(v) {
  if (!v) return null;
  const payload = JSON.stringify({ t: v.t, id: v.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Decodifica um cursor recebido do cliente. Retorna null se inválido ou
 * malformado — o chamador trata como "primeira página".
 * @param {string} raw
 * @returns {{t: string|number, id: number|string}|null}
 */
export function decodeCursor(raw) {
  if (!raw || typeof raw !== 'string' || raw.length > MAX_CURSOR_LEN) return null;
  try {
    const payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (payload.t === undefined || payload.id === undefined) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Normaliza `limit` recebido via query (`?limit=42`) para o intervalo válido.
 * @param {any} raw
 * @param {number} [defaultLimit]
 */
export function clampLimit(raw, defaultLimit = DEFAULT_LIMIT) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultLimit;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(n)));
}

/**
 * Monta o envelope de resposta padronizado.
 * @param {Array} rows linhas já ordenadas por (timestamp DESC, id DESC)
 * @param {number} limit limite solicitado (pedimos limit+1 no servidor para
 *   detectar has_more sem outra query).
 * @param {(row: any) => {t: string|number, id: number|string}} pickCursor
 *   função que extrai (timestamp, id) da última linha.
 */
export function paginate(rows, limit, pickCursor) {
  const has_more = rows.length > limit;
  const items = has_more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const next_cursor = has_more && last ? encodeCursor(pickCursor(last)) : null;
  return { items, has_more, next_cursor };
}
