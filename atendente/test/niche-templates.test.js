import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NICHE_TEMPLATES, NICHE_IDS } from '../src/niche-templates.js';

test('NICHE_IDS reflete as chaves de NICHE_TEMPLATES', () => {
  assert.deepEqual(NICHE_IDS.sort(), Object.keys(NICHE_TEMPLATES).sort());
  assert.ok(NICHE_IDS.length >= 8);
});

test('cada nicho tem label e listas bem formadas de faqs/objeções/respostas/regras', () => {
  for (const id of NICHE_IDS) {
    const tpl = NICHE_TEMPLATES[id];
    assert.equal(typeof tpl.label, 'string');
    assert.ok(tpl.label.length > 0, `label vazio em ${id}`);

    assert.ok(Array.isArray(tpl.faqs), `faqs não é array em ${id}`);
    for (const f of tpl.faqs) {
      assert.equal(typeof f.pergunta, 'string');
      assert.equal(typeof f.resposta, 'string');
      assert.ok(f.pergunta.length > 0 && f.resposta.length > 0, `faq vazia em ${id}`);
    }

    assert.ok(Array.isArray(tpl.objecoes), `objecoes não é array em ${id}`);
    for (const o of tpl.objecoes) {
      assert.equal(typeof o.objecao, 'string');
      assert.equal(typeof o.resposta, 'string');
    }

    assert.ok(Array.isArray(tpl.respostas_rapidas), `respostas_rapidas não é array em ${id}`);
    assert.ok(tpl.respostas_rapidas.length > 0, `sem respostas rápidas em ${id}`);
    for (const r of tpl.respostas_rapidas) assert.equal(typeof r, 'string');

    assert.ok(Array.isArray(tpl.regras), `regras não é array em ${id}`);
  }
});

test('todos os nichos têm pelo menos 3 FAQs sugeridas', () => {
  for (const id of NICHE_IDS) {
    assert.ok(NICHE_TEMPLATES[id].faqs.length >= 3, `${id} tem menos de 3 FAQs`);
  }
});
