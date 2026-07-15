import { createHmac } from 'node:crypto';
import { fetchWithTimeout } from './http.js';

export function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Hash determinístico (HMAC-SHA256) dos dígitos do documento — usado só para
 * detectar duplicidade (comparar hashes) sem precisar decifrar todos os
 * documentos cifrados do tenant. Nunca reversível para o documento original.
 */
export function hashDocument(value) {
  const digits = onlyDigits(value);
  if (!digits) return null;
  const key = process.env.DATA_ENCRYPTION_KEY || 'dev-only-insecure-key';
  return createHmac('sha256', key).update(digits).digest('hex');
}

export function detectType(value) {
  const s = onlyDigits(value);
  if (s.length === 11) return 'cpf';
  if (s.length === 14) return 'cnpj';
  return null;
}

export function isValidCPF(value) {
  const s = onlyDigits(value);
  if (s.length !== 11 || /^(\d)\1{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(s[i], 10) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(s[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(s[i], 10) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(s[10], 10);
}

export function isValidCNPJ(value) {
  const s = onlyDigits(value);
  if (s.length !== 14 || /^(\d)\1{13}$/.test(s)) return false;
  const calcDigit = (base) => {
    const weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += parseInt(base[i], 10) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (calcDigit(s.slice(0, 12)) !== parseInt(s[12], 10)) return false;
  return calcDigit(s.slice(0, 13)) === parseInt(s[13], 10);
}

/** Valida e detecta o tipo (cpf|cnpj) de um documento. Retorna { valid, type }. */
export function validateDocument(value) {
  const type = detectType(value);
  if (type === 'cpf') return { valid: isValidCPF(value), type };
  if (type === 'cnpj') return { valid: isValidCNPJ(value), type };
  return { valid: false, type: null };
}

export function formatCPF(value) {
  const s = onlyDigits(value).padEnd(11, '0').slice(0, 11);
  return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9, 11)}`;
}

export function formatCNPJ(value) {
  const s = onlyDigits(value).padEnd(14, '0').slice(0, 14);
  return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12, 14)}`;
}

/** Formata com máscara completa (CPF ou CNPJ conforme o tamanho). Uso: modo de edição. */
export function formatDocument(value) {
  const type = detectType(value);
  if (type === 'cpf') return formatCPF(value);
  if (type === 'cnpj') return formatCNPJ(value);
  return value || '';
}

/**
 * Máscara para exibição em cards/listas — nunca mostra o documento completo.
 * CPF: ***.456.789-**  |  CNPJ: **.345.678/0001-**
 */
export function maskDocument(value) {
  const type = detectType(value);
  if (type === 'cpf') {
    const s = onlyDigits(value).padEnd(11, '0').slice(0, 11);
    return `***.${s.slice(3, 6)}.${s.slice(6, 9)}-**`;
  }
  if (type === 'cnpj') {
    const s = onlyDigits(value).padEnd(14, '0').slice(0, 14);
    return `**.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-**`;
  }
  return '';
}

/**
 * Consulta dados públicos de um CNPJ na BrasilAPI (sem autenticação, gratuita).
 * Nunca é chamada para CPF (dados pessoais não são consultados externamente).
 * Falha de rede/API não deve travar o fluxo do usuário — quem chama trata o erro.
 * @returns {Promise<{razao_social, nome_fantasia, situacao, cidade, uf, endereco}|null>}
 */
export async function lookupCnpj(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 14) return null;
  const res = await fetchWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Zapien/2.0 (douglaspp7@gmail.com)' },
  }, 10000);
  if (!res.ok) return null;
  const data = await res.json();
  const logradouro = [data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(' ');
  const endereco = [logradouro, data.numero].filter(Boolean).join(', ');
  return {
    razao_social: data.razao_social || '',
    nome_fantasia: data.nome_fantasia || '',
    situacao: data.descricao_situacao_cadastral || '',
    cidade: data.municipio || '',
    uf: data.uf || '',
    endereco,
  };
}
