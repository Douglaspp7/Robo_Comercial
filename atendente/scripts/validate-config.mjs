#!/usr/bin/env node
/**
 * Validação de configuração do Zapien.
 *
 * Modos:
 *   node scripts/validate-config.mjs               → validação ESTRUTURAL
 *     - roda em CI sem credenciais reais;
 *     - detecta marcadores de conflito Git nos arquivos do projeto;
 *     - valida o FORMATO das variáveis que estiverem definidas;
 *     - detecta combinações parciais de configuração.
 *
 *   node scripts/validate-config.mjs --production  → validação de PRODUÇÃO
 *     - tudo do modo estrutural, mais:
 *     - exige as variáveis obrigatórias;
 *     - recusa segredos placeholder conhecidos;
 *     - recusa RESET_EMAIL_SENDER=console.
 *
 * Nunca imprime o VALOR de variáveis sensíveis — somente o nome e o motivo.
 */
import 'dotenv/config';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const PRODUCTION_MODE =
  process.argv.includes('--production') || process.env.NODE_ENV === 'production';

const errors = [];
const warnings = [];

const env = (name) => (process.env[name] || '').trim();
const isSet = (name) => env(name) !== '';

// ------------------------------------------------------------------
// 1. Marcadores de conflito Git nos arquivos do projeto
// ------------------------------------------------------------------
const CONFLICT_RE = /^(<{7}(\s|$)|={7}$|>{7}(\s|$))/m;
const SCAN_DIRS = ['src', 'scripts', 'test', 'public', 'docs'];
const SCAN_ROOT_FILES = [
  '.env.example', 'package.json', 'render.yaml', 'README.md', 'CLAUDE.md', 'eslint.config.js',
];
const SCAN_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.yaml', '.yml', '.example', '.txt',
]);

function scanFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  if (CONFLICT_RE.test(text)) {
    errors.push(`Marcador de conflito Git encontrado em: ${path}`);
  }
}

function scanDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'vendor') continue;
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) scanDir(path);
    else if (SCAN_EXTS.has(extname(entry)) || entry === '.env.example') scanFile(path);
  }
}

for (const dir of SCAN_DIRS) scanDir(dir);
for (const file of SCAN_ROOT_FILES) scanFile(file);

// ------------------------------------------------------------------
// 2. Validações de formato (aplicadas a qualquer variável definida)
// ------------------------------------------------------------------
function checkUrl(name) {
  if (!isSet(name)) return;
  try {
    const url = new URL(env(name));
    if (!/^https?:$/.test(url.protocol)) {
      errors.push(`${name} deve ser uma URL http(s) válida.`);
    }
  } catch {
    errors.push(`${name} não é uma URL válida.`);
  }
}

function checkPositiveInt(name) {
  if (!isSet(name)) return;
  const value = env(name);
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    errors.push(`${name} deve ser um número inteiro positivo.`);
  }
}

function checkPhone(name) {
  if (!isSet(name)) return;
  if (!/^[1-9]\d{9,14}$/.test(env(name))) {
    errors.push(`${name} deve estar no formato E.164 sem "+" (ex: 5511999990000).`);
  }
}

checkUrl('APP_URL');
checkUrl('GOOGLE_OAUTH_REDIRECT_URI');

for (const name of [
  'PORT', 'AI_CONCURRENCY', 'DEBOUNCE_MS', 'TRIAL_DAYS', 'ALERT_COOLDOWN_MIN',
  'QUEUE_ALERT_THRESHOLD', 'AI_OFF_TOPIC_MUTE_MINUTES', 'BACKUP_RETAIN_DAYS',
  'META_HEALTH_INTERVAL_MS', 'META_HEALTH_CONCURRENCY', 'META_HEALTH_TIMEOUT_MS',
  'META_CRITICAL_PUSH_COOLDOWN_MIN',
  'AUTOMATION_CONCURRENCY', 'AUTOMATION_MAX_PER_TENANT', 'AUTOMATION_MAX_ATTEMPTS',
  'AUTOMATION_LOCK_TIMEOUT_MS', 'AUTOMATION_POLL_INTERVAL_MS', 'AUTOMATION_MAX_CHAIN_DEPTH',
]) {
  checkPositiveInt(name);
}

// Chaves VAPID (Web Push): formato base64url. Público ~87 chars, privado ~43.
for (const [name, minLen] of [['VAPID_PUBLIC_KEY', 80], ['VAPID_PRIVATE_KEY', 40]]) {
  if (isSet(name) && (!/^[A-Za-z0-9_-]+$/.test(env(name)) || env(name).length < minLen)) {
    errors.push(`${name} não parece uma chave VAPID válida (base64url). Gere com: npx web-push generate-vapid-keys`);
  }
}
if (isSet('VAPID_SUBJECT') && !/^(mailto:|https:)/.test(env('VAPID_SUBJECT'))) {
  errors.push('VAPID_SUBJECT deve começar com "mailto:" ou "https:".');
}

checkPhone('WA_SERVER_PHONE');
checkPhone('SUPPORT_PHONE');
checkPhone('ALERT_PHONE');

