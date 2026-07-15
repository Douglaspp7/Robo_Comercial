/**
 * Testes do envio de e-mail de recuperação de senha (src/email.js).
 * O fetch global é mockado — nenhum teste fala com o Resend de verdade.
 */
process.env.EMAIL_RETRY_DELAY_MS = '5'; // retry rápido nos testes
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  sendPasswordResetEmail,
  renderPasswordResetEmail,
  getEmailSenderMode,
  maskEmail,
} from '../src/email.js';

const RESET_URL = 'https://zapien.app/login.html#reset=tokensecreto123';

const originalFetch = globalThis.fetch;
const originalEnv = {};
const ENV_KEYS = ['RESET_EMAIL_SENDER', 'RESEND_API_KEY', 'EMAIL_FROM', 'SUPPORT_EMAIL', 'NODE_ENV'];

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return handler(calls.length, url, opts);
  };
  return calls;
}

function captureLogs() {
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  return {
    lines,
    restore() { console.log = origLog; console.error = origErr; },
  };
}

test('maskEmail esconde o usuário e mantém o domínio', () => {
  assert.equal(maskEmail('douglas@gmail.com'), 'do****@gmail.com');
  assert.equal(maskEmail(''), '****@');
});

test('template contém link, validade, aviso e suporte — e nada além do esperado', () => {
  process.env.SUPPORT_EMAIL = 'ajuda@zapien.app';
  const { subject, html, text } = renderPasswordResetEmail({ resetUrl: RESET_URL, expiresInMinutes: 60 });
  assert.match(subject, /Redefinir sua senha/);
  for (const body of [html, text]) {
    assert.ok(body.includes(RESET_URL), 'contém a URL de reset');
    assert.match(body, /60 minutos/);
    assert.match(body, /ignore este e-mail/);
    assert.ok(body.includes('ajuda@zapien.app'), 'contém o e-mail de suporte');
  }
});

test('modo off não envia nem imprime', async () => {
  process.env.RESET_EMAIL_SENDER = 'off';
  const calls = mockFetch(() => { throw new Error('não deveria chamar fetch'); });
  const logs = captureLogs();
  try {
    const out = await sendPasswordResetEmail({ to: 'x@y.com', resetUrl: RESET_URL });
    assert.equal(out.sent, false);
    assert.equal(out.mode, 'off');
    assert.equal(calls.length, 0);
    assert.equal(logs.lines.length, 0);
  } finally {
    logs.restore();
  }
});

test('modo console imprime a URL de reset (dev) sem chamar o provedor', async () => {
  process.env.RESET_EMAIL_SENDER = 'console';
  delete process.env.NODE_ENV;
  const calls = mockFetch(() => { throw new Error('não deveria chamar fetch'); });
  const logs = captureLogs();
  try {
    const out = await sendPasswordResetEmail({ to: 'x@y.com', resetUrl: RESET_URL });
    assert.equal(out.sent, false);
    assert.equal(calls.length, 0);
    assert.ok(logs.lines.some((l) => l.includes(RESET_URL)));
  } finally {
    logs.restore();
  }
});

test('em produção, console degrada para off e o token nunca vai para o log', async () => {
  process.env.RESET_EMAIL_SENDER = 'console';
  process.env.NODE_ENV = 'production';
  assert.equal(getEmailSenderMode(), 'off');
  const logs = captureLogs();
  try {
    const out = await sendPasswordResetEmail({ to: 'x@y.com', resetUrl: RESET_URL });
    assert.equal(out.sent, false);
    assert.ok(!logs.lines.some((l) => l.includes('tokensecreto123')), 'token não pode aparecer no log');
  } finally {
    logs.restore();
  }
});

test('resend: envia com sucesso com autenticação e destinatário corretos', async () => {
  process.env.RESET_EMAIL_SENDER = 'resend';
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.EMAIL_FROM = 'Zapien <acesso@zapien.app>';
  const calls = mockFetch(() => new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }));
  const logs = captureLogs();
  try {
    const out = await sendPasswordResetEmail({ to: 'cliente@loja.com', resetUrl: RESET_URL });
    assert.equal(out.sent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer re_test_key');
    const body = JSON.parse(calls[0].opts.body);
    assert.deepEqual(body.to, ['cliente@loja.com']);
    assert.ok(body.html.includes(RESET_URL));
    // Log de sucesso mascara o e-mail e não contém o token.
    assert.ok(logs.lines.some((l) => l.includes('cl****@loja.com')));
    assert.ok(!logs.lines.some((l) => l.includes('tokensecreto123')));
  } finally {
    logs.restore();
  }
});

test('resend: 429 é retentado uma vez e depois sucede', async () => {
  process.env.RESET_EMAIL_SENDER = 'resend';
  process.env.RESEND_API_KEY = 're_test_key';
  const calls = mockFetch((n) =>
    n === 1
      ? new Response('rate limited', { status: 429 })
      : new Response('{}', { status: 200 })
  );
  const logs = captureLogs();
  try {
    const out = await sendPasswordResetEmail({ to: 'x@y.com', resetUrl: RESET_URL });
    assert.equal(out.sent, true);
    assert.equal(calls.length, 2);
  } finally {
    logs.restore();
  }
});

test('resend: 5xx persistente lança erro sem vazar o destinatário', async () => {
  process.env.RESET_EMAIL_SENDER = 'resend';
  process.env.RESEND_API_KEY = 're_test_key';
  const calls = mockFetch(() => new Response('internal error', { status: 500 }));
  await assert.rejects(
    () => sendPasswordResetEmail({ to: 'segredo@cliente.com', resetUrl: RESET_URL }),
    (err) => {
      assert.equal(err.name, 'EmailSendError');
      assert.equal(err.status, 500);
      assert.ok(!err.message.includes('segredo@cliente.com'));
      return true;
    }
  );
  assert.equal(calls.length, 2, 'uma tentativa + um retry');
});

test('resend: timeout/erro de rede é retentado e depois lança erro', async () => {
  process.env.RESET_EMAIL_SENDER = 'resend';
  process.env.RESEND_API_KEY = 're_test_key';
  const calls = mockFetch(() => {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    throw err;
  });
  await assert.rejects(
    () => sendPasswordResetEmail({ to: 'x@y.com', resetUrl: RESET_URL }),
    /timeout/
  );
  assert.equal(calls.length, 2);
});

test('resend: erro 4xx não transitório não é retentado', async () => {
  process.env.RESET_EMAIL_SENDER = 'resend';
  process.env.RESEND_API_KEY = 're_test_key';
  const calls = mockFetch(() => new Response('invalid from', { status: 422 }));
  await assert.rejects(() => sendPasswordResetEmail({ to: 'x@y.com', resetUrl: RESET_URL }));
  assert.equal(calls.length, 1);
});

test('resend sem RESEND_API_KEY falha com mensagem clara', async () => {
  process.env.RESET_EMAIL_SENDER = 'resend';
  delete process.env.RESEND_API_KEY;
  await assert.rejects(
    () => sendPasswordResetEmail({ to: 'x@y.com', resetUrl: RESET_URL }),
    /RESEND_API_KEY/
  );
});
