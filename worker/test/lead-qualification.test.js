import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.WORKER_DB_PATH = path.join(os.tmpdir(), `robo-lead-qualification-${process.pid}.sqlite`);

const { addLeads, leadQueries, pendingWhatsappLeads, questionFor, reviewLeads } = await import('../src/leads.js');

test('pergunta inicial é específica para imobiliárias', () => {
  assert.match(questionFor('imobiliárias'), /imóvel/);
});

test('lead novo exige aprovação e nome sem evidência não é usado', () => {
  addLeads([{ id: 'imob-1', name: 'Imobiliária Horizonte', phone: '11999998888', source: 'google', segment: 'imobiliárias' }]);
  const lead = leadQueries.reviewList.all({ limit: 10 }).find((item) => item.company_name === 'Imobiliária Horizonte');
  assert.equal(lead.review_status, 'review');
  assert.equal(lead.contact_name, '');
  assert.equal(pendingWhatsappLeads().length, 0);

  reviewLeads([{ ...lead, review_status: 'approved' }], 'admin');
  const pending = pendingWhatsappLeads();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].contact_name, '');
  assert.match(pending[0].opening_question, /imóvel/);
});

test('aprovação é recusada sem pergunta ou evidência', () => {
  const lead = leadQueries.reviewList.all({ limit: 10 })[0];
  reviewLeads([{ ...lead, opening_question: '', review_status: 'approved' }], 'admin');
  const updated = leadQueries.reviewList.all({ limit: 10 }).find((item) => item.dedup_key === lead.dedup_key);
  assert.equal(updated.review_status, 'review');
});
