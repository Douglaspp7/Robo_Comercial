/**
 * Fluxo de recuperação de senha:
 *   POST /api/forgot-password  → gera token, guarda hash SHA-256, loga link
 *   POST /api/reset-password   → consome token, troca senha, revoga sessões
 *
 * Testa direto pelas funções de auth.js (assim como o teste de billing e de
 * mercadopago fazem para não subir um Express só para verificar).
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  createTenant,
  login,
  createPasswordResetToken,
  consumePasswordResetToken,
} from '../src/auth.js';
import { db, tenantQueries, sessionQueries, passwordResetTokenQueries } from '../src/db.js';

function sha256(v) { return createHash('sha256').update(v).digest('hex'); }

function makeUser() {
  const email = `${randomUUID()}@reset-test.com`;
  createTenant(email, 'senhaAntiga123');
  return { email };
}

test('createPasswordResetToken retorna null quando o e-mail não existe (não vira oráculo de contas)', () => {
  const out = createPasswordResetToken('naoexiste@reset-test.com');
  assert.equal(out, null);
});

test('createPasswordResetToken cria token cru e guarda só o hash', () => {
  const { email } = makeUser();
  const out = createPasswordResetToken(email);
  assert.ok(out, 'devolve o token cru + tenant');
  assert.match(out.rawToken, /^[a-f0-9]{64}$/, 'token cru é 64 hex (32 bytes)');

  // Verifica que no banco só está o hash — o token cru NÃO está no banco.
  const rows = db.prepare(`SELECT token_hash FROM password_reset_tokens WHERE tenant_id = ?`).all(out.tenant.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token_hash, sha256(out.rawToken));
  assert.notEqual(rows[0].token_hash, out.rawToken);
});

test('createPasswordResetToken invalida tokens anteriores do mesmo tenant', () => {
  const { email } = makeUser();
  const t1 = createPasswordResetToken(email);
  const t2 = createPasswordResetToken(email);
  // Só um token ativo por tenant: o novo derruba o antigo.
  const tenantId = t2.tenant.id;
  const rows = db.prepare(`SELECT token_hash FROM password_reset_tokens WHERE tenant_id = ?`).all(tenantId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token_hash, sha256(t2.rawToken));
  // Token 1 já não deve ser aceito.
  assert.equal(consumePasswordResetToken(t1.rawToken, 'novaSenha1234'), false);
});

test('consumePasswordResetToken troca a senha e revoga sessões existentes', () => {
  const { email } = makeUser();
  // Cria uma sessão para depois verificar que foi revogada.
  const oldSessionToken = login(email, 'senhaAntiga123');
  assert.ok(oldSessionToken);

  const { rawToken, tenant } = createPasswordResetToken(email);
  const ok = consumePasswordResetToken(rawToken, 'novaSenhaForte99');
  assert.equal(ok, true);

  // Senha antiga não funciona mais.
  assert.equal(login(email, 'senhaAntiga123'), null);
  // Senha nova funciona.
  const newToken = login(email, 'novaSenhaForte99');
  assert.ok(newToken);

  // Sessão antiga (pré-reset) foi apagada.
  assert.equal(sessionQueries.byToken.get(oldSessionToken), undefined);

  // Hash da senha realmente mudou no banco.
  const t = tenantQueries.byId.get(tenant.id);
  assert.equal(bcrypt.compareSync('novaSenhaForte99', t.password_hash), true);
});

test('consumePasswordResetToken recusa token já usado', () => {
  const { email } = makeUser();
  const { rawToken } = createPasswordResetToken(email);
  assert.equal(consumePasswordResetToken(rawToken, 'primeiraNova123'), true);
  // Segunda tentativa: mesmo token, senha diferente. Deve falhar.
  assert.equal(consumePasswordResetToken(rawToken, 'segundaNova123'), false);
});

test('consumePasswordResetToken recusa token expirado', () => {
  const { email } = makeUser();
  const { rawToken, tenant } = createPasswordResetToken(email);
  // Força expiração no banco.
  db.prepare(`UPDATE password_reset_tokens SET expires_at = datetime('now', '-1 hour') WHERE tenant_id = ?`).run(tenant.id);
  assert.equal(consumePasswordResetToken(rawToken, 'outraNova123'), false);
});

test('consumePasswordResetToken recusa token inválido/inexistente', () => {
  assert.equal(consumePasswordResetToken('deadbeef'.repeat(8), 'qualquerSenha123'), false);
  assert.equal(consumePasswordResetToken('', 'qualquerSenha123'), false);
});

test('cleanupExpired remove tokens antigos', () => {
  const { email } = makeUser();
  const { tenant } = createPasswordResetToken(email);
  db.prepare(`UPDATE password_reset_tokens SET expires_at = datetime('now', '-3 days') WHERE tenant_id = ?`).run(tenant.id);
  passwordResetTokenQueries.cleanupExpired.run();
  const rows = db.prepare(`SELECT COUNT(*) AS n FROM password_reset_tokens WHERE tenant_id = ?`).get(tenant.id);
  assert.equal(rows.n, 0);
});
