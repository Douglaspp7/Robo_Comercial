import rateLimit from 'express-rate-limit';

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Limite de cadastros atingido.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Reset de senha: mais generoso que login (é normal o usuário confundir o
// e-mail e tentar de novo), mas ainda apertado o suficiente para não virar
// canal de enumeração/spam de e-mail. Também é chaveado por IP; o endpoint
// nunca revela se o e-mail existe, então uso indevido não vira oráculo.
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: 'Muitas solicitações. Tente novamente mais tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Sandbox and import routes require authentication, so keying by tenant ID is safe.
// Never falls back to req.ip to avoid ERR_ERL_KEY_GEN_IPV6 validation warnings.
export const sandboxLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.tenant?.id || 'anon',
  standardHeaders: true,
  legacyHeaders: false,
});

export const importLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.tenant?.id || 'anon',
  standardHeaders: true,
  legacyHeaders: false,
});

// Verificação manual da conexão Meta ("Verificar conexão agora"): cada clique
// chama a Graph API — apertado por tenant para não virar proxy de flood.
export const metaHealthLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 6,
  keyGenerator: (req) => req.tenant?.id || 'anon',
  message: { error: 'Muitas verificações seguidas. Aguarde alguns minutos e tente de novo.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Eventos de conversão (beacon público da landing). Generoso o suficiente
// para navegação real, apertado contra flood — e o endpoint só grava nomes
// de um allowlist, nunca dados pessoais.
export const eventsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
