/**
 * Slugify — converte texto livre em slug seguro para URL e roteamento WhatsApp.
 * Função pura, sem dependências de banco de dados.
 *
 * Regras: somente [a-z0-9-], sem hífens duplicados, sem hífens nas extremidades,
 * máximo de 40 caracteres, fallback 'loja' se o resultado for vazio.
 */
export function slugify(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // remove acentos/diacríticos
    .replace(/[^a-z0-9]+/g, '-')       // não-alfanumérico → hífen
    .replace(/^-+|-+$/g, '')           // remove hífens das extremidades
    .replace(/-{2,}/g, '-')            // colapsa hífens consecutivos
    .slice(0, 40) || 'loja';
}
