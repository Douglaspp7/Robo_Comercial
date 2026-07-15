/**
 * Predefinições de automação — modelos prontos que APENAS preenchem o
 * formulário no painel; o lojista revisa e salva. Nada é criado sozinho.
 * Cada preset é validável por validateAutomation() (mesmas allowlists).
 */
export const AUTOMATION_PRESETS = [
  {
    id: 'alta_intencao_parada',
    name: 'Cliente de alta intenção parado',
    summary: 'Quando um cliente com alta intenção ficar 2 horas sem responder e ainda não tiver fechado, avisar você.',
    automation: {
      name: 'Cliente de alta intenção parado',
      description: 'Avisa quando um cliente quente esfria.',
      trigger_type: 'contact_idle',
      trigger_config: { idle_minutes: 120 },
      conditions: [
        { type: 'buy_intent_equals', value: 'alta' },
        { type: 'stage_in', values: ['duvida', 'orcamento', 'negociacao', 'checkout'] },
      ],
      actions: [
        { type: 'create_internal_notification', title: 'Cliente quente parado', message: 'Um cliente com alta intenção está sem responder há 2 horas. Vale retomar a conversa.' },
        { type: 'send_push_notification', title: 'Cliente quente parado', body: 'Um cliente com alta intenção parou de responder.' },
      ],
      cooldown_seconds: 3600,
    },
  },
  {
    id: 'checkout_sem_pagamento',
    name: 'Checkout sem pagamento',
    summary: 'Quando um checkout for enviado e continuar sem pagamento após 24 horas, enviar um template aprovado de lembrete.',
    requires_plan: 'elite',
    automation: {
      name: 'Checkout sem pagamento (24h)',
      description: 'Lembrete automático para pagamento pendente.',
      trigger_type: 'checkout_sent',
      trigger_config: { delay_minutes: 1440 },
      conditions: [],
      actions: [
        // O lojista escolhe o template cadastrado no passo de revisão.
        { type: 'send_whatsapp_template', template_nome: '' },
        { type: 'add_tag', tag: 'retorno-pendente' },
      ],
      cooldown_seconds: 86400,
    },
  },
  {
    id: 'pedido_atendimento_humano',
    name: 'Pedido de atendimento humano',
    summary: 'Quando um cliente pedir atendimento humano, criar um aviso interno e enviar notificação no aparelho.',
    automation: {
      name: 'Pedido de atendimento humano',
      description: 'Garante que nenhum pedido de humano passe despercebido.',
      trigger_type: 'handoff_requested',
      trigger_config: {},
      conditions: [],
      actions: [
        { type: 'create_internal_notification', title: 'Cliente aguardando atendimento', message: 'Uma conversa precisa da sua equipe agora.' },
        { type: 'send_push_notification', title: 'Cliente aguardando atendimento', body: 'Uma conversa precisa da sua equipe.' },
      ],
      cooldown_seconds: 0,
    },
  },
  {
    id: 'pagamento_aprovado',
    name: 'Pagamento aprovado',
    summary: 'Quando um pagamento for aprovado, marcar o cliente com a tag "cliente" e disparar seu webhook.',
    automation: {
      name: 'Pagamento aprovado',
      description: 'Organiza clientes pagantes e integra com suas ferramentas.',
      trigger_type: 'sale_paid',
      trigger_config: {},
      conditions: [],
      actions: [
        { type: 'add_tag', tag: 'cliente' },
        { type: 'dispatch_existing_webhook' },
      ],
      cooldown_seconds: 0,
    },
  },
  {
    id: 'produto_voltou_estoque',
    name: 'Produto voltou ao estoque',
    summary: 'Quando você avisar reposição de um produto, registrar um aviso interno (a lista de espera já recebe a mensagem pelo fluxo existente).',
    automation: {
      name: 'Produto voltou ao estoque',
      description: 'Acompanha as reposições avisadas à lista de espera.',
      trigger_type: 'product_restocked',
      trigger_config: {},
      conditions: [],
      actions: [
        { type: 'create_internal_notification', title: 'Reposição avisada', message: 'A lista de espera de um produto reposto acabou de ser avisada.' },
      ],
      cooldown_seconds: 3600,
    },
  },
];
