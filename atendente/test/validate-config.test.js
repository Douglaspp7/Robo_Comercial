import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'scripts', 'validate-config.mjs');
const ROOT = join(__dirname, '..');

// Executa o script com um ambiente controlado (sem herdar .env do dev) e
// devolve { code, output }.
function run({ args = [], env = {}, cwd = ROOT } = {}) {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      env: {
        PATH: process.env.PATH,
        DOTENV_CONFIG_PATH: '/nonexistent/.env',
        ...env,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

test('validação estrutural passa sem nenhuma variável definida', () => {
  const { code, output } = run();
  assert.equal(code, 0, output);
  assert.match(output, /OK/);
});

test('detecta marcador de conflito Git em arquivo do projeto', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zapien-vc-'));
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'bad.js'), 'const a = 1;\n<<<<<<< HEAD\nconst b = 2;\n');
    const { code, output } = run({ cwd: dir });
    assert.equal(code, 1);
    assert.match(output, /conflito Git/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejeita URL inválida em APP_URL', () => {
  const { code, output } = run({ env: { APP_URL: 'nao-e-uma-url' } });
  assert.equal(code, 1);
  assert.match(output, /APP_URL/);
});

test('rejeita inteiro não positivo', () => {
  const { code, output } = run({ env: { AI_CONCURRENCY: '-2' } });
  assert.equal(code, 1);
  assert.match(output, /AI_CONCURRENCY/);
});

test('rejeita WA_SERVER_PHONE com "+" ou formato inválido', () => {
  for (const value of ['+5511999990000', 'abc', '123']) {
    const { code, output } = run({ env: { WA_SERVER_PHONE: value } });
    assert.equal(code, 1, `esperava falha para ${value}`);
    assert.match(output, /WA_SERVER_PHONE/);
  }
});

test('rejeita DATA_ENCRYPTION_KEY fora do formato hex de 64 chars', () => {
  const { code, output } = run({ env: { DATA_ENCRYPTION_KEY: 'curta' } });
  assert.equal(code, 1);
  assert.match(output, /DATA_ENCRYPTION_KEY/);
  assert.ok(!output.includes('curta'), 'não deve ecoar o valor do segredo');
});

test('detecta combinação parcial: Stripe sem price id', () => {
  const secret = 'sk_live_abcdef123456';
  const { code, output } = run({ env: { STRIPE_SECRET_KEY: secret } });
  assert.equal(code, 1);
  assert.match(output, /STRIPE_PRICE_ID/);
  assert.ok(!output.includes(secret), 'não deve ecoar o valor do segredo');
});

test('detecta combinação parcial: Meta sem secret/config', () => {
  const { code, output } = run({ env: { META_APP_ID: '1234567890' } });
  assert.equal(code, 1);
  assert.match(output, /META_APP_SECRET/);
});

test('detecta RESET_EMAIL_SENDER=resend sem RESEND_API_KEY', () => {
  const { code, output } = run({ env: { RESET_EMAIL_SENDER: 'resend' } });
  assert.equal(code, 1);
  assert.match(output, /RESEND_API_KEY/);
});

const PROD_OK_ENV = {
  OPENAI_API_KEY: 'sk-proj-real-key-000',
  WHATSAPP_VERIFY_TOKEN: 'token-verificacao-real-1234',
  SESSION_SECRET: 'a'.repeat(64),
  DATA_ENCRYPTION_KEY: 'ab'.repeat(32),
  RESET_EMAIL_SENDER: 'off',
};

test('produção: passa com as obrigatórias preenchidas', () => {
  const { code, output } = run({ args: ['--production'], env: PROD_OK_ENV });
  assert.equal(code, 0, output);
});

test('produção: falha com obrigatória ausente', () => {
  const env = { ...PROD_OK_ENV };
  delete env.DATA_ENCRYPTION_KEY;
  const { code, output } = run({ args: ['--production'], env });
  assert.equal(code, 1);
  assert.match(output, /DATA_ENCRYPTION_KEY/);
});

test('produção: recusa placeholder conhecido sem ecoar o valor', () => {
  const { code, output } = run({
    args: ['--production'],
    env: { ...PROD_OK_ENV, WHATSAPP_VERIFY_TOKEN: 'mude-este-token' },
  });
  assert.equal(code, 1);
  assert.match(output, /WHATSAPP_VERIFY_TOKEN/);
  assert.ok(!output.includes('mude-este-token'), 'não deve ecoar o valor do segredo');
});

test('produção: recusa RESET_EMAIL_SENDER=console', () => {
  const { code, output } = run({
    args: ['--production'],
    env: { ...PROD_OK_ENV, RESET_EMAIL_SENDER: 'console' },
  });
  assert.equal(code, 1);
  assert.match(output, /RESET_EMAIL_SENDER/);
});
