#!/usr/bin/env node
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  db,
  knowledgeDocumentQueries,
  knowledgeJobQueries,
} from '../src/db.js';
import { sha256Buffer } from '../src/knowledge/text.js';

const command = process.argv[2] || 'status';
const tenantFilter = process.argv.find((arg) => arg.startsWith('--tenant='))?.slice('--tenant='.length) || '';
const maxPendingPerTenant = Math.max(1, Number(process.env.KNOWLEDGE_MAX_PENDING_PER_TENANT) || 2);

function pendingForTenant(tenantId) {
  return db.prepare(`
    SELECT COUNT(*) AS n
    FROM knowledge_jobs
    WHERE tenant_id = ? AND status IN ('pending', 'processing')
  `).get(tenantId).n || 0;
}

function enqueueDocument({ tenantId, documentId, type }) {
  if (pendingForTenant(tenantId) >= maxPendingPerTenant) {
    return { ok: false, reason: 'tenant_pending_limit' };
  }
  knowledgeJobQueries.insert.run({
    id: randomUUID(),
    tenant_id: tenantId,
    document_id: documentId,
    type,
    status: 'pending',
    next_attempt_at: null,
  });
  knowledgeDocumentQueries.updateQueued.run(documentId);
  return { ok: true };
}

function sourceExists({ tenantId, sourceType, sourceId, sha256 }) {
  return db.prepare(`
    SELECT id, status
    FROM knowledge_documents
    WHERE tenant_id = ?
      AND source_type = ?
      AND COALESCE(source_id, '') = COALESCE(?, '')
      AND sha256 = ?
      AND status NOT IN ('failed', 'rejected_limit')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(tenantId, sourceType, sourceId || '', sha256);
}

function createKnowledgeDocument({ tenantId, sourceType, sourceId, filename, mimeType, content }) {
  const buffer = Buffer.from(content);
  const sha256 = sha256Buffer(buffer);
  const existing = sourceExists({ tenantId, sourceType, sourceId, sha256 });
  if (existing) return { status: 'skipped', documentId: existing.id };

  const id = randomUUID();
  knowledgeDocumentQueries.insert.run({
    id,
    tenant_id: tenantId,
    source_type: sourceType,
    source_id: sourceId || null,
    filename,
    mime_type: mimeType || 'application/pdf',
    size_bytes: buffer.length,
    sha256,
    status: 'uploaded',
    active: 0,
    progress_percent: 0,
  });

  const queued = enqueueDocument({ tenantId, documentId: id, type: 'extract_text' });
  if (!queued.ok) {
    knowledgeDocumentQueries.delete.run(id, tenantId);
    return { status: 'deferred', reason: queued.reason };
  }
  return { status: 'queued', documentId: id };
}

function status() {
  const docsStmt = db.prepare(`
    SELECT status, COUNT(*) AS total
    FROM knowledge_documents
    ${tenantFilter ? 'WHERE tenant_id = @tenantId' : ''}
    GROUP BY status
    ORDER BY status
  `);
  const jobsStmt = db.prepare(`
    SELECT status, COUNT(*) AS total
    FROM knowledge_jobs
    ${tenantFilter ? 'WHERE tenant_id = @tenantId' : ''}
    GROUP BY status
    ORDER BY status
  `);
  const docs = tenantFilter ? docsStmt.all({ tenantId: tenantFilter }) : docsStmt.all();
  const jobs = tenantFilter ? jobsStmt.all({ tenantId: tenantFilter }) : jobsStmt.all();
  console.log('[knowledge] documents');
  console.table(docs);
  console.log('[knowledge] jobs');
  console.table(jobs);
}

function backfill() {
  const params = { tenantId: tenantFilter };
  const catalogStmt = db.prepare(`
    SELECT tenant_id, filename, content
    FROM catalog_files
    ${tenantFilter ? 'WHERE tenant_id = @tenantId' : ''}
  `);
  const extraStmt = db.prepare(`
    SELECT id, tenant_id, filename, mime, content
    FROM extra_documents
    ${tenantFilter ? 'WHERE tenant_id = @tenantId' : ''}
    ORDER BY created_at ASC
  `);
  const catalogRows = tenantFilter ? catalogStmt.all(params) : catalogStmt.all();
  const extraRows = tenantFilter ? extraStmt.all(params) : extraStmt.all();

  const result = { queued: 0, skipped: 0, deferred: 0 };
  for (const row of catalogRows) {
    const out = createKnowledgeDocument({
      tenantId: row.tenant_id,
      sourceType: 'catalog',
      sourceId: row.tenant_id,
      filename: row.filename || 'catalogo.pdf',
      mimeType: 'application/pdf',
      content: row.content,
    });
    result[out.status] = (result[out.status] || 0) + 1;
  }
  for (const row of extraRows) {
    const out = createKnowledgeDocument({
      tenantId: row.tenant_id,
      sourceType: 'extra_document',
      sourceId: row.id,
      filename: row.filename || 'documento.pdf',
      mimeType: row.mime || 'application/pdf',
      content: row.content,
    });
    result[out.status] = (result[out.status] || 0) + 1;
  }
  console.log('[knowledge] backfill', result);
}

function reindex() {
  const stmt = db.prepare(`
    SELECT id, tenant_id
    FROM knowledge_documents
    WHERE status != 'disabled'
      ${tenantFilter ? 'AND tenant_id = @tenantId' : ''}
    ORDER BY updated_at ASC
  `);
  const docs = tenantFilter ? stmt.all({ tenantId: tenantFilter }) : stmt.all();

  const result = { queued: 0, deferred: 0 };
  for (const doc of docs) {
    const out = enqueueDocument({ tenantId: doc.tenant_id, documentId: doc.id, type: 'rebuild_index' });
    if (out.ok) result.queued += 1;
    else result.deferred += 1;
  }
  console.log('[knowledge] reindex', result);
}

if (command === 'status') status();
else if (command === 'backfill') backfill();
else if (command === 'reindex') reindex();
else {
  console.error('Uso: node scripts/knowledge.mjs <status|backfill|reindex> [--tenant=TENANT_ID]');
  process.exitCode = 1;
}
