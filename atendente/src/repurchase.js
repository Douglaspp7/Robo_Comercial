import { db } from './db.js';

/**
 * Sugestão de recompra — regras determinísticas (sem IA), iguais em espírito
 * ao next-action.js: baratas de calcular, sempre o mesmo resultado pros
 * mesmos dados. Produtos marcados com "ciclo_dias" (ex: perfume dura ~30
 * dias) geram uma sugestão quando já se passou o ciclo desde a compra paga
 * mais recente daquele produto por aquele contato.
 *
 * Produtos não têm ID estável — o casamento entre item vendido e produto do
 * catálogo é pelo nome exato (mesma limitação já aceita na lista de espera
 * de reposição).
 */
export function getRepurchaseSuggestions(tenantId, produtos) {
  const ciclos = new Map(
    (Array.isArray(produtos) ? produtos : [])
      .filter((p) => p.nome && Number(p.ciclo_dias) > 0)
      .map((p) => [p.nome, Number(p.ciclo_dias)])
  );
  if (!ciclos.size) return [];

  const sales = db.prepare(`
    SELECT s.contact_id, s.items_json, s.paid_at, c.wa_phone, c.name
    FROM sales s
    JOIN contacts c ON c.id = s.contact_id
    WHERE s.tenant_id = ? AND s.status IN ('pago', 'paid') AND s.paid_at IS NOT NULL
    ORDER BY s.paid_at DESC
  `).all(tenantId);

  // SQL já traz ordenado por paid_at DESC — o primeiro (contato, produto) que
  // aparece na iteração é sempre a compra mais recente daquele par.
  const seen = new Set();
  const suggestions = [];
  const now = Date.now();

  for (const sale of sales) {
    let items;
    try { items = JSON.parse(sale.items_json || '[]'); } catch { continue; }
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      const cicloDias = ciclos.get(item.titulo);
      if (!cicloDias) continue;

      const key = `${sale.contact_id}:${item.titulo}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const paidAt = new Date(String(sale.paid_at).replace(' ', 'T') + 'Z');
      if (isNaN(paidAt)) continue;

      const diasDesde = Math.floor((now - paidAt.getTime()) / 86400000);
      if (diasDesde < cicloDias) continue;

      const primeiroNome = (sale.name || '').trim().split(' ')[0];
      const saudacao = primeiroNome ? `Oi ${primeiroNome}!` : 'Oi!';
      suggestions.push({
        phone: sale.wa_phone,
        name: sale.name || sale.wa_phone,
        produto: item.titulo,
        diasDesde,
        cicloDias,
        mensagem: `${saudacao} Faz ${diasDesde} dias que você levou ${item.titulo} — geralmente é por essa época que costuma acabar. Quer que eu já separe mais um pra você? 😊`,
      });
    }
  }

  // Mais atrasada (maior diferença entre dias-desde e ciclo) primeiro.
  suggestions.sort((a, b) => (b.diasDesde - b.cicloDias) - (a.diasDesde - a.cicloDias));
  return suggestions;
}
