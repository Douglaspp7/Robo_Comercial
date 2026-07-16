import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'robo-followup-'));
process.env.WORKER_DB_PATH = path.join(testDir, 'worker.sqlite');

const { db, createCampaign, queries } = await import('../src/db.js');
const { addLeads, leadQueries, reviewLeads, recordLeadResponse, followupQueries } = await import('../src/leads.js');

function campaignFor(phone, name) {
  addLeads([{ id: name, name, phone, source: 'google', segment: 'varejo', website: `https://${name}.example.com`, address: 'São Paulo, SP' }]);
  const lead = leadQueries.reviewList.all({ limit: 20 }).find((item) => item.company_name === name);
  reviewLeads([{ ...lead, review_status: 'approved' }]);
  const { id } = createCampaign({ name, message: 'Primeira', followup_enabled: true, followup_delay_hours: 24, followup_message: 'Última tentativa' },
    [{ lead_id: lead.dedup_key, name, phone, jid: lead.dedup_key }]);
  const item = db.prepare('SELECT * FROM campaign_items WHERE campaign_id=?').get(id);
  queries.markSent.run({ id: item.id, ts: Date.now() - 25 * 3600000 });
  return { lead, item };
}

test('libera somente um acompanhamento depois do prazo', () => {
  const { item } = campaignFor('11977776666', 'Loja Followup');
  const claimed = followupQueries.claim.get({ number_id: 'chip-1', now: Date.now() });
  assert.equal(claimed.id, item.id);
  queries.markFollowupSent.run({ id: item.id, ts: Date.now() });
  assert.equal(followupQueries.claim.get({ number_id: 'chip-1', now: Date.now() }), undefined);
});

test('resposta cancela acompanhamento antes do envio', () => {
  const { lead, item } = campaignFor('11966665555', 'Loja Respondeu');
  recordLeadResponse(lead.dedup_key);
  followupQueries.cancelIneligible.run();
  const updated = db.prepare('SELECT followup_status FROM campaign_items WHERE id=?').get(item.id);
  assert.equal(updated.followup_status, 'cancelled');
});
