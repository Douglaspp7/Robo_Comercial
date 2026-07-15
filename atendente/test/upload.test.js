/**
 * Testes do upload centralizado (src/upload.js): disco temporário, nome
 * imprevisível, magic bytes, limite de concorrência, limpeza garantida e
 * varredura de órfãos. Sobe um Express real e envia multipart via fetch.
 */
import './_setup.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync, readdirSync, existsSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

// UPLOAD_* precisa estar no env ANTES do import do módulo.
process.env.UPLOAD_TMP_DIR = mkdtempSync(join(tmpdir(), 'zapien-upload-test-'));
process.env.UPLOAD_MAX_CONCURRENT = '2';
const {
  upload, uploadGuard, requireMagicBytes, readUploadBuffer,
  verifyMagicBytes, sweepUploadTmp, uploadTmpDir,
} = await import('../src/upload.js');

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF_BYTES = Buffer.from('%PDF-1.4\nfake pdf body');

// --- Servidor de teste ---
let releaseGate = null;
const app = express();
app.post('/up', uploadGuard, upload.single('file'), requireMagicBytes, (req, res) => {
  res.json({
    ok: true,
    tmpName: req.file ? basename(req.file.path) : null,
    inTmpDir: req.file ? req.file.path.startsWith(uploadTmpDir) : null,
    size: req.file?.size ?? 0,
    contentHead: req.file ? readUploadBuffer(req.file).slice(0, 4).toString('hex') : null,
  });
});
app.post('/up-slow', uploadGuard, upload.single('file'), async (req, res) => {
  await new Promise((resolve) => { releaseGate = resolve; });
  res.json({ ok: true });
});
app.post('/up-boom', uploadGuard, upload.single('file'), (req) => {
  req.res.locals = { path: req.file?.path };
  throw new Error('falha proposital no handler');
});
app.use((err, req, res, _next) => res.status(500).json({ error: 'erro interno' }));

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

function multipart(bytes, { type = 'image/png', name = 'foto.png' } = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  return fd;
}

