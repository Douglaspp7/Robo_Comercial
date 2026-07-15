import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {
  db,
  tenantQueries,
  subscriptionState,
  catalogFileQueries,
  extraDocumentQueries,
  knowledgeDocumentQueries,
  knowledgeChunkQueries,
  knowledgeJobQueries,
  knowledgeProductQueries,
} from '../db.js';
import { getPlanLimits } from '../plans.js';
import { normalizeBusiness } from '../business.js';
import { parseCatalogText } from '../ai.js';
import { createKnowledgeChunks } from './chunk.js';
import { extractPdfTextDirect, normalizeForSearch } from './text.js';

const SCANNED_PDF_MESSAGE =
  'Este PDF parece estar escaneado como imagem. Para a IA conseguir ler melhor, exporte o arquivo com texto pesquisavel ou aplique OCR antes de enviar.';

export const knowledgeWorkerConfig = {
  enabled: process.env.KNOWLEDGE_WORKER_ENABLED !== 'false',
  concurrency: Math.max(1, Number(process.env.KNOWLEDGE_WORKER_CONCURRENCY) || 1),
  maxPendingPerTenant: Math.max(1, Number(process.env.KNOWLEDGE_MAX_PENDING_PER_TENANT) || 2),
  lockTimeoutMs: Math.max(30_000, Number(process.env.KNOWLEDGE_LOCK_TIMEOUT_MS) || 300_000),
  maxAttempts: Math.max(1, Number(process.env.KNOWLEDGE_MAX_ATTEMPTS) || 3),
  retryBaseMs: Math.max(1_000, Number(process.env.KNOWLEDGE_RETRY_BASE_MS) || 10_000),
  processTimeoutMs: Math.max(30_000, Number(process.env.KNOWLEDGE_PROCESS_TIMEOUT_MS) || 300_000),
};

class KnowledgeRejectedError extends Error {
  constructor(message, code = 'limit_exceeded') {
    super(message);
    this.code = code;
    this.rejected = true;
  }
}

