import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'robo-schedule-readiness-'));
process.env.WORKER_DB_PATH = path.join(testDir, 'worker.sqlite');

const { campaignReadiness } = await import('../src/scheduler.js');

test('pré-checagem libera campanha pronta', () => {
  assert.deepEqual(campaignReadiness({ connected: 2, attendantConfigured: true, items: 40 }), { ready: true, reason: '' });
});

test('pré-checagem bloqueia sem chip ou atendente', () => {
  assert.equal(campaignReadiness({ connected: 0, attendantConfigured: true, items: 40 }).ready, false);
  assert.match(campaignReadiness({ connected: 2, attendantConfigured: false, items: 40 }).reason, /atendente/);
});

test('pré-checagem bloqueia criativo ausente', () => {
  const result = campaignReadiness({ connected: 1, attendantConfigured: true, items: 10, imageRequired: true, imageAvailable: false });
  assert.equal(result.ready, false);
  assert.match(result.reason, /criativo/);
});
