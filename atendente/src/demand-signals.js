import { db } from './db.js';

const DEFAULT_WINDOW_HOURS = 2;
const DEFAULT_MIN_COUNT = 3;

/**
 * Sinal de demanda agregada — cada conversa hoje é analisada isoladamente
 * (funil, tags, próxima ação); esta função cruza sinais ENTRE conversas do
 * mesmo tenant pra detectar quando vários contatos distintos perguntaram
 * pelo mesmo produto numa janela recente, sugerindo aproveitar o momento
 * (post, story, destaque no catálogo) — algo que atendimento conversa-a-
 * conversa não enxerga sozinho.
 */
export function getDemandSignals(tenantId, { windowHours = DEFAULT_WINDOW_HOURS, minCount = DEFAULT_MIN_COUNT } = {}) {
  const rows = db.prepare(`
    SELECT last_produto_mencionado AS produto, COUNT(*) AS n, MAX(last_produto_mencionado_at) AS ultimo_em
    FROM contacts
    WHERE tenant_id = ?
      AND last_produto_mencionado IS NOT NULL
      AND last_produto_mencionado_at >= datetime('now', ?)
    GROUP BY last_produto_mencionado
    HAVING COUNT(*) >= ?
    ORDER BY n DESC
  `).all(tenantId, `-${windowHours} hours`, minCount);

  return rows.map((r) => ({
    produto: r.produto,
    contatos: r.n,
    janelaHoras: windowHours,
  }));
}
