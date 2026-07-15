import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  db,
  catalogFileQueries,
  knowledgeDocumentQueries,
  knowledgeChunkQueries,
  knowledgeJobQueries,
} from '../src/db.js';
import { createKnowledgeChunks } from '../src/knowledge/chunk.js';
import { buildFtsQuery, searchKnowledge } from '../src/knowledge/search.js';
import { processNextKnowledgeJob } from '../src/knowledge/worker.js';
import { sha256Buffer } from '../src/knowledge/text.js';

function makeTenant(plan = 'pro') {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO tenants (id, email, password_hash, plan, subscription_status, business_json)
    VALUES (?, ?, 'h', ?, 'active', ?)
  `).run(id, `${id}@test.com`, plan, JSON.stringify({ produtos: [{ nome: 'Produto antigo' }] }));
  return id;
}

function insertKnowledgeDocument({ tenantId, sourceType = 'extra_document', sourceId = randomUUID(), filename = 'doc.pdf', status = 'ready' }) {
  const id = randomUUID();
  knowledgeDocumentQueries.insert.run({
    id,
    tenant_id: tenantId,
    source_type: sourceType,
    source_id: sourceId,
    filename,
    mime_type: 'application/pdf',
    size_bytes: 123,
    sha256: sha256Buffer(Buffer.from(`${tenantId}:${filename}:${sourceId}`)),
    status: 'uploaded',
    active: 0,
    progress_percent: 0,
  });
  knowledgeDocumentQueries.markReady.run({
    id,
    status,
    page_count: 1,
    indexed_pages: 1,
    chunks_count: 1,
    error_code: null,
    error_message: null,
  });
  return id;
}

test('createKnowledgeChunks divide texto, preserva paginas e remove duplicatas', () => {
  const repeated = 'Produto Camiseta Dry Fit com protecao UV e preco R$ 99. ';
  const chunks = createKnowledgeChunks([
    { number: 1, text: `Catalogo\n${repeated.repeat(30)}` },
    { number: 2, text: `Catalogo\n${repeated.repeat(30)}` },
  ], { targetChars: 500, maxChars: 700, overlapChars: 80 });

  assert.ok(chunks.length >= 1);
  assert.ok(chunks.every((chunk) => chunk.page_from >= 1 && chunk.page_to >= chunk.page_from));
  assert.equal(new Set(chunks.map((chunk) => chunk.content_hash)).size, chunks.length);
});

test('searchKnowledge usa FTS e isola resultados por tenant', () => {
  const tenantA = makeTenant();
  const tenantB = makeTenant();
  const docA = insertKnowledgeDocument({ tenantId: tenantA, filename: 'garantia.pdf' });
  const docB = insertKnowledgeDocument({ tenantId: tenantB, filename: 'outro.pdf' });

  knowledgeChunkQueries.insert.run({
    tenant_id: tenantA,
    document_id: docA,
    page_from: 1,
    page_to: 1,
    section_title: 'Garantia',
    content: 'A garantia da camiseta premium cobre troca por defeito em ate 30 dias.',
    normalized_content: 'garantia camiseta premium cobre troca defeito ate 30 dias',
    content_hash: sha256Buffer(Buffer.from(`a:${docA}`)),
    metadata_json: '{}',
  });
  knowledgeChunkQueries.insert.run({
    tenant_id: tenantB,
    document_id: docB,
    page_from: 1,
    page_to: 1,
    section_title: 'Privado',
    content: 'Este material de outro tenant fala sobre garantia secreta.',
    normalized_content: 'material outro tenant garantia secreta',
    content_hash: sha256Buffer(Buffer.from(`b:${docB}`)),
    metadata_json: '{}',
  });

  assert.equal(buildFtsQuery('qual a garantia da camiseta?'), 'garantia* OR camiseta*');
  const result = searchKnowledge({ tenantId: tenantA, query: 'qual a garantia da camiseta?', limit: 3 });
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].document_id, docA);
  assert.match(result.chunks[0].content, /camiseta premium/);
});

test('processNextKnowledgeJob indexa catalogo e salva candidatos de produto', async () => {
  const tenantId = makeTenant('pro');
  const pdfBuffer = Buffer.from('%PDF-1.4\nfake catalog');
  catalogFileQueries.upsert.run(tenantId, 'catalogo.pdf', pdfBuffer);
  const documentId = randomUUID();
  knowledgeDocumentQueries.insert.run({
    id: documentId,
    tenant_id: tenantId,
    source_type: 'catalog',
    source_id: tenantId,
    filename: 'catalogo.pdf',
    mime_type: 'application/pdf',
    size_bytes: pdfBuffer.length,
    sha256: sha256Buffer(pdfBuffer),
    status: 'uploaded',
    active: 0,
    progress_percent: 0,
  });
  knowledgeJobQueries.insert.run({
    id: randomUUID(),
    tenant_id: tenantId,
    document_id: documentId,
    type: 'extract_text',
    status: 'pending',
    next_attempt_at: null,
  });

  const processed = await processNextKnowledgeJob({
    parsePdf: async () => ({
      pageCount: 1,
      indexedPages: 1,
      likelyScanned: false,
      pages: [{ number: 1, text: 'Produto Vestido Midi\nPreco R$ 129\nTamanho P, M e G.' }],
    }),
    productExtractor: async () => [{ nome: 'Vestido Midi', preco: 'R$ 129' }],
  });

  assert.equal(processed.processed, true);
  const doc = knowledgeDocumentQueries.byId.get(documentId);
  assert.equal(doc.status, 'ready');
  assert.equal(doc.active, 1);
  assert.equal(knowledgeChunkQueries.countByDocument.get(documentId).n, 1);
  const products = db.prepare(`SELECT product_json FROM knowledge_document_products WHERE document_id = ?`).all(documentId);
  assert.equal(products.length, 1);
  assert.equal(JSON.parse(products[0].product_json).nome, 'Vestido Midi');
});
