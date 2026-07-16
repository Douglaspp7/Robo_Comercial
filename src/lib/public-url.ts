import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function blocked(address: string) {
  const low = address.toLowerCase();
  if (low === "::" || low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80")) return true;
  const mapped = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped || (isIP(address) === 4 ? address : "");
  if (!ipv4) return isIP(address) !== 6;
  const [a, b] = ipv4.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19));
}

export async function assertPublicHttpUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("URL não permitida");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => blocked(address))) throw new Error("Destino interno não permitido");
  return url;
}
