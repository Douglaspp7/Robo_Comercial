import { normalizeBusiness } from '../business.js';
import { ZAPIEN_BUSINESS, ZAPIEN_SALES_SEED_VERSION } from './zapien-business.js';

function mergeBy(items, defaults, key) {
  const merged = new Map();
  for (const item of [...defaults, ...items]) {
    const id = typeof item === 'string' ? item.trim() : String(item?.[key] || '').trim();
    if (id && !merged.has(id.toLocaleLowerCase('pt-BR'))) {
      merged.set(id.toLocaleLowerCase('pt-BR'), item);
    }
  }
  return [...merged.values()];
}

function isLegacyDescription(value) {
  const text = String(value || '');
  return !text || text.startsWith('Zapien — atendente de vendas com IA');
}

/**
 * Atualiza apenas o conteúdo comercial do seed. Integrações, catálogo extra e
 * campos editados pelo administrador são preservados; novos itens oficiais são
 * adicionados de modo idempotente.
 */
export function mergeZapienSalesSeed(current) {
  const existing = normalizeBusiness(current);
  const defaults = normalizeBusiness(ZAPIEN_BUSINESS);

  return normalizeBusiness({
    ...existing,
    descricao: isLegacyDescription(existing.descricao) ? defaults.descricao : existing.descricao,
    tomDeVoz: isLegacyDescription(existing.descricao) ? defaults.tomDeVoz : existing.tomDeVoz,
    horario_atendimento: existing.horario_atendimento || defaults.horario_atendimento,
    followup: defaults.followup,
    produtos: mergeBy(existing.produtos, defaults.produtos, 'nome'),
    perguntasFrequentes: mergeBy(existing.perguntasFrequentes, defaults.perguntasFrequentes, 'pergunta'),
    objecoesComuns: mergeBy(existing.objecoesComuns, defaults.objecoesComuns, 'objecao'),
    regras: mergeBy(existing.regras, defaults.regras),
    respostas_rapidas: mergeBy(existing.respostas_rapidas, defaults.respostas_rapidas),
    seed_meta: { id: 'zapien-sales', version: ZAPIEN_SALES_SEED_VERSION },
  });
}
