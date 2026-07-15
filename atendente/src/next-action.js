// Motivos de transbordo humano — mesmos valores do tool escalar_para_humano em ai.js.
const HANDOFF_REASON_LABEL = {
  pediu_humano: 'O cliente pediu para falar com uma pessoa.',
  reclamacao: 'O cliente fez uma reclamação — priorize a resposta.',
  pos_venda: 'Problema relatado após a compra — atenção humana recomendada.',
  sem_informacao: 'A IA não encontrou a informação no material da loja.',
  muito_irritado: 'O cliente parece irritado — melhor um humano assumir.',
  risco_sensivel: 'Assunto sensível — melhor um humano assumir.',
  limite_ia: 'O atendimento automático atingiu o limite do plano.',
  solicitacao_dados: 'Cliente pediu acesso, correção ou exclusão dos próprios dados (LGPD) — responda em até 15 dias.',
  outro: 'Motivo não especificado — confira a conversa.',
};

function fmtDias(n) {
  return `${n} dia${n === 1 ? '' : 's'}`;
}

function hoursSince(dateStr) {
  if (!dateStr) return Infinity;
  let s = dateStr.trim().replace(' ', 'T');
  if (!s.endsWith('Z') && !s.includes('+')) s += 'Z';
  const d = new Date(s);
  if (isNaN(d)) return Infinity;
  return (Date.now() - d.getTime()) / 3600000;
}

/**
 * Sugere a próxima ação comercial para um atendimento, com motivo curto e
 * mensagem pronta para copiar/enviar. Regras determinísticas (sem chamar IA) —
 * baratas de calcular para todo atendimento, sempre com o mesmo resultado
 * para os mesmos dados de entrada.
 *
 * @param {object} contact
 * @param {string} contact.stage
 * @param {string} contact.handoff_status
 * @param {string} [contact.handoff_reason]
 * @param {string[]} [contact.tags]
 * @param {string} [contact.buy_intent]
 * @param {string} contact.last_message_at
 * @param {boolean} [contact.aguardandoPagamento] há venda em aberto aguardando pagamento
 * @returns {{acao: string, motivo: string, mensagem: string|null}}
 */
export function suggestNextAction(contact) {
  const {
    stage, handoff_status: handoffStatus, handoff_reason: handoffReason,
    tags = [], buy_intent: buyIntent, last_message_at: lastMessageAt, aguardandoPagamento,
  } = contact;
  const staleHours = hoursSince(lastMessageAt);

  if (handoffStatus === 'waiting') {
    return {
      acao: 'Assumir a conversa',
      motivo: HANDOFF_REASON_LABEL[handoffReason] || 'O cliente está aguardando atendimento humano.',
      mensagem: null,
    };
  }

  if (tags.includes('pediu desconto')) {
    return {
      acao: 'Avaliar desconto ou condição especial',
      motivo: 'O cliente pediu desconto — decida se vale oferecer uma condição especial.',
      mensagem: 'Entendo! Deixa eu ver o que consigo fazer por você e já te retorno com uma condição especial 😊',
    };
  }

  if (tags.includes('frete caro')) {
    return {
      acao: 'Oferecer alternativa de frete',
      motivo: 'O cliente achou o frete caro.',
      mensagem: 'Entendi 😊 Se quiser, posso verificar uma opção de entrega mais econômica ou uma alternativa de produto com frete menor.',
    };
  }

  if (stage === 'checkout' && aguardandoPagamento && staleHours >= 2) {
    return {
      acao: 'Enviar lembrete de pagamento',
      motivo: `Pagamento em aberto há ${Math.round(staleHours)}h sem retorno do cliente.`,
      mensagem: 'Oi! Vi que seu pedido ainda está aguardando o pagamento 🙂 Posso te ajudar a finalizar? Qualquer dúvida, me chama!',
    };
  }

  if (stage === 'orcamento' && staleHours >= 24) {
    return {
      acao: 'Recuperar orçamento parado',
      motivo: `Orçamento enviado há mais de ${fmtDias(Math.floor(staleHours / 24))} sem resposta.`,
      mensagem: 'Oi! Passando para saber se você ainda tem interesse no orçamento que te enviei. Posso ajudar com mais alguma coisa? 😊',
    };
  }

  if (stage === 'fechado') {
    return {
      acao: 'Fazer pós-venda',
      motivo: 'Venda concluída — bom momento para pedir avaliação ou oferecer algo complementar.',
      mensagem: 'Que bom que fechamos negócio! 🎉 Se puder, adoraria saber sua opinião sobre o produto depois que chegar. Qualquer coisa, estou por aqui!',
    };
  }

  if (stage === 'perdido') {
    return {
      acao: 'Tentar recuperar a venda',
      motivo: 'Esta oportunidade foi marcada como perdida.',
      mensagem: 'Oi! Faz um tempo que conversamos — ainda tem interesse? Se quiser, posso ver uma condição diferente para fechar com você 🙂',
    };
  }

  if (buyIntent === 'alta' && ['novo_contato', 'duvida'].includes(stage)) {
    return {
      acao: 'Avançar para orçamento',
      motivo: 'Cliente demonstrou alta intenção de compra.',
      mensagem: 'Perfeito! Posso te passar os valores e condições agora mesmo, quer? 😊',
    };
  }

  if (staleHours >= 24 && !['fechado', 'perdido'].includes(stage)) {
    return {
      acao: 'Enviar um retorno',
      motivo: `Sem resposta do cliente há mais de ${fmtDias(Math.floor(staleHours / 24))}.`,
      mensagem: 'Oi! Ainda por aqui 🙂 Posso te ajudar com mais alguma coisa?',
    };
  }

  return {
    acao: 'Continuar o atendimento',
    motivo: 'Nenhuma ação especial identificada no momento.',
    mensagem: null,
  };
}