async function waitCleanup(tmpName, tries = 50) {
  for (let i = 0; i < tries; i++) {
    if (!existsSync(join(uploadTmpDir, tmpName))) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

test('arquivo permitido: vai para disco com nome imprevisível e é limpo após a resposta', async () => {
  const res = await fetch(`${base}/up`, { method: 'POST', body: multipart(PNG_BYTES) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.inTmpDir, true, 'temporário fica dentro do UPLOAD_TMP_DIR');
  assert.match(body.tmpName, /^up-[0-9a-f-]{36}\.tmp$/, 'nome aleatório, nunca o original');
  assert.equal(body.size, PNG_BYTES.length);
  assert.equal(body.contentHead, '89504e47', 'readUploadBuffer lê o conteúdo real');
  assert.ok(await waitCleanup(body.tmpName), 'temporário removido após sucesso');
});

test('nome malicioso (path traversal) não influencia o caminho salvo', async () => {
  const res = await fetch(`${base}/up`, {
    method: 'POST',
    body: multipart(PNG_BYTES, { name: '../../../../etc/evil.png' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.inTmpDir, true);
  assert.ok(!body.tmpName.includes('..') && !body.tmpName.includes('evil'));
  await waitCleanup(body.tmpName);
});

test('MIME falso: conteúdo que não bate com o Content-Type é recusado com 415 e limpo', async () => {
  const res = await fetch(`${base}/up`, {
    method: 'POST',
    body: multipart(Buffer.from('só texto, nada de PNG'), { type: 'image/png' }),
  });
  assert.equal(res.status, 415);
  const body = await res.json();
  assert.match(body.error, /não corresponde/);
  // Nenhum temporário sobrando.
  for (let i = 0; i < 50; i++) {
    if (!readdirSync(uploadTmpDir).some((f) => f.startsWith('up-'))) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(readdirSync(uploadTmpDir).filter((f) => f.startsWith('up-')), []);
});

test('erro no handler (banco/parsing): temporário também é limpo', async () => {
  const res = await fetch(`${base}/up-boom`, { method: 'POST', body: multipart(PDF_BYTES, { type: 'application/pdf', name: 'doc.pdf' }) });
  assert.equal(res.status, 500);
  for (let i = 0; i < 50; i++) {
    if (!readdirSync(uploadTmpDir).some((f) => f.startsWith('up-'))) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(readdirSync(uploadTmpDir).filter((f) => f.startsWith('up-')), []);
});

test('limite de uploads simultâneos responde 503 com Retry-After', async () => {
  // Ocupa o único slot restante além do teste (UPLOAD_MAX_CONCURRENT=2):
  const p1 = fetch(`${base}/up-slow`, { method: 'POST', body: multipart(PNG_BYTES) });
  // Espera o primeiro chegar ao handler (gate registrado).
  for (let i = 0; i < 100 && !releaseGate; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(releaseGate, 'primeiro upload chegou ao handler');
  const firstRelease = releaseGate; releaseGate = null;

  const p2 = fetch(`${base}/up-slow`, { method: 'POST', body: multipart(PNG_BYTES) });
  for (let i = 0; i < 100 && !releaseGate; i++) await new Promise((r) => setTimeout(r, 10));
  const secondRelease = releaseGate; releaseGate = null;

  // Terceiro upload excede o limite.
  const res3 = await fetch(`${base}/up`, { method: 'POST', body: multipart(PNG_BYTES) });
  assert.equal(res3.status, 503);
  assert.equal(res3.headers.get('retry-after'), '10');
  const body = await res3.json();
  assert.match(body.error, /Aguarde/);

  firstRelease(); secondRelease?.();
  await Promise.all([p1, p2]);

  // Com os slots liberados, upload volta a funcionar.
  const res4 = await fetch(`${base}/up`, { method: 'POST', body: multipart(PNG_BYTES) });
  assert.equal(res4.status, 200);
  await waitCleanup((await res4.json()).tmpName);
});

test('verifyMagicBytes: assinaturas conhecidas e tipos desconhecidos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zapien-magic-'));
  const png = join(dir, 'a.bin'); writeFileSync(png, PNG_BYTES);
  const pdf = join(dir, 'b.bin'); writeFileSync(pdf, PDF_BYTES);
  const text = join(dir, 'c.bin'); writeFileSync(text, 'olá mundo');

  assert.deepEqual(verifyMagicBytes(png, 'image/png'), { known: true, ok: true });
  assert.deepEqual(verifyMagicBytes(pdf, 'application/pdf'), { known: true, ok: true });
  assert.deepEqual(verifyMagicBytes(text, 'image/png'), { known: true, ok: false });
  assert.deepEqual(verifyMagicBytes(text, 'application/pdf'), { known: true, ok: false });
  // Tipo sem assinatura conhecida: não bloqueia (o allowlist da rota decide).
  assert.deepEqual(verifyMagicBytes(text, 'text/plain'), { known: false, ok: true });
  // Arquivo inexistente com tipo conhecido: falha fechada.
  assert.deepEqual(verifyMagicBytes(join(dir, 'nope.bin'), 'image/png'), { known: true, ok: false });
});

test('readUploadBuffer: lê do disco e mantém compatibilidade com file.buffer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zapien-read-'));
  const path = join(dir, 'x.bin');
  writeFileSync(path, PNG_BYTES);
  assert.deepEqual(readUploadBuffer({ path }), PNG_BYTES);
  assert.deepEqual(readUploadBuffer({ buffer: PDF_BYTES }), PDF_BYTES);
  assert.equal(readUploadBuffer(null), null);
  assert.deepEqual(readFileSync(path), PNG_BYTES, 'arquivo continua no lugar (leitura não destrói)');
});

test('varredura remove só temporários órfãos antigos', () => {
  const oldFile = join(uploadTmpDir, 'up-orfao-antigo.tmp');
  const newFile = join(uploadTmpDir, 'up-recente.tmp');
  const otherFile = join(uploadTmpDir, 'outro-arquivo.txt');
  writeFileSync(oldFile, 'x');
  writeFileSync(newFile, 'x');
  writeFileSync(otherFile, 'x');
  const past = (Date.now() - 2 * 60 * 60 * 1000) / 1000; // 2h atrás
  utimesSync(oldFile, past, past);

  const removed = sweepUploadTmp(60 * 60 * 1000); // maxAge 1h
  assert.equal(removed, 1);
  assert.ok(!existsSync(oldFile), 'órfão antigo removido');
  assert.ok(existsSync(newFile), 'temporário recente preservado');
  assert.ok(existsSync(otherFile), 'arquivos fora do padrão up-*.tmp não são tocados');
});
