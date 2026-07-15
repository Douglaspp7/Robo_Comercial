import { contactTagQueries } from './db.js';

// Tags derivadas automaticamente da etapa do funil — mutuamente exclusivas
// entre si (aplicar uma remove as outras deste grupo). Etapas sem tag mapeada
// (novo_contato, duvida, negociacao) não alteram esse grupo.
const STAGE_TAGS = {
  orcamento: 'orçamento enviado',
  checkout: 'aguardando pagamento',
  fechado: 'pós-venda',
  perdido: 'venda perdida',
};
const STAGE_TAG_GROUP = Object.values(STAGE_TAGS);

/**
 * Aplica a tag de etapa correspondente e remove as demais do mesmo grupo.
 * Etapas sem tag mapeada (novo_contato, duvida, negociacao) não mexem no grupo —
 * senão passar por elas apagaria uma tag de etapa anterior ainda válida (ex:
 * "orçamento enviado" continua verdade mesmo depois que a conversa avança).
 */
export function applyStageTag(tenantId, contactId, stage) {
  const tag = STAGE_TAGS[stage];
  if (!tag) return;
  for (const t of STAGE_TAG_GROUP) {
    if (t !== tag) contactTagQueries.remove.run(contactId, t);
  }
  contactTagQueries.add.run(tenantId, contactId, tag);
}

/** Tag "alta intenção" — presente só enquanto a IA classificar o contato como tal. */
export function applyBuyIntentTag(tenantId, contactId, buyIntent) {
  if (buyIntent === 'alta') contactTagQueries.add.run(tenantId, contactId, 'alta intenção');
  else contactTagQueries.remove.run(contactId, 'alta intenção');
}

/** Tag "reclamação" quando o motivo do transbordo humano é uma reclamação. */
export function applyHandoffReasonTag(tenantId, contactId, reason) {
  if (reason === 'reclamacao') contactTagQueries.add.run(tenantId, contactId, 'reclamação');
}

/** Tags "pessoa física" / "empresa", mutuamente exclusivas, a partir do tipo de cliente salvo. */
export function applyTipoClienteTag(tenantId, contactId, tipo) {
  if (tipo === 'pf') {
    contactTagQueries.add.run(tenantId, contactId, 'pessoa física');
    contactTagQueries.remove.run(contactId, 'empresa');
  } else if (tipo === 'pj') {
    contactTagQueries.add.run(tenantId, contactId, 'empresa');
    contactTagQueries.remove.run(contactId, 'pessoa física');
  }
}
