import { createHash } from 'node:crypto';
import { normalizeForSearch, normalizeSpaces } from './text.js';

const DEFAULTS = {
  targetChars: 1200,
  minChars: 300,
  maxChars: 1800,
  overlapChars: 150,
};

function hashText(text) {
  return createHash('sha256').update(normalizeForSearch(text)).digest('hex');
}

function isSectionTitle(line) {
  const trimmed = line.trim();
  if (trimmed.length < 4 || trimmed.length > 90) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).length;
  if (words > 12) return false;
  return /[A-Za-zÀ-ÿ]/.test(trimmed);
}

function splitLongParagraph(text, maxChars) {
  const parts = [];
  let rest = normalizeSpaces(text);
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const sentenceBreak = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('! '),
      window.lastIndexOf('? '),
      window.lastIndexOf('; '),
      window.lastIndexOf('\n')
    );
    const cutAt = sentenceBreak > 300 ? sentenceBreak + 1 : maxChars;
    parts.push(normalizeSpaces(rest.slice(0, cutAt)));
    rest = normalizeSpaces(rest.slice(cutAt));
  }
  if (rest) parts.push(rest);
  return parts;
}

function pageBlocks(page) {
  const lines = normalizeSpaces(page.text).split('\n');
  const blocks = [];
  let current = [];
  let section = '';

  function flush() {
    const text = normalizeSpaces(current.join('\n'));
    if (text) blocks.push({ text, section, page: page.number });
    current = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (isSectionTitle(trimmed)) {
      flush();
      section = trimmed;
      current.push(trimmed);
      continue;
    }
    current.push(trimmed);
  }
  flush();
  return blocks;
}

function tailOverlap(text, overlapChars) {
  if (!text || text.length <= overlapChars) return text || '';
  const tail = text.slice(-overlapChars);
  const breakAt = Math.min(
    ...[tail.indexOf('. '), tail.indexOf('\n'), tail.indexOf('; ')]
      .filter((n) => n >= 0)
      .map((n) => n + 1)
  );
  if (Number.isFinite(breakAt) && breakAt < tail.length - 20) return normalizeSpaces(tail.slice(breakAt));
  return normalizeSpaces(tail);
}

export function createKnowledgeChunks(pages, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const chunks = [];
  const seen = new Set();
  let current = null;

  function start(block, prefix = '') {
    current = {
      text: normalizeSpaces([prefix, block.text].filter(Boolean).join('\n')),
      section: block.section || null,
      pageFrom: block.page,
      pageTo: block.page,
    };
  }

  function flush() {
    if (!current) return;
    const content = normalizeSpaces(current.text);
    if (!content) {
      current = null;
      return;
    }
    const normalized = normalizeForSearch(content);
    const hash = hashText(content);
    if (!seen.has(hash)) {
      seen.add(hash);
      chunks.push({
        page_from: current.pageFrom,
        page_to: current.pageTo,
        section_title: current.section,
        content,
        normalized_content: normalized,
        content_hash: hash,
        metadata_json: JSON.stringify({ target_chars: opts.targetChars, overlap_chars: opts.overlapChars }),
      });
    }
    current = null;
  }

  for (const page of pages || []) {
    for (const block of pageBlocks(page)) {
      const pieces = splitLongParagraph(block.text, opts.maxChars);
      for (const piece of pieces) {
        const blockPiece = { ...block, text: piece };
        if (!current) {
          start(blockPiece);
          continue;
        }
        const nextText = normalizeSpaces(`${current.text}\n\n${piece}`);
        if (nextText.length > opts.maxChars || (current.text.length >= opts.targetChars && piece.length >= opts.minChars)) {
          const overlap = tailOverlap(current.text, opts.overlapChars);
          flush();
          start(blockPiece, overlap);
        } else {
          current.text = nextText;
          current.pageTo = block.page;
          current.section = current.section || block.section || null;
        }
      }
    }
  }
  flush();

  const last = chunks[chunks.length - 1];
  const prev = chunks[chunks.length - 2];
  if (last && prev && last.content.length < opts.minChars && prev.content.length + last.content.length <= opts.maxChars) {
    prev.content = normalizeSpaces(`${prev.content}\n\n${last.content}`);
    prev.normalized_content = normalizeForSearch(prev.content);
    prev.content_hash = hashText(prev.content);
    prev.page_to = Math.max(prev.page_to || 0, last.page_to || 0);
    chunks.pop();
  }

  return chunks;
}
