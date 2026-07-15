#!/usr/bin/env node
/**
 * scripts/backup.js
 *
 * Creates a timestamped SQLite backup using the SQLite Online Backup API
 * (via better-sqlite3's .backup() method), then optionally removes backups
 * older than BACKUP_RETAIN_DAYS (default: 30).
 *
 * Usage:
 *   node scripts/backup.js
 *
 * Env vars (read from .env if present):
 *   DATABASE_PATH       Path to the SQLite database (default: ./data/zapien.db)
 *   BACKUP_DIR          Where to store backups (default: ./data/backups)
 *   BACKUP_RETAIN_DAYS  How many days to keep backups (default: 30)
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dbPath = resolve(process.env.DATABASE_PATH || './data/zapien.db');
const backupDir = resolve(process.env.BACKUP_DIR || './data/backups');
const retainDays = Number(process.env.BACKUP_RETAIN_DAYS || 30);

mkdirSync(backupDir, { recursive: true });

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const destPath = join(backupDir, `zapien-${ts}.db`);

console.log(`[backup] Source:      ${dbPath}`);
console.log(`[backup] Destination: ${destPath}`);

const db = new Database(dbPath, { readonly: true });

try {
  await db.backup(destPath);
  console.log(`[backup] Backup completed successfully.`);
} finally {
  db.close();
}

// --- Prune old backups ---
const cutoffMs = retainDays * 24 * 60 * 60 * 1000;
const now = Date.now();
let pruned = 0;

for (const file of readdirSync(backupDir)) {
  if (!file.startsWith('zapien-') || !file.endsWith('.db')) continue;
  const filePath = join(backupDir, file);
  const { mtimeMs } = statSync(filePath);
  if (now - mtimeMs > cutoffMs) {
    rmSync(filePath);
    pruned++;
    console.log(`[backup] Pruned old backup: ${file}`);
  }
}

if (pruned === 0) {
  console.log(`[backup] No old backups to prune (retain ${retainDays} days).`);
} else {
  console.log(`[backup] Pruned ${pruned} old backup(s).`);
}
