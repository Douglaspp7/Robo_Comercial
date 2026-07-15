/**
 * Assinatura de URLs de mídia/catálogo servidas ao WhatsApp.
 *
 * O WhatsApp busca as URLs de mídia sem cookie de sessão. Antes, o acesso
 * dependia só do ID aleatório na URL (segurança por obscuridade). Agora geramos
 * URLs assinadas com expiração (HMAC + exp); o painel continua acessando via
 * cookie de sessão (verificação de posse por tenant no endpoint).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

const SECRET = process.env.MEDIA_URL_SECRET || config.sessionSecret;

function sign(value, exp) {
  return createHmac('sha256', SECRET).update(`${value}:${exp}`).digest('hex');
}

/**
 * Gera querystring assinada (`exp` + `sig`) para um valor (ex.: id da mídia).
 * @param {string} value  valor protegido (media id, tenant id...)
 * @param {number} ttlSec TTL em segundos (padrão 1h — suficiente p/ o WhatsApp buscar)
 * @returns {string} querystring iniciando com "?"
 */
export function signedQuery(value, ttlSec = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `?exp=${exp}&sig=${sign(value, exp)}`;
}

/**
 * Verifica assinatura de uma requisição para um valor.
 * @param {import('express').Request} req
 * @param {string} value valor esperado (media id, tenant id...)
 * @returns {boolean}
 */
export function verifySignedQuery(req, value) {
  const exp = Number(req.query?.exp);
  const sig = String(req.query?.sig || '');
  if (!Number.isFinite(exp) || !sig) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false; // expirada
  const expected = sign(value, exp);
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
