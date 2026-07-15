import { createHash } from 'node:crypto';
import { PDFParse } from 'pdf-parse';

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function normalizeSpaces(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeForSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lineKey(line) {
  return normalizeForSearch(line).slice(0, 120);
}

function repeatedLineKeys(pages) {
  const counts = new Map();
  for (const page of pages) {
    const seen = new Set();
    const lines = normalizeSpaces(page.text).split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.length > 120) continue;
      const key = lineKey(line);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.6));
  return new Set([...counts.entries()].filter(([, count]) => count >= threshold).map(([key]) => key));
}

function cleanPageText(text, repeated) {
  const lines = normalizeSpaces(text).split('\n');
  return normalizeSpaces(lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    const key = lineKey(trimmed);
    return !(trimmed.length <= 120 && repeated.has(key));
  }).join('\n'));
}

function detectLikelyScannedPdf(pages, pageCount) {
  const totalChars = pages.reduce((sum, page) => sum + page.text.replace(/\s/g, '').length, 0);
  const avgChars = totalChars / Math.max(1, pageCount || pages.length);
  const emptyPages = pages.filter((page) => page.text.replace(/\s/g, '').length < 40).length;
  return totalChars < 80 || (pageCount >= 3 && avgChars < 120) || (pages.length >= 3 && emptyPages / pages.length > 0.7);
}

export function mapPdfError(err) {
  const message = String(err?.message || err || '');
  if (/password|encrypted|PasswordException/i.test(message)) {
    return {
      code: 'password_protected',
      message: 'Este PDF esta protegido por senha. Envie uma versao sem senha para a IA conseguir ler.',
    };
  }
  if (/InvalidPDF|corrupt|parse|xref|format|trailer/i.test(message)) {
    return {
      code: 'corrupt_pdf',
      message: 'Nao foi possivel ler este PDF. O arquivo pode estar corrompido ou fora do padrao.',
    };
  }
  return {
    code: 'pdf_processing_error',
    message: 'Nao foi possivel processar este PDF com seguranca.',
  };
}

export async function extractPdfTextDirect(buffer, { maxPages = 250 } = {}) {
  const pageLimit = Math.max(1, Number(maxPages) || 1);
  const parser = new PDFParse({ data: Buffer.from(buffer) });
  try {
    const result = await parser.getText({ first: pageLimit });
    const rawPages = (result.pages || []).map((page, index) => ({
      number: Number(page.num) || index + 1,
      text: normalizeSpaces(page.text || ''),
    }));
    const repeated = repeatedLineKeys(rawPages);
    const pages = rawPages
      .map((page) => ({ ...page, text: cleanPageText(page.text, repeated) }))
      .filter((page) => page.text.replace(/\s/g, '').length > 0);
    return {
      pageCount: Number(result.total) || rawPages.length,
      indexedPages: Math.min(Number(result.total) || rawPages.length, pageLimit),
      pages,
      likelyScanned: detectLikelyScannedPdf(pages, Number(result.total) || rawPages.length),
    };
  } catch (err) {
    const mapped = mapPdfError(err);
    const wrapped = new Error(mapped.message);
    wrapped.code = mapped.code;
    throw wrapped;
  } finally {
    await Promise.resolve(parser.destroy()).catch(() => {});
  }
}
