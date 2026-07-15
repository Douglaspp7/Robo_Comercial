import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl } from '../src/ssrf.js';

test('assertPublicUrl bloqueia loopback', async () => {
  await assert.rejects(() => assertPublicUrl('http://127.0.0.1/x'), /interno/);
  await assert.rejects(() => assertPublicUrl('http://localhost/x'), /interno|resolver/);
});

test('assertPublicUrl bloqueia metadados de nuvem (169.254.169.254)', async () => {
  await assert.rejects(() => assertPublicUrl('http://169.254.169.254/latest/meta-data/'), /interno/);
});

test('assertPublicUrl bloqueia faixas privadas', async () => {
  await assert.rejects(() => assertPublicUrl('http://10.0.0.5/'), /interno/);
  await assert.rejects(() => assertPublicUrl('http://192.168.1.1/'), /interno/);
  await assert.rejects(() => assertPublicUrl('http://172.16.5.5/'), /interno/);
});

test('assertPublicUrl bloqueia IPv6 loopback e IPv4-mapped interno', async () => {
  await assert.rejects(() => assertPublicUrl('http://[::1]/'), /interno/);
  await assert.rejects(() => assertPublicUrl('http://[::ffff:127.0.0.1]/'), /interno/);
});

test('assertPublicUrl rejeita protocolos não-http', async () => {
  await assert.rejects(() => assertPublicUrl('file:///etc/passwd'), /http/);
  await assert.rejects(() => assertPublicUrl('ftp://example.com'), /http/);
});

test('assertPublicUrl rejeita URL inválida', async () => {
  await assert.rejects(() => assertPublicUrl('não é url'), /inválida/);
});

test('assertPublicUrl aceita IP público literal', async () => {
  const url = await assertPublicUrl('https://8.8.8.8/');
  assert.equal(url.hostname, '8.8.8.8');
});
