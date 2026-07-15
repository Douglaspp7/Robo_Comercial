import { randomBytes, randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { tenantQueries, sessionQueries, passwordResetTokenQueries, emailVerificationTokenQueries, decryptTenant, generateUniqueRouteCode, allocateEntryRoute, generateUniqueAttendanceCode, userQueries } from './db.js';
import { encryptSecret } from './crypto.js';

export function isAdminTenant(tenant) {
  if (!tenant) return false;
  if (tenant.is_admin) return true;
  return Boolean(config.adminEmail && tenant.email === config.adminEmail);
}

export const COOKIE_NAME = 'gw_session';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function comparePassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function createTenant(email, password) {
  const id = randomUUID();
  const normalized = email.toLowerCase().trim();
  const trialEnds = new Date(Date.now() + config.stripe.trialDays * 86400000).toISOString();
  tenantQueries.create.run({
    id,
    email: normalized,
    password_hash: hashPassword(password),
    is_admin: config.adminEmail && normalized === config.adminEmail ? 1 : 0,
    subscription_status: 'trialing',
    trial_ends_at: trialEnds,
    // Só é chamado a partir do /api/signup, onde signupSchema já exige
    // accept_terms === true — o carimbo aqui é a prova do aceite (LGPD Art. 8º).
    terms_accepted_at: new Date().toISOString(),
  });
  tenantQueries.setRouteCode.run(generateUniqueRouteCode(), id);
  // Entry route — atribuído uma única vez; não muda mesmo que o nome comercial mude depois.
  const { handle, code } = allocateEntryRoute('Meu Negócio');
  tenantQueries.setEntryRoute.run(handle, code, id);
  // Attendance code (TX579) — permanente, único, não reutilizável.
  tenantQueries.setAttendanceCode.run(generateUniqueAttendanceCode(), id);
  return tenantQueries.byId.get(id);
}

export function login(email, password) {
  const normalizedEmail = email.toLowerCase().trim();
  const tenant = tenantQueries.byEmail.get(normalizedEmail);
  if (tenant && bcrypt.compareSync(password, tenant.password_hash)) {
    const token = randomBytes(32).toString('hex');
    sessionQueries.create.run(token, tenant.id, null);
    return token;
  }

  const user = userQueries.byEmail.get(normalizedEmail);
  if (user && user.active === 1 && bcrypt.compareSync(password, user.password_hash)) {
    const token = randomBytes(32).toString('hex');
    sessionQueries.create.run(token, user.tenant_id, user.id);
    return token;
  }

  return null;
}

export function logout(token) {
  if (token) sessionQueries.delete.run(token);
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 dias
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

/** Middleware: exige login. Anexa req.tenant e req.impersonatedBy (se admin impersonando). */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const session = token ? sessionQueries.byToken.get(token) : null;
  if (!session) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado' });
    return res.redirect('/login.html');
  }
  // Touch the session (update last_seen_at)
  sessionQueries.touch.run(token);
  req.tenant = decryptTenant(tenantQueries.byId.get(session.tenant_id));
  req.sessionToken = token;
  req.impersonatedBy = session.impersonated_by || null;
  req.adminToken = session.admin_token || null;
  req.user = session.user_id ? userQueries.byId.get(session.user_id) : null;
  next();
}

/** Middleware: exige papéis específicos. Usar depois de requireAuth. */
export function requireRole(roles = []) {
  return (req, res, next) => {
    if (!req.tenant) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    // O Dono (req.user === null) tem acesso irrestrito
    if (req.user === null) {
      return next();
    }
    if (req.user.active !== 1) {
      return res.status(403).json({ error: 'Usuário desativado' });
    }
    if (roles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({ error: 'Acesso negado: permissões insuficientes' });
  };
}

/**
 * Resolve o tenant a partir do cookie de sessão SEM redirecionar/401 —
 * usado por endpoints públicos que também aceitam sessão (ex.: mídia servida ao
 * WhatsApp por URL assinada, mas exibida no painel com cookie). Retorna o tenant
 * ou null.
 */
export function optionalTenant(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  const session = sessionQueries.byToken.get(token);
  if (!session) return null;
  return decryptTenant(tenantQueries.byId.get(session.tenant_id));
}

/** Middleware: exige administrador. Usar depois de requireAuth. */
export function requireAdmin(req, res, next) {
  if (!isAdminTenant(req.tenant)) {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Acesso restrito' });
    return res.redirect('/dashboard.html');
  }
  next();
}

// --- Verificação de e-mail ---
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

function hashEmailVerificationToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function createEmailVerificationToken(tenantId) {
  emailVerificationTokenQueries.deleteForTenant.run(tenantId);
  const rawToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MS)
    .toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  emailVerificationTokenQueries.create.run(hashEmailVerificationToken(rawToken), tenantId, expiresAt);
  return rawToken;
}

