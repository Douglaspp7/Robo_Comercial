import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'robo-lead-qualification-'));
process.env.WORKER_DB_PATH = path.join(testDir, 'worker.sqlite');

const { addLeads, leadQueries, pendingWhatsappLeads, questionFor, reviewLeads } = await import('../src/leads.js');

test('qualificação multicanal explica a nota e recomenda WhatsApp', () => {
  addLeads([{ id: 'clinic-score', name: 'Clínica Viva', phone: '11988887777', email: 'contato@clinicaviva.com.br', website: 'https://clinicaviva.com.br', source_url: 'https://maps.google.com/clinicaviva', address: 'São Paulo, SP', rating: 4.8, source: 'google', segment: 'clínica estética' }]);
  const lead = leadQueries.reviewList.all({ limit: 20 }).find((item) => item.company_name === 'Clínica Viva');
  assert.equal(lead.lead_score, 100);
  assert.equal(lead.recommended_channel, 'whatsapp');
  assert.deepEqual(JSON.parse(lead.available_channels), ['whatsapp', 'email', 'site']);
  assert.match(lead.score_reasons, /telefone comercial/);
});

test('contato fraco fica bloqueado preventivamente', () => {
  addLeads([{ id: 'weak-email', name: 'Contato sem evidência', email: 'contato@example.com', source: 'unknown' }]);
  const lead = leadQueries.reviewList.all({ limit: 20 }).find((item) => item.company_name === 'Contato sem evidência');
  assert.equal(lead.review_status, 'blocked');
  assert.equal(lead.recommended_channel, 'review');
});

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