// DATA_ENCRYPTION_KEY: 32 bytes em hex (64 caracteres).
if (isSet('DATA_ENCRYPTION_KEY') && !/^[0-9a-fA-F]{64}$/.test(env('DATA_ENCRYPTION_KEY'))) {
  errors.push('DATA_ENCRYPTION_KEY deve ter 64 caracteres hexadecimais (32 bytes). ' +
    'Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

// SESSION_SECRET: mínimo de entropia razoável.
if (isSet('SESSION_SECRET') && env('SESSION_SECRET').length < 32) {
  errors.push('SESSION_SECRET deve ter pelo menos 32 caracteres.');
}

// TRIAL_DAYS deve refletir a promessa pública de 7 dias.
if (isSet('TRIAL_DAYS') && env('TRIAL_DAYS') !== '7') {
  warnings.push(`TRIAL_DAYS=${env('TRIAL_DAYS')} difere dos 7 dias prometidos na landing.`);
}

// ------------------------------------------------------------------
// 3. Combinações parciais de configuração
// ------------------------------------------------------------------
function requireTogether(present, missing, hint) {
  if (isSet(present) && missing.some((name) => !isSet(name))) {
    const absent = missing.filter((name) => !isSet(name)).join(', ');
    errors.push(`${present} está preenchida mas falta: ${absent}.${hint ? ' ' + hint : ''}`);
  }
}

requireTogether('STRIPE_SECRET_KEY', ['STRIPE_PRICE_ID'],
  'Sem STRIPE_PRICE_ID o billing Stripe não funciona.');
requireTogether('META_APP_ID', ['META_APP_SECRET', 'META_CONFIG_ID'],
  'O Embedded Signup da Meta exige os três valores.');
requireTogether('BLING_OAUTH_CLIENT_ID', ['BLING_OAUTH_CLIENT_SECRET']);
requireTogether('BLING_OAUTH_CLIENT_SECRET', ['BLING_OAUTH_CLIENT_ID']);
requireTogether('NUVEMSHOP_CLIENT_ID', ['NUVEMSHOP_CLIENT_SECRET']);
requireTogether('TRAY_CLIENT_ID', ['TRAY_CLIENT_SECRET']);
requireTogether('GOOGLE_CLIENT_ID', ['GOOGLE_CLIENT_SECRET']);
requireTogether('MP_OAUTH_APP_ID', ['MP_OAUTH_APP_SECRET']);
requireTogether('VAPID_PUBLIC_KEY', ['VAPID_PRIVATE_KEY'],
  'Web Push exige o par de chaves VAPID completo.');
requireTogether('VAPID_PRIVATE_KEY', ['VAPID_PUBLIC_KEY'],
  'Web Push exige o par de chaves VAPID completo.');

if (env('RESET_EMAIL_SENDER').toLowerCase() === 'resend' && !isSet('RESEND_API_KEY')) {
  errors.push('RESET_EMAIL_SENDER=resend exige RESEND_API_KEY preenchida.');
}

// WhatsApp da plataforma: os três andam juntos.
{
  const waVars = ['WA_PHONE_NUMBER_ID', 'WA_TOKEN', 'WA_SERVER_PHONE'];
  const present = waVars.filter(isSet);
  if (present.length > 0 && present.length < waVars.length) {
    const absent = waVars.filter((name) => !isSet(name)).join(', ');
    warnings.push(`WhatsApp da plataforma configurado parcialmente — falta: ${absent}.`);
  }
}

// ------------------------------------------------------------------
// 4. Somente em produção: obrigatórias + anti-placeholder + sender seguro
// ------------------------------------------------------------------
if (PRODUCTION_MODE) {
  const REQUIRED = [
    'ANTHROPIC_API_KEY', 'WHATSAPP_VERIFY_TOKEN', 'SESSION_SECRET', 'DATA_ENCRYPTION_KEY',
  ];
  for (const name of REQUIRED) {
    if (!isSet(name)) errors.push(`Variável obrigatória em produção ausente: ${name}`);
  }

  // Placeholders conhecidos (do .env.example antigo, docs, exemplos).
  const PLACEHOLDERS = [
    'mude-este-token',
    'troque-por-um-valor-aleatorio-bem-longo',
    'dev-only-insecure-secret',
    'changeme', 'change-me', 'placeholder', 'example', 'exemplo',
    'seu-token', 'sua-chave', 'xxx', 'sk-xxxx',
  ];
  const SECRET_VARS = [
    'ANTHROPIC_API_KEY', 'WHATSAPP_VERIFY_TOKEN', 'SESSION_SECRET', 'CSRF_SECRET',
    'DATA_ENCRYPTION_KEY', 'MEDIA_URL_SECRET', 'WA_TOKEN', 'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET', 'MP_PLATFORM_TOKEN', 'MP_WEBHOOK_SECRET', 'META_APP_SECRET',
    'OPENAI_API_KEY', 'GOOGLE_CLIENT_SECRET', 'MELHOR_ENVIO_PLATFORM_TOKEN',
    'BLING_OAUTH_CLIENT_SECRET', 'NUVEMSHOP_CLIENT_SECRET', 'TRAY_CLIENT_SECRET',
    'MP_OAUTH_APP_SECRET', 'RESEND_API_KEY', 'VAPID_PRIVATE_KEY',
  ];
  for (const name of SECRET_VARS) {
    if (!isSet(name)) continue;
    const value = env(name).toLowerCase();
    if (PLACEHOLDERS.some((p) => value === p || value.includes(p))) {
      errors.push(`${name} parece conter um valor placeholder — defina um segredo real.`);
    }
  }

  const sender = env('RESET_EMAIL_SENDER').toLowerCase() || 'console';
  if (sender === 'console') {
    errors.push('RESET_EMAIL_SENDER=console não é permitido em produção — ' +
      'use "resend" (com RESEND_API_KEY) ou "off".');
  }
}

// ------------------------------------------------------------------
// Resultado
// ------------------------------------------------------------------
const mode = PRODUCTION_MODE ? 'produção' : 'estrutural';
for (const warning of warnings) console.warn(`[validate-config] aviso: ${warning}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`[validate-config] erro: ${error}`);
  console.error(`\n[validate-config] validação (${mode}) FALHOU com ${errors.length} erro(s).`);
  process.exit(1);
}
console.log(`[validate-config] validação (${mode}) OK${warnings.length ? ` com ${warnings.length} aviso(s)` : ''}.`);
