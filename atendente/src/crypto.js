import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const VERSION = 'enc:v1';

function getKey() {
  const k = process.env.DATA_ENCRYPTION_KEY;
  if (!k) {
    if (process.env.NODE_ENV === 'production') throw new Error('DATA_ENCRYPTION_KEY is required in production');
    return Buffer.alloc(32); // dev only - not secure
  }
  const buf = Buffer.from(k, 'hex');
  if (buf.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes hex (64 hex chars)');
  return buf;
}

export function encryptSecret(plaintext) {
  if (!plaintext) return plaintext;
  // Already encrypted? Return as-is
  if (String(plaintext).startsWith('enc:v1:')) return plaintext;

  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(ciphertext) {
  if (!ciphertext) return ciphertext;
  if (!String(ciphertext).startsWith('enc:v1:')) return ciphertext; // legacy plaintext

  const parts = String(ciphertext).split(':');
  if (parts.length !== 5) throw new Error('Invalid encrypted format');
  const [, , ivHex, tagHex, dataHex] = parts;

  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
