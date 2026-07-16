#!/usr/bin/env node
/**
 * Build de assets estáticos da landing (npm run build):
 *
 *  1. VALIDA que todo CSS/JS/imagem local referenciado no HTML existe em disco
 *     (falha o build se algo estiver quebrado);
 *  2. CACHE BUSTING automático: reescreve referências de CSS/JS locais para
 *     `arquivo.ext?v=<hash8>` com hash sha1 do conteúdo — substitui as versões
 *     manuais tipo "?v=market-stats-20260711b". Idempotente: rodar de novo só
 *     muda o hash se o arquivo mudou.
 *
 * O servidor (src/server.js) serve requisições com ?v=<hash> com
 * `Cache-Control: public, max-age=31536000, immutable`; sem hash, cache curto.
 * Sem bundler: o servidor Node continua servindo os mesmos arquivos.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');

// HTML processados: caminho + diretório-base para refs relativas.
// A landing xlander existia no projeto antigo e pode não fazer parte de uma
// instalação atual. A tela de integrações é obrigatória porque concentra as
// conexões OAuth e precisa sempre receber o hash novo no deploy.
const PAGES = [
  { file: join(publicDir, 'xlander', 'index.html'), baseDir: join(publicDir, 'xlander'), optional: true },
  { file: join(publicDir, 'integrations.html'), baseDir: publicDir },
];

const REF_RE = /(src|href)="([^"]+)"/g;
const VERSIONABLE = /\.(css|js)(\?|$)/i;
const CHECKABLE = /\.(css|js|png|jpe?g|webp|svg|gif|ico|mp4|webm|woff2?)(\?|$)/i;

let errors = 0;
let versioned = 0;

function resolveLocal(ref, baseDir) {
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:') || ref.startsWith('mailto:') || ref.startsWith('#')) {
    return null; // externo/âncora — fora do escopo
  }
  const clean = ref.split(/[?#]/)[0];
  if (!clean) return null;
  return clean.startsWith('/') ? join(publicDir, clean) : join(baseDir, clean);
}

function hash8(path) {
  return createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 8);
}

for (const page of PAGES) {
  if (!existsSync(page.file)) {
    if (page.optional) {
      console.log(`[build] página opcional ausente, ignorada: ${page.file}`);
      continue;
    }
    console.error(`[build] ERRO: página não encontrada: ${page.file}`);
    errors++;
    continue;
  }
  let html = readFileSync(page.file, 'utf8');
  let pageVersioned = 0;

  html = html.replace(REF_RE, (full, attr, ref) => {
    const local = resolveLocal(ref, page.baseDir);
    if (!local || !CHECKABLE.test(ref)) return full;

    if (!existsSync(local)) {
      console.error(`[build] ERRO: asset referenciado não existe: ${ref} (em ${page.file})`);
      errors++;
      return full;
    }
    if (!VERSIONABLE.test(ref)) return full;

    const clean = ref.split(/[?#]/)[0];
    const next = `${clean}?v=${hash8(local)}`;
    if (next !== ref) {
      versioned++;
      pageVersioned++;
    }
    return `${attr}="${next}"`;
  });

  writeFileSync(page.file, html);
  console.log(`[build] ${page.file.replace(root + '/', '')}: refs validadas, ${pageVersioned} com hash de cache.`);
}

if (errors > 0) {
  console.error(`\n[build] FALHOU com ${errors} erro(s).`);
  process.exit(1);
}
console.log('[build] OK.');
