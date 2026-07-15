import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const CSRF_SECRET = process.env.CSRF_SECRET || process.env.SESSION_SECRET || 'dev-only-csrf-secret';

export function generateCsrfToken(sessionToken) {
  const nonce = randomBytes(16).toString('hex');
  const sig = createHmac('sha256', CSRF_SECRET)
    .update(`${sessionToken}:${nonce}`)
    .digest('hex');
  return `${nonce}.${sig}`;
}

export function verifyCsrfToken(sessionToken, token) {
  if (!token || !sessionToken) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [nonce, sig] = parts;
  if (!nonce || !sig) return false;
  const expected = createHmac('sha256', CSRF_SECRET)
    .update(`${sessionToken}:${nonce}`)
    .digest('hex');
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export function requireCsrf(req, res, next) {
  const token = req.headers['x-csrf-token'];
  if (!verifyCsrfToken(req.sessionToken, token)) {
    return res.status(403).json({ error: 'Token CSRF inválido.' });
  }
  next();
}