function isoAfter(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function recoverExpiredLocks() {
  const seconds = Math.ceil(knowledgeWorkerConfig.lockTimeoutMs / 1000);
  db.prepare(`
    UPDATE knowledge_jobs
    SET status = 'pending',
        next_attempt_at = datetime('now'),
        locked_at = NULL,
        lock_token = NULL,
        last_error = COALESCE(last_error, 'lock_expired')
    WHERE status = 'processing'
      AND locked_at < datetime('now', '-${seconds} seconds')
  `).run();
}

const reserveJobTx = db.transaction(() => {
  recoverExpiredLocks();
  const job = db.prepare(`
    SELECT *
    FROM knowledge_jobs j
    WHERE j.status = 'pending'
      AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= datetime('now'))
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_jobs running
        WHERE running.tenant_id = j.tenant_id
          AND running.status = 'processing'
      )
    ORDER BY j.created_at ASC
    LIMIT 1
  `).get();
  if (!job) return null;
  const lockToken = randomUUID();
  const info = db.prepare(`
    UPDATE knowledge_jobs
    SET status = 'processing',
        attempts = attempts + 1,
        locked_at = datetime('now'),
        lock_token = ?,
        started_at = COALESCE(started_at, datetime('now'))
    WHERE id = ? AND status = 'pending'
  `).run(lockToken, job.id);
  if (!info.changes) return null;
  return db.prepare(`SELECT * FROM knowledge_jobs WHERE id = ?`).get(job.id);
});

export function enqueueKnowledgeJob({ tenantId, documentId, type = 'extract_text' }) {
  const pending = db.prepare(`
    SELECT COUNT(*) AS n
    FROM knowledge_jobs
    WHERE tenant_id = ? AND status IN ('pending', 'processing')
  `).get(tenantId).n || 0;
  if (pending >= knowledgeWorkerConfig.maxPendingPerTenant) {
    return { ok: false, reason: 'tenant_pending_limit' };
  }
  const id = randomUUID();
  knowledgeJobQueries.insert.run({
    id,
    tenant_id: tenantId,
    document_id: documentId,
    type,
    status: 'pending',
    next_attempt_at: null,
  });
  knowledgeDocumentQueries.updateQueued.run(documentId);
  return { ok: true, id };
}

function getPlanForDocument(document) {
  const tenant = tenantQueries.byId.get(document.tenant_id);
  if (!tenant) throw new Error('Tenant nao encontrado para o documento.');
  return { tenant, limits: getPlanLimits(tenant.plan, subscriptionState(tenant).status) };
}

function sourcePageLimit(document, limits) {
  return document.source_type === 'catalog' ? limits.catalogPdfPages : limits.extraDocPages;
}

function getSourceBuffer(document) {
  if (document.source_type === 'catalog') {
    const file = catalogFileQueries.get.get(document.tenant_id);
    if (!file?.content) throw Object.assign(new Error('Arquivo de catalogo nao encontrado.'), { code: 'file_missing' });
    return Buffer.from(file.content);
  }
  const doc = extraDocumentQueries.get.get(document.source_id, document.tenant_id);
  if (!doc?.content) throw Object.assign(new Error('Documento extra nao encontrado.'), { code: 'file_missing' });
  return Buffer.from(doc.content);
}

function activeUsageExcludingSource(document) {
  return db.prepare(`
    SELECT COALESCE(SUM(indexed_pages), 0) AS pages,
           COALESCE(SUM(chunks_count), 0) AS chunks
    FROM knowledge_documents
    WHERE tenant_id = ?
      AND active = 1
      AND status IN ('ready', 'partial')
      AND NOT (
        source_type = ?
        AND COALESCE(source_id, '') = COALESCE(?, '')
      )
  `).get(document.tenant_id, document.source_type, document.source_id || '');
}

function validateLimits({ document, limits, extraction, chunks }) {
  const perFilePages = sourcePageLimit(document, limits);
  if (!perFilePages) {
    throw new KnowledgeRejectedError(`Documentos deste tipo nao estao disponiveis no plano ${limits.label}.`);
  }
  if (extraction.pageCount > perFilePages) {
    throw new KnowledgeRejectedError(
      `O plano ${limits.label} permite ate ${perFilePages} paginas para este arquivo. Este PDF tem ${extraction.pageCount} paginas.`,
      'pages_limit'
    );
  }
  const usage = activeUsageExcludingSource(document);
  if (usage.pages + extraction.pageCount > limits.knowledgePagesTotal) {
    throw new KnowledgeRejectedError(
      `A base de conhecimento do plano ${limits.label} permite ate ${limits.knowledgePagesTotal} paginas no total.`,
      'total_pages_limit'
    );
  }
  if (usage.chunks + chunks.length > limits.knowledgeChunksTotal) {
    throw new KnowledgeRejectedError(
      `A base de conhecimento do plano ${limits.label} atingiu o limite tecnico de trechos indexados.`,
      'total_chunks_limit'
    );
  }
}

function parsePdfInThread(buffer, { maxPages, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-worker-thread.js', import.meta.url), {
      workerData: { buffer, maxPages },
    });
    const timer = setTimeout(() => {
      worker.terminate().catch(() => {});
      reject(Object.assign(new Error('Tempo limite ao processar PDF.'), { code: 'pdf_timeout' }));
    }, timeoutMs);
    worker.once('message', (message) => {
      clearTimeout(timer);
      if (message.ok) resolve(message.result);
      else reject(Object.assign(new Error(message.error?.message || 'Erro ao processar PDF.'), {
        code: message.error?.code || 'pdf_processing_error',
      }));
    });
    worker.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    worker.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(Object.assign(new Error(`Worker de PDF finalizou com codigo ${code}.`), { code: 'pdf_worker_exit' }));
      }
    });
  });
}

async function defaultParsePdf(buffer, opts) {
  if (process.env.KNOWLEDGE_PDF_WORKER_THREADS === 'false') {
    return extractPdfTextDirect(buffer, opts);
  }
  return parsePdfInThread(buffer, { ...opts, timeoutMs: knowledgeWorkerConfig.processTimeoutMs });
}

