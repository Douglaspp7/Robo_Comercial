import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout, fetchWithRetry } from '../src/http.js';

const origFetch = globalThis.fetch;

test('fetchWithTimeout resolve normalmente quando o fetch responde', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    const res = await fetchWithTimeout('https://example.com', {}, 1000);
    assert.equal(res.status, 200);
  } finally { globalThis.fetch = origFetch; }
});

test('fetchWithTimeout traduz AbortError/TimeoutError em erro claro (ETIMEDOUT)', async () => {
  globalThis.fetch = async () => {
    const e = new Error('aborted'); e.name = 'AbortError'; throw e;
  };
  try {
    await assert.rejects(
      () => fetchWithTimeout('https://example.com/x', {}, 50),
      (err) => err.code === 'ETIMEDOUT' && /Timeout/.test(err.message),
    );
  } finally { globalThis.fetch = origFetch; }
});

test('fetchWithRetry retenta em 5xx e depois devolve', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 503 }; };
  try {
    const res = await fetchWithRetry('https://example.com', {}, { retries: 2, baseDelayMs: 1 });
    assert.equal(res.status, 503);
    assert.equal(calls, 3); // 1 + 2 retries
  } finally { globalThis.fetch = origFetch; }
});

test('fetchWithRetry NÃO retenta em 4xx (erro definitivo)', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 404 }; };
  try {
    const res = await fetchWithRetry('https://example.com', {}, { retries: 3, baseDelayMs: 1 });
    assert.equal(res.status, 404);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = origFetch; }
});

test('fetchWithRetry retorna na primeira resposta 2xx', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, status: 200 }; };
  try {
    const res = await fetchWithRetry('https://example.com', {}, { retries: 3, baseDelayMs: 1 });
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = origFetch; }
});
