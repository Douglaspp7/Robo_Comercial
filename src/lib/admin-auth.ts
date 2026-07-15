const COOKIE_NAME = "robo_admin_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export const adminSessionCookie = COOKIE_NAME;

export function adminAuthDisabled() {
  return process.env.PANEL_AUTH_DISABLED === "1";
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(a: string, b: string) {
  const max = Math.max(a.length, b.length);
  let different = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    different |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return different === 0;
}

export function adminAuthConfigured() {
  return Boolean(
    process.env.PANEL_ADMIN_EMAIL &&
      process.env.PANEL_ADMIN_PASSWORD &&
      process.env.PANEL_SESSION_SECRET &&
      process.env.PANEL_SESSION_SECRET.length >= 32
  );
}

export function validAdminCredentials(email: string, password: string) {
  const expectedEmail = process.env.PANEL_ADMIN_EMAIL || "";
  const expectedPassword = process.env.PANEL_ADMIN_PASSWORD || "";
  return (
    adminAuthConfigured() &&
    constantTimeEqual(email.trim().toLowerCase(), expectedEmail.trim().toLowerCase()) &&
    constantTimeEqual(password, expectedPassword)
  );
}

export async function createAdminSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
  const payload = `${expiresAt}.${nonce}`;
  const signature = await hmac(payload, process.env.PANEL_SESSION_SECRET || "");
  return { token: `${payload}.${signature}`, maxAge: SESSION_TTL_SECONDS };
}

export async function verifyAdminSession(token?: string | null) {
  if (!token || !adminAuthConfigured()) return false;
  const [expiresRaw, nonce, signature, ...extra] = token.split(".");
  if (!expiresRaw || !nonce || !signature || extra.length) return false;
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(`${expiresRaw}.${nonce}`, process.env.PANEL_SESSION_SECRET || "");
  return constantTimeEqual(signature, expected);
}
