const ALLOWED_ROLES = new Set(['user', 'assistant']);

export function sanitizeSimulationMessages(incoming) {
  if (!Array.isArray(incoming)) return [];

  return incoming
    .filter((message) => (
      message &&
      ALLOWED_ROLES.has(message.role) &&
      typeof message.content === 'string'
    ))
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 2000),
    }));
}

export function buildSimulationResponse(result) {
  return {
    mensagem: result.mensagem,
    etapa: result.etapa,
    intencao_compra: result.intencao_compra,
    resumo: result.resumo || '',
    produto_mencionado: result.produto_mencionado || null,
    enviar_catalogo: Boolean(result.enviar_catalogo),
    precisa_humano: Boolean(result.precisa_humano),
    motivo_humano: result.motivo || null,
    pedido: result.pedido || null,
    simulated: true,
  };
}
