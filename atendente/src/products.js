/**
 * product_id permanente para produtos em business_json.produtos.
 *
 * Historicamente, produto era identificado por nome. Trocar o nome quebrava
 * a sincronização com Bling/Nuvemshop, a lista de espera de reposição, o
 * histórico de vendas e recompras. product_id resolve isso:
 *
 *  - único e imutável (não muda com edição de nome, preço, descrição);
 *  - não deriva do nome (usar hash de nome levaria à mesma quebra);
 *  - prefixo padronizado "prod_" pra ficar reconhecível em logs;
 *  - não aparece como campo editável ao lojista.
 *
 * `ensureProductIds(produtos)` gera IDs apenas para quem ainda não tem, sem
 * alterar ordem, nome ou preço. Chamado sempre que um novo produto é criado
 * ou catálogo é importado — e por uma migração idempotente no boot que
 * percorre todos os tenants existentes.
 *
 * Escolha explícita: `normalizeBusiness` NÃO gera product_id. Só a migração
 * e as rotas de escrita persistem, evitando gerar IDs novos a cada leitura.
 */
import { randomUUID } from 'node:crypto';

/** Gera um novo product_id (prefixo padronizado). */
export function newProductId() {
  return 'prod_' + randomUUID().replace(/-/g, '');
}

/**
 * Adiciona product_id em cada produto que ainda não tem. Retorna
 * `{ produtos, changed }` — `changed=true` só quando algum ID foi criado
 * (evita reescrever business_json à toa).
 * @param {Array<object>} produtos
 * @returns {{produtos: Array<object>, changed: boolean}}
 */
export function ensureProductIds(produtos) {
  if (!Array.isArray(produtos)) return { produtos: [], changed: false };
  let changed = false;
  const out = produtos.map((p) => {
    if (!p || typeof p !== 'object') return p;
    if (p.product_id && typeof p.product_id === 'string' && p.product_id.startsWith('prod_')) {
      return p;
    }
    changed = true;
    return { product_id: newProductId(), ...p };
  });
  return { produtos: out, changed };
}

/**
 * Busca por product_id (identidade forte). Retorna undefined se não achar.
 */
export function findProductById(produtos, productId) {
  if (!productId || !Array.isArray(produtos)) return undefined;
  return produtos.find((p) => p && p.product_id === productId);
}

/**
 * Busca por nome (fallback para dados históricos). Case-insensitive, trim.
 */
export function findProductByName(produtos, nome) {
  if (!nome || !Array.isArray(produtos)) return undefined;
  const key = String(nome).trim().toLowerCase();
  return produtos.find((p) => p && String(p.nome || '').trim().toLowerCase() === key);
}

/**
 * Reconciliação genérica: aceita product_id OU nome (compat com dados antigos).
 * Prefere product_id quando ambos são fornecidos.
 */
export function findProduct(produtos, { product_id, nome } = {}) {
  return findProductById(produtos, product_id) || findProductByName(produtos, nome);
}

/**
 * Backfill de mapeamentos externos (Bling, Nuvemshop): dado um mapa que só
 * tem `produto_nome`, tenta descobrir o `product_id` correspondente por SKU
 * (inequívoco) ou nome exato (fallback). Retorna undefined em ambiguidade.
 *
 * @param {Array<object>} produtos business_json.produtos
 * @param {{produto_nome?:string, external_sku?:string}} mapping
 */
export function backfillProductIdForMapping(produtos, mapping) {
  if (!mapping) return undefined;
  const sku = String(mapping.external_sku || mapping.bling_sku || mapping.nuvemshop_sku || '').trim();
  if (sku) {
    const matches = produtos.filter((p) => p && String(p.sku || '').trim() === sku);
    if (matches.length === 1) return matches[0].product_id;
  }
  const nome = String(mapping.produto_nome || '').trim();
  if (nome) {
    const byName = findProductByName(produtos, nome);
    if (byName?.product_id) return byName.product_id;
  }
  return undefined;
}
