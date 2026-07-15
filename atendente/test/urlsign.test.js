import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-para-urlsign';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test';
process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'test';
const { signedQuery, verifySignedQuery } = await import('../src/urlsign.js');

function reqFrom(query) {
  return { query };
}

function parseQuery(qs) {
  const params = new URLSearchParams(qs.replace(/^\?/, ''));
  return Object.fromEntries(params.entries());
}

test('signedQuery gera assinatura válida verificável', () => {
  const q = signedQuery('media-123', 3600);
  const ok = verifySignedQuery(reqFrom(parseQuery(q)), 'media-123');
  assert.equal(ok, true);
});

test('assinatura falha para valor diferente', () => {
  const q = signedQuery('media-123', 3600);
  assert.equal(verifySignedQuery(reqFrom(parseQuery(q)), 'media-999'), false);
});

test('assinatura expirada é rejeitada', () => {
  const q = signedQuery('media-123', -10); // já expirada
  assert.equal(verifySignedQuery(reqFrom(parseQuery(q)), 'media-123'), false);
});

test('requisição sem sig/exp é rejeitada', () => {
  assert.equal(verifySignedQuery(reqFrom({}), 'media-123'), false);
  assert.equal(verifySignedQuery(reqFrom({ exp: '999', sig: 'deadbeef' }), 'media-123'), false);
});
