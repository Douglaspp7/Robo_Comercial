#!/usr/bin/env node
/**
 * Verifica a integridade do backup mais recente (ou de um caminho passado):
 *
 *   npm run backup:verify              → valida o backup mais novo em BACKUP_DIR
 *   node scripts/backup-verify.mjs x.db → valida um arquivo específico
 *
 * Checagens:
 *  - o arquivo existe e não está vazio;
 *  - PRAGMA integrity_check retorna "ok";
 *  - contém um número mínimo de tabelas essenciais (tenants, contacts,
 *    messages, sales) — pega backup de banco errado/truncado.
 *
 * Sai com código != 0 em qualquer falha (para uso em cron/CI operacional).
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REQUIRED_TABLES = ['tenants', 'contacts', 'messages', 'sales'];

function fail(msg) {
  console.error(`[backup:verify] FALHA: ${msg}`);
  process.exit(1);
}

let target = process.argv[2];
if (!target) {
  const backupDir = resolve(process.env.BACKUP_DIR || './data/backups');
  let files;
  try {
    files = readdirSync(backupDir)
      .filter((f) => f.startsWith('zapien-') && f.endsWith('.db'))
      .map((f) => ({ f, mtime: statSync(join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    fail(`diretório de backups não encontrado: ${backupDir}`);
  }
  if (!files.length) fail(`nenhum backup zapien-*.db em ${backupDir}. Rode npm run backup antes.`);
  target = join(backupDir, files[0].f);
}
target = resolve(target);

console.log(`[backup:verify] Verificando: ${target}`);

let size;
try {
  size = statSync(target).size;
} catch {
  fail(`arquivo não encontrado: ${target}`);
}
if (size === 0) fail('o arquivo de backup está vazio (0 bytes).');

let db;
try {
  db = new Database(target, { readonly: true });
} catch (err) {
  fail(`não foi possível abrir o backup como SQLite: ${err.message}`);
}

try {
  const integrity = db.pragma('integrity_check');
  const result = integrity?.[0]?.integrity_check;
  if (result !== 'ok') {
    fail(`integrity_check retornou: ${JSON.stringify(integrity).slice(0, 300)}`);
  }
  console.log('[backup:verify] integrity_check: ok');

  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map((r) => r.name);
  const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
  if (missing.length) {
    fail(`tabelas essenciais ausentes no backup: ${missing.join(', ')} (encontradas: ${tables.length}).`);
  }
  console.log(`[backup:verify] ${tables.length} tabelas, todas as essenciais presentes.`);
  console.log(`[backup:verify] OK — backup íntegro (${(size / 1024 / 1024).toFixed(2)} MB).`);
} finally {
  db.close();
}
