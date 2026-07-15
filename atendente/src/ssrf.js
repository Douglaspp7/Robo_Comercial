/**
 * Proteção contra SSRF (Server-Side Request Forgery).
 *
 * Antes de fazer fetch de qualquer URL fornecida pelo usuário (import de site,
 * proxy de catálogo), validamos que o destino não aponta para a rede interna,
 * loopback, link-local ou o endpoint de metadados da nuvem (169.254.169.254).
 *
 * Resolve o hostname via DNS e recusa se QUALQUER endereço resolvido cair numa
 * faixa privada/reservada — fecha o vetor direto e o de DNS apontando p/ interno.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';

/** Faixas IPv4 privadas/reservadas (CIDR → [rede, bits]). */
function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

const IPV4_BLOCKED = [
  ['0.0.0.0', 8],       // "this" network
  ['10.0.0.0', 8],      // privada
  ['100.64.0.0', 10],   // CGNAT
  ['127.0.0.0', 8],     // loopback
  ['169.254.0.0', 16],  // link-local (inclui 169.254.169.254 — metadados de nuvem)
  ['172.16.0.0', 12],   // privada
  ['192.0.0.0', 24],    // IETF
  ['192.168.0.0', 16],  // privada
  ['198.18.0.0', 15],   // benchmarking
  ['224.0.0.0', 4],     // multicast
  ['240.0.0.0', 4],     // reservada
];

function isBlockedIPv4(ip) {
  const addr = ipv4ToInt(ip);
  return IPV4_BLOCKED.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (addr & mask) === (ipv4ToInt(net) & mask);
  });
}

function isBlockedIPv6(ip) {
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return true;          // loopback / unspecified
  if (low.startsWith('fe80')) return true;                 // link-local
  if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique local fc00::/7
  // IPv4-mapped em forma pontilhada (::ffff:a.b.c.d).
  const dotted = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return isBlockedIPv4(dotted[1]);
  // IPv4-mapped em forma hexadecimal (::ffff:7f00:1) — Node normaliza assim.
  const hex = low.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const octets = [
      (parseInt(hex[1], 16) >> 8) & 0xff,
      parseInt(hex[1], 16) & 0xff,
      (parseInt(hex[2], 16) >> 8) & 0xff,
      parseInt(hex[2], 16) & 0xff,
    ].join('.');
    return isBlockedIPv4(octets);
  }
  return false;
}

function isBlockedIp(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) return isBlockedIPv4(ip);
  if (fam === 6) return isBlockedIPv6(ip);
  return true; // não reconhecido → bloqueia por segurança
}

/**
 * Lança Error se a URL for inválida ou apontar para destino interno/reservado.
 * Retorna a URL parseada quando segura.
 * @param {string} urlString
 * @returns {Promise<URL>}
 */
export async function assertPublicUrl(urlString) {
  let url;
  try { url = new URL(urlString); } catch { throw new Error('URL inválida.'); }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Somente URLs http/https são permitidas.');
  }

  const host = url.hostname.replace(/^\[|\]$/g, ''); // remove colchetes de IPv6

  // Se já for um IP literal, valida direto.
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error('Destino não permitido (endereço interno).');
    return url;
  }

  // Hostname → resolve e valida TODOS os endereços.
  let addrs;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error('Não foi possível resolver o endereço.');
  }
  if (!addrs.length) throw new Error('Não foi possível resolver o endereço.');
  for (const { address } of addrs) {
    if (isBlockedIp(address)) throw new Error('Destino não permitido (endereço interno).');
  }
  return url;
}