export function consumeEmailVerificationToken(rawToken) {
  const hash = hashEmailVerificationToken(String(rawToken || ''));
  const row = emailVerificationTokenQueries.byHash.get(hash);
  if (!row || row.used_at) return null;
  const expiresAt = parseStoredDate(row.expires_at);
  if (!expiresAt || expiresAt <= Date.now()) return null;
  tenantQueries.markEmailVerified.run(row.tenant_id);
  emailVerificationTokenQueries.markUsed.run(hash);
  return tenantQueries.byId.get(row.tenant_id);
}

// --- Recuperação de senha ---
// Fluxo: usuário pede reset por e-mail → geramos token cru (64 hex) e
// enviamos por link; guardamos só o HASH sha256, então quem vê o banco
// não consegue completar o reset. Validade curta (1h) e uso único.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashResetToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Cria um token de reset para o e-mail (se existir tenant). Retorna { rawToken,
 * tenant } quando o e-mail existe, ou null quando não existe — o caller
 * NUNCA revela ao cliente qual foi o caso (sempre responde "e-mail enviado
 * se existir"), para não virar oráculo de contas.
 */
export function createPasswordResetToken(email) {
  const normalized = String(email || '').toLowerCase().trim();
  const tenant = tenantQueries.byEmail.get(normalized);
  if (!tenant) return null;

  passwordResetTokenQueries.deleteForTenant.run(tenant.id);
  const rawToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
  passwordResetTokenQueries.create.run(hashResetToken(rawToken), tenant.id, expiresAt);
  return { rawToken, tenant };
}

function parseStoredDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

/**
 * Consome um token de reset: troca a senha, marca o token como usado e
 * revoga todas as sessões existentes do tenant (força re-login em outros
 * dispositivos). Retorna true em sucesso, false em token inválido/expirado.
 */
export function consumePasswordResetToken(rawToken, newPassword) {
  const hash = hashResetToken(String(rawToken || ''));
  const row = passwordResetTokenQueries.byHash.get(hash);
  if (!row) return false;
  if (row.used_at) return false;
  const expiresAt = parseStoredDate(row.expires_at);
  if (!expiresAt || expiresAt <= Date.now()) return false;

  tenantQueries.setPasswordHash.run(hashPassword(newPassword), row.tenant_id);
  passwordResetTokenQueries.markUsed.run(hash);
  sessionQueries.deleteAllForTenantExcept.run(row.tenant_id, '');
  return true;
}

export { encryptSecret };

// --- Google OAuth Login ---

export function googleLoginEnabled() {
  return Boolean(config.google?.clientId && config.google?.clientSecret);
}

function googleLoginRedirectUri() {
  return process.env.GOOGLE_LOGIN_REDIRECT_URI ||
    `${config.appUrl.replace(/\/$/, '')}/api/auth/google/callback`;
}

export function googleLoginUrl(state) {
  if (!googleLoginEnabled()) throw new Error('Google login não configurado.');
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: googleLoginRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: googleLoginRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  return res.json();
}

export async function getGoogleUserInfo(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`);
  return res.json();
}

export function loginOrCreateWithGoogle(googleId, email, displayName) {
  const normalizedEmail = email.toLowerCase().trim();

  // 1. Google ID já está vinculado → login direto
  let tenant = tenantQueries.byGoogleId.get(googleId);
  if (tenant) {
    tenantQueries.markEmailVerified.run(tenant.id);
    const token = randomBytes(32).toString('hex');
    sessionQueries.create.run(token, tenant.id, null);
    return token;
  }

  // 2. E-mail já existe → vincula Google ID e faz login
  tenant = tenantQueries.byEmail.get(normalizedEmail);
  if (tenant) {
    tenantQueries.setGoogleId.run(googleId, tenant.id);
    tenantQueries.markEmailVerified.run(tenant.id);
    const token = randomBytes(32).toString('hex');
    sessionQueries.create.run(token, tenant.id, null);
    return token;
  }

  // 3. Conta nova → cria tenant com hash inutilizável + vincula Google ID
  const id = randomUUID();
  const trialEnds = new Date(Date.now() + config.stripe.trialDays * 86400000).toISOString();
  tenantQueries.create.run({
    id,
    email: normalizedEmail,
    // Hash de senha aleatória impossível de descobrir — conta só usa Google
    password_hash: hashPassword(randomBytes(32).toString('hex')),
    is_admin: config.adminEmail && normalizedEmail === config.adminEmail ? 1 : 0,
    subscription_status: 'trialing',
    trial_ends_at: trialEnds,
    terms_accepted_at: new Date().toISOString(),
  });
  tenantQueries.setGoogleId.run(googleId, id);
  tenantQueries.markEmailVerified.run(id);
  tenantQueries.setRouteCode.run(generateUniqueRouteCode(), id);
  const { handle, code: routeCode } = allocateEntryRoute(displayName || 'Meu Negócio');
  tenantQueries.setEntryRoute.run(handle, routeCode, id);
  tenantQueries.setAttendanceCode.run(generateUniqueAttendanceCode(), id);
  const token = randomBytes(32).toString('hex');
  sessionQueries.create.run(token, id, null);
  return token;
}
