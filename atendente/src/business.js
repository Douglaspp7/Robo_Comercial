/**
 * Normalização do business_json — fonte única de verdade.
 *
 * Historicamente o painel (settings.js) gravava chaves diferentes das que a IA
 * (ai.js) e o webhook liam. Resultado: tom de voz, FAQ, objeções, dias de
 * atendimento e mensagem fora de horário configurados pelo lojista eram
 * silenciosamente ignorados.
 *
 * Este módulo converte QUALQUER formato (legado do painel ou canônico dos seeds)
 * para um único formato canônico, consumido por ai.js e webhook.js. É puro e sem
 * dependências para ser facilmente testável.
 *
 * Chaves canônicas:
 *   descricao, tomDeVoz, frete, checkout_url, notify_phone, peso_padrao_kg,
 *   catalog_pdf_url, name, produtos, perguntasFrequentes, objecoesComuns,
 *   regras, respostas_rapidas,
 *   horario_atendimento: { ativo, inicio, fim, dias:number[], mensagem_fora },
 *   followup: { ativo, horas, mensagem },
 *   resumoDiario: { ativo, hora:number(0-23) } — produtos podem ter um campo
 *   "esgotado" (boolean) usado pela lista de espera de reposição.
 */

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

/** Converte dias em array de números (aceita array, "1,2,3" ou number). */
function normalizeDias(raw) {
  if (Array.isArray(raw)) {
    return raw.map((d) => Number(d)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  }
  if (typeof raw === 'number') return [raw];
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',').map((d) => Number(d.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  }
  return [1, 2, 3, 4, 5]; // padrão seg-sex
}

function normalizeHorario(h) {
  if (!h || typeof h !== 'object') return undefined;
  return {
    ativo: Boolean(h.ativo),
    inicio: h.inicio || '08:00',
    fim: h.fim || '18:00',
    dias: normalizeDias(h.dias),
    // Aceita tanto `mensagem_fora` (canônico/webhook) quanto `msg_fora` (painel legado).
    mensagem_fora: h.mensagem_fora ?? h.msg_fora ?? '',
  };
}

function normalizeFollowup(f) {
  if (!f || typeof f !== 'object') return undefined;
  return {
    ativo: Boolean(f.ativo),
    horas: Number(f.horas) || 24,
    mensagem: f.mensagem || '',
  };
}

function normalizeResumoDiario(r) {
  if (!r || typeof r !== 'object') return undefined;
  const hora = Number(r.hora);
  return {
    ativo: Boolean(r.ativo),
    hora: Number.isInteger(hora) && hora >= 0 && hora <= 23 ? hora : 20,
  };
}

function normalizeDelivery(d) {
  if (!d || typeof d !== 'object') return undefined;
  return {
    ativo: Boolean(d.ativo),
    // taxa_fixa: valor em reais para cobrar em todo pedido delivery (0 = grátis)
    taxa_fixa: Number(d.taxa_fixa) || 0,
    // raio_km: raio máximo de entrega em km (0 = sem limite)
    raio_km: Number(d.raio_km) || 0,
    // eta_minutos: tempo estimado de entrega em minutos
    eta_minutos: Number(d.eta_minutos) || 45,
    // aceita_retirada: cliente pode retirar no local
    aceita_retirada: d.aceita_retirada !== false,
    // aceita_mesa: estabelecimento tem atendimento por mesa
    aceita_mesa: Boolean(d.aceita_mesa),
  };
}

/**
 * Normaliza um objeto de negócio (ou JSON string) para o formato canônico.
 * Nunca lança — entrada inválida vira objeto vazio normalizado.
 * @param {object|string} raw
 * @returns {object} business canônico
 */
export function normalizeBusiness(raw) {
  let b = raw;
  if (typeof raw === 'string') {
    try { b = JSON.parse(raw || '{}'); } catch { b = {}; }
  }
  if (!b || typeof b !== 'object') b = {};

  const out = {
    name: b.name ?? '',
    atendente_name: b.atendente_name ?? '',
    descricao: b.descricao ?? '',
    // tom de voz: canônico `tomDeVoz`, legado do painel `tom_de_voz`.
    tomDeVoz: b.tomDeVoz ?? b.tom_de_voz ?? '',
    frete: b.frete ?? '',
    checkout_url: b.checkout_url ?? '',
    notify_phone: b.notify_phone ?? '',
    peso_padrao_kg: b.peso_padrao_kg ?? undefined,
    catalog_pdf_url: b.catalog_pdf_url ?? '',
    produtos: asArray(b.produtos),
    // FAQ: canônico `perguntasFrequentes`, legado do painel `faqs`.
    perguntasFrequentes: asArray(b.perguntasFrequentes ?? b.faqs),
    // Objeções: canônico `objecoesComuns`, legado do painel `objecoes`.
    objecoesComuns: asArray(b.objecoesComuns ?? b.objecoes),
    regras: asArray(b.regras),
    respostas_rapidas: asArray(b.respostas_rapidas),
    // Metadados internos permitem atualizar seeds sem confundir conteúdo
    // comercial com dados operacionais ou personalizações do tenant.
    seed_meta: b.seed_meta && typeof b.seed_meta === 'object'
      ? { id: String(b.seed_meta.id || ''), version: Number(b.seed_meta.version) || 0 }
      : undefined,
    // Templates de mensagem do WhatsApp Business API já aprovados no Meta
    // Business Manager (cadastro manual — ver src/api.js /api/whatsapp-templates).
    // Usados para campanhas segmentadas, que exigem template aprovado para
    // iniciar conversa fora da janela de atendimento de 24h.
    whatsappTemplates: asArray(b.whatsappTemplates),
  };

  const horario = normalizeHorario(b.horario_atendimento);
  if (horario) out.horario_atendimento = horario;

  const followup = normalizeFollowup(b.followup);
  if (followup) out.followup = followup;

  const resumoDiario = normalizeResumoDiario(b.resumoDiario);
  if (resumoDiario) out.resumoDiario = resumoDiario;

  const delivery = normalizeDelivery(b.delivery);
  if (delivery) out.delivery = delivery;

  const TIPOS_NEGOCIO = ['produtos', 'restaurante', 'pizzaria', 'lanchonete', 'servicos'];
  out.tipo_negocio = TIPOS_NEGOCIO.includes(b.tipo_negocio) ? b.tipo_negocio : 'produtos';

  // Solicitar CPF/CNPJ antes do checkout — desligado por padrão.
  // Útil para e-commerce/revenda que emite NF; desnecessário para pizzaria/restaurante.
  out.pedir_identificacao = Boolean(b.pedir_identificacao);

  // Melhor Envio: se ligado, quando a etiqueta é gerada com sucesso o Zapien
  // manda automaticamente uma mensagem pro cliente pelo WhatsApp com o código
  // de rastreio. Desligado por padrão — o lojista opta em Integrações.
  out.me_auto_send_tracking = Boolean(b.me_auto_send_tracking);

  return out;
}
