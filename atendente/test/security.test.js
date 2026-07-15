import { test } from 'node:test';
import assert from 'node:assert';

// Test XSS escape function
test('esc() prevents XSS injection', () => {
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/`/g, '&#96;');
  }

  assert.strictEqual(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.strictEqual(esc('"><svg/onload=alert(1)>'), '&quot;&gt;&lt;svg/onload=alert(1)&gt;');
  assert.strictEqual(esc(null), '');
  assert.strictEqual(esc(undefined), '');
  assert.strictEqual(esc(0), '0');
});

// Test CSV sanitization
test('sanitizeCsvCell() prevents CSV injection', () => {
  function sanitizeCsvCell(value) {
    const s = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
    return s;
  }

  assert.strictEqual(sanitizeCsvCell('=HYPERLINK("https://evil.com","Click")'), "'=HYPERLINK(\"https://evil.com\",\"Click\")");
  assert.strictEqual(sanitizeCsvCell('+cmd'), "'+cmd");
  assert.strictEqual(sanitizeCsvCell('-1+1'), "'-1+1");
  assert.strictEqual(sanitizeCsvCell('@SUM(1+1)'), "'@SUM(1+1)");
  assert.strictEqual(sanitizeCsvCell('normal text'), 'normal text');
  assert.strictEqual(sanitizeCsvCell(''), '');
});

// Test encrypt/decrypt round-trip
test('encryptSecret/decryptSecret round-trip', async () => {
  // Set a valid 32-byte key (64 hex chars)
  process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
  // Clear module cache to reload with new env var - use unique import
  const mod = await import('../src/crypto.js?' + Date.now());
  const { encryptSecret, decryptSecret } = mod;

  const plain = 'APP_USR-test-token-123';
  const encrypted = encryptSecret(plain);
  assert.ok(encrypted.startsWith('enc:v1:'), 'Should start with enc:v1:');
  assert.notStrictEqual(encrypted, plain, 'Encrypted should differ from plaintext');

  const decrypted = decryptSecret(encrypted);
  assert.strictEqual(decrypted, plain, 'Round-trip should recover original');

  // Legacy plaintext passthrough
  assert.strictEqual(decryptSecret('old-plain-token'), 'old-plain-token', 'Legacy tokens pass through');

  // Already encrypted passthrough
  assert.strictEqual(encryptSecret(encrypted), encrypted, 'Double-encrypt is idempotent');

  // Null/undefined passthrough
  assert.strictEqual(encryptSecret(null), null);
  assert.strictEqual(decryptSecret(null), null);
});

// Test CSRF token generation/verification
test('CSRF token generation and verification', async () => {
  process.env.CSRF_SECRET = 'test-csrf-secret-for-testing-only-1234567';
  const { generateCsrfToken, verifyCsrfToken } = await import('../src/csrf.js?' + Date.now());

  const sessionToken = 'test-session-token-abc123';
  const csrfToken = generateCsrfToken(sessionToken);

  assert.ok(typeof csrfToken === 'string', 'Token should be a string');
  assert.ok(csrfToken.includes('.'), 'Token should have nonce.sig format');

  assert.ok(verifyCsrfToken(sessionToken, csrfToken), 'Valid token should verify');
  assert.ok(!verifyCsrfToken(sessionToken, 'invalid-token'), 'Invalid token should fail');
  assert.ok(!verifyCsrfToken('other-session', csrfToken), 'Wrong session should fail');
  assert.ok(!verifyCsrfToken(sessionToken, null), 'Null token should fail');
  assert.ok(!verifyCsrfToken(null, csrfToken), 'Null session should fail');
  assert.ok(!verifyCsrfToken(sessionToken, ''), 'Empty token should fail');
});

// Test Zod validators
test('signupSchema validates email format', async () => {
  const { signupSchema } = await import('../src/validators.js');

  const validResult = signupSchema.safeParse({ email: 'test@example.com', password: 'password123', accept_terms: true });
  assert.ok(validResult.success, 'Valid data should pass');
  assert.strictEqual(validResult.data.email, 'test@example.com');

  const invalidEmail = signupSchema.safeParse({ email: 'not-an-email', password: 'password123', accept_terms: true });
  assert.ok(!invalidEmail.success, 'Invalid email should fail');

  const shortPassword = signupSchema.safeParse({ email: 'test@example.com', password: 'short', accept_terms: true });
  assert.ok(!shortPassword.success, 'Short password should fail');

  const longPassword = signupSchema.safeParse({ email: 'test@example.com', password: 'a'.repeat(129), accept_terms: true });
  assert.ok(!longPassword.success, 'Too long password should fail');
});

test('signupSchema exige aceite dos termos (LGPD)', async () => {
  const { signupSchema } = await import('../src/validators.js');

  const semAceite = signupSchema.safeParse({ email: 'test@example.com', password: 'password123' });
  assert.ok(!semAceite.success, 'Sem accept_terms deve falhar');

  const aceiteFalso = signupSchema.safeParse({ email: 'test@example.com', password: 'password123', accept_terms: false });
  assert.ok(!aceiteFalso.success, 'accept_terms: false deve falhar');

  const comAceite = signupSchema.safeParse({ email: 'test@example.com', password: 'password123', accept_terms: true });
  assert.ok(comAceite.success, 'accept_terms: true deve passar');
});

test('loginSchema validates credentials', async () => {
  const { loginSchema } = await import('../src/validators.js');

  const validResult = loginSchema.safeParse({ email: 'TEST@EXAMPLE.COM', password: 'anypass' });
  assert.ok(validResult.success, 'Valid login should pass');
  assert.strictEqual(validResult.data.email, 'test@example.com', 'Email should be lowercased');

  const emptyPassword = loginSchema.safeParse({ email: 'test@example.com', password: '' });
  assert.ok(!emptyPassword.success, 'Empty password should fail');
});

test('sanitizeCsvCell handles edge cases', () => {
  function sanitizeCsvCell(value) {
    const s = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
    return s;
  }

  assert.strictEqual(sanitizeCsvCell(null), '', 'null becomes empty string');
  assert.strictEqual(sanitizeCsvCell(undefined), '', 'undefined becomes empty string');
  assert.strictEqual(sanitizeCsvCell(123), '123', 'numbers pass through');
  assert.strictEqual(sanitizeCsvCell('João da Silva'), 'João da Silva', 'Normal names pass through');
});