function candidateProductPages(pages) {
  const re = /(R\$|\bpre[cç]o\b|\bsku\b|c[oó]digo|tamanho|varia[cç][aã]o|produto|servi[cç]o|unidade|tabela|\d+[,.]\d{2})/i;
  return pages.filter((page) => re.test(page.text));
}

function productBatches(pages, maxBatches) {
  const batches = [];
  let current = '';
  for (const page of pages) {
    const block = `Pagina ${page.number}\n${page.text}`;
    if (current && current.length + block.length > 8000) {
      batches.push(current);
      current = '';
      if (batches.length >= maxBatches) break;
    }
    current = current ? `${current}\n\n${block}` : block;
  }
  if (current && batches.length < maxBatches) batches.push(current);
  return batches;
}

function productDuplicateHints(tenant, products) {
  const existing = normalizeBusiness(tenant.business_json).produtos || [];
  const existingNames = new Map(existing.map((p) => [normalizeForSearch(p.nome || ''), p.nome || '']));
  return products.map((product) => {
    const key = normalizeForSearch(product?.nome || '');
    return {
      product,
      duplicate_hint: existingNames.get(key) || null,
    };
  });
}

async function extractCatalogProducts({ tenant, pages, limits, productExtractor }) {
  const candidates = candidateProductPages(pages);
  const batches = productBatches(candidates, limits.catalogProductExtractionBatches || 0);
  const products = [];
  for (const batch of batches) {
    const found = await productExtractor(batch);
    if (Array.isArray(found)) products.push(...found);
  }
  const seen = new Set();
  const deduped = [];
  for (const product of products) {
    const key = normalizeForSearch(`${product?.nome || ''} ${product?.codigo || ''}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(product);
  }
  return productDuplicateHints(tenant, deduped);
}

const replaceChunksTx = db.transaction((document, chunks) => {
  knowledgeChunkQueries.deleteByDocument.run(document.id);
  for (const chunk of chunks) {
    knowledgeChunkQueries.insert.run({
      tenant_id: document.tenant_id,
      document_id: document.id,
      ...chunk,
    });
  }
});

function markRejected(document, err) {
  knowledgeChunkQueries.deleteByDocument.run(document.id);
  knowledgeDocumentQueries.markFailed.run({
    id: document.id,
    status: 'rejected_limit',
    active: 0,
    progress_percent: 100,
    error_code: err.code || 'limit_exceeded',
    error_message: err.message,
  });
}

function markFailed(document, err) {
  knowledgeDocumentQueries.markFailed.run({
    id: document.id,
    status: 'failed',
    active: 0,
    progress_percent: 100,
    error_code: err.code || 'processing_error',
    error_message: err.message || 'Falha ao processar documento.',
  });
}

async function processExtractTextJob(job, { parsePdf = defaultParsePdf, productExtractor = parseCatalogText } = {}) {
  const document = knowledgeDocumentQueries.byId.get(job.document_id);
  if (!document || document.status === 'disabled') return;
  const { tenant, limits } = getPlanForDocument(document);
  const pageLimit = sourcePageLimit(document, limits);
  const buffer = getSourceBuffer(document);

  knowledgeDocumentQueries.updateProgress.run({ id: document.id, status: 'extracting', progress_percent: 20 });
  const extraction = await parsePdf(buffer, { maxPages: Math.max(1, pageLimit || 1) });
  const chunks = createKnowledgeChunks(extraction.pages);

  if (extraction.likelyScanned && chunks.length === 0) {
    const err = Object.assign(new Error(SCANNED_PDF_MESSAGE), { code: 'scanned_pdf' });
    markFailed(document, err);
    return;
  }
  if (!chunks.length) {
    const err = Object.assign(new Error('Nao foi encontrado texto pesquisavel neste PDF.'), { code: 'no_text' });
    markFailed(document, err);
    return;
  }

  validateLimits({ document, limits, extraction, chunks });

  knowledgeDocumentQueries.updateProgress.run({ id: document.id, status: 'indexing', progress_percent: 65 });
  replaceChunksTx(document, chunks);

  const finalStatus = extraction.likelyScanned ? 'partial' : 'ready';
  if (document.source_type === 'catalog') {
    knowledgeDocumentQueries.updateProgress.run({ id: document.id, status: 'extracting_products', progress_percent: 85 });
    try {
      const products = await extractCatalogProducts({ tenant, pages: extraction.pages, limits, productExtractor });
      knowledgeProductQueries.replaceForDocument(tenant.id, document.id, products);
    } catch (err) {
      console.warn('[knowledge] product extraction failed:', err.message);
    }
  }

  const finishTx = db.transaction(() => {
    knowledgeDocumentQueries.markReady.run({
      id: document.id,
      status: finalStatus,
      page_count: extraction.pageCount,
      indexed_pages: extraction.indexedPages,
      chunks_count: chunks.length,
      error_code: extraction.likelyScanned ? 'scanned_pdf' : null,
      error_message: extraction.likelyScanned ? SCANNED_PDF_MESSAGE : null,
    });
    knowledgeDocumentQueries.supersedeSource.run({
      tenant_id: document.tenant_id,
      source_type: document.source_type,
      source_id: document.source_id || '',
      new_id: document.id,
    });
  });
  finishTx();
}

async function processDeleteIndexJob(job) {
  knowledgeChunkQueries.deleteByDocument.run(job.document_id);
}

async function processJob(job, options) {
  if (job.type === 'extract_text' || job.type === 'rebuild_index' || job.type === 'extract_catalog_products') {
    await processExtractTextJob(job, options);
    return;
  }
  if (job.type === 'delete_index') {
    await processDeleteIndexJob(job);
  }
}

function failOrRetryJob(job, err) {
  const attempts = Number(job.attempts) || 1;
  const final = err.rejected || attempts >= knowledgeWorkerConfig.maxAttempts;
  const delay = knowledgeWorkerConfig.retryBaseMs * (2 ** Math.max(0, attempts - 1));
  knowledgeJobQueries.fail.run({
    id: job.id,
    status: final ? 'failed' : 'pending',
    next_attempt_at: final ? null : isoAfter(delay),
    last_error: err.message || String(err),
  });
  const document = knowledgeDocumentQueries.byId.get(job.document_id);
  if (!document) return;
  if (err.rejected) markRejected(document, err);
  else if (final) markFailed(document, err);
}

export async function processNextKnowledgeJob(options = {}) {
  const job = reserveJobTx();
  if (!job) return { processed: false };
  try {
    await processJob(job, options);
    knowledgeJobQueries.complete.run(job.id);
    return { processed: true, jobId: job.id };
  } catch (err) {
    failOrRetryJob(job, err);
    return { processed: true, jobId: job.id, error: err };
  }
}

export function knowledgeHealthMetrics() {
  const jobs = knowledgeJobQueries.metrics.get();
  const docs = knowledgeDocumentQueries.health.get();
  let search = { average_search_ms: 0 };
  try {
    search = db.prepare(`
      SELECT
        COUNT(*) AS samples,
        COALESCE(AVG(CAST(json_extract(props_json, '$.knowledge_search_ms') AS REAL)), 0) AS average_search_ms
      FROM conversion_events
      WHERE name = 'knowledge_search'
        AND created_at >= datetime('now', '-1 day')
    `).get();
  } catch {
    search = { average_search_ms: 0 };
  }
  return {
    jobs_pending: jobs?.pending || 0,
    jobs_processing: jobs?.processing || 0,
    jobs_failed: jobs?.failed || 0,
    documents_ready: docs?.documents_ready || 0,
    average_search_ms: Math.round(search?.average_search_ms || 0),
  };
}

export function startKnowledgeWorker() {
  if (!knowledgeWorkerConfig.enabled) {
    console.log('Worker de conhecimento desativado.');
    return { stop() {} };
  }
  let stopped = false;
  let running = 0;
  const tick = async () => {
    if (stopped) return;
    while (running < knowledgeWorkerConfig.concurrency) {
      running++;
      processNextKnowledgeJob()
        .catch((err) => console.error('[knowledge] worker:', err))
        .finally(() => { running--; });
    }
  };
  const timer = setInterval(tick, 2000);
  timer.unref();
  setTimeout(tick, 250).unref();
  console.log('Worker de conhecimento iniciado.');
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
