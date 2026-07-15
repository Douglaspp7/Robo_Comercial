/**
 * Entrega automática de produtos digitais (ebook, curso, receita, videoaula
 * etc.) — dispara quando o pagamento de uma venda é confirmado de verdade
 * (webhook do Mercado Pago), nunca só pela IA classificar "fechado", pra não
 * entregar o produto sem uma confirmação real de pagamento.
 *
 * Casamento entre item vendido e produto do catálogo é pelo nome exato —
 * mesma limitação já aceita nas demais features (produtos não têm ID estável).
 */
export function getDigitalDeliveryItems(produtos, itemsJson) {
  let items;
  try {
    items = JSON.parse(itemsJson || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];

  const entregas = [];
  for (const item of items) {
    const produto = (Array.isArray(produtos) ? produtos : []).find((p) => p.nome === item.titulo);
    if (produto?.digital && produto.link_entrega) {
      entregas.push({ nome: produto.nome, link: produto.link_entrega });
    }
  }
  return entregas;
}
