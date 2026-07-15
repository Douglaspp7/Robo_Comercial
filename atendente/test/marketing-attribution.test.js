import './_setup.js'; // Configura env vars e caminho do banco isolado antes de qualquer import
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import {
  db,
  tenantQueries,
  marketingLinkQueries,
  attributionClickQueries,
  contactAttributionQueries,
  marketingConversionQueries,
  conversionJobQueries,
  contactQueries,
  saleQueries,
} from '../src/db.js';
import { emitDomainEvent } from '../src/domain-events.js';
import { evaluateCondition } from '../src/automations/engine.js';
import {
  hashPhone,
  hashValue,
  startConversionWorker,
  stopConversionWorker,
  drainConversionsForTesting,
  _resetForTesting,
} from '../src/meta-capi.js';

describe('PR 1 — Marketing e Atribuição', () => {
  let tenantId = 'tnt_test_capi_123';
  let otherTenantId = 'tnt_test_other_456';
  let contactId;

  before(() => {
    // Inicializa tenants de teste
    db.prepare(`
      INSERT OR REPLACE INTO tenants (id, email, password_hash, business_name, routing_slug, active, plan, subscription_status, capi_enabled, capi_pixel_id, capi_access_token)
      VALUES (?, ?, ?, ?, ?, 1, 'elite', 'active', 1, '1234567890', 'test-access-token')
    `).run(tenantId, 'loja@teste.com', 'hash', 'Minha Loja de Teste', 'minhaloja');

    db.prepare(`
      INSERT OR REPLACE INTO tenants (id, email, password_hash, business_name, routing_slug, active, plan, subscription_status, capi_enabled, capi_pixel_id, capi_access_token)
      VALUES (?, ?, ?, ?, ?, 1, 'free', 'active', 0, NULL, NULL)
    `).run(otherTenantId, 'outra@teste.com', 'hash', 'Outra Loja', 'outraloja');
  });

  beforeEach(() => {
    _resetForTesting();
    db.prepare(`DELETE FROM marketing_conversions`).run();
    db.prepare(`DELETE FROM conversion_delivery_jobs`).run();
    db.prepare(`DELETE FROM attribution_clicks`).run();
    db.prepare(`DELETE FROM contact_attributions`).run();
    db.prepare(`DELETE FROM marketing_links`).run();
    db.prepare(`DELETE FROM contacts`).run();
    db.prepare(`DELETE FROM sales`).run();

    const res = db.prepare(`
      INSERT INTO contacts (tenant_id, wa_phone, name, lead_source)
      VALUES (?, ?, ?, 'whatsapp_direto')
    `).run(tenantId, '5511999999999', 'Douglas');
    contactId = res.lastInsertRowid;
  });

  test('Deve criar, listar e duplicar links de marketing', () => {
    const linkId = 'mlk_test_1';
    marketingLinkQueries.insert.run({
      id: linkId,
      tenant_id: tenantId,
      name: 'Campanha de Natal',
      slug: 'natal2026',
      source: 'instagram',
      medium: 'stories',
      campaign: 'natal',
      content: 'link_bio',
      term: 'compre_ja',
      meta_campaign_id: 'c123',
      meta_adset_id: 'as123',
      meta_ad_id: 'ad123',
      notes: 'Notas de teste',
      active: 1,
    });

    const link = marketingLinkQueries.byId.get(linkId, tenantId);
    assert.ok(link);
    assert.strictEqual(link.slug, 'natal2026');
    assert.strictEqual(link.source, 'instagram');

    // Duplicar link
    const newSlug = 'natal2026-copia';
    const dupId = 'mlk_test_2';
    marketingLinkQueries.insert.run({
      id: dupId,
      tenant_id: tenantId,
      name: 'Campanha de Natal (Cópia)',
      slug: newSlug,
      source: link.source,
      medium: link.medium,
      campaign: link.campaign,
      content: link.content,
      term: link.term,
      meta_campaign_id: link.meta_campaign_id,
      meta_adset_id: link.meta_adset_id,
      meta_ad_id: link.meta_ad_id,
      notes: link.notes,
      active: link.active,
    });

    const dup = marketingLinkQueries.byId.get(dupId, tenantId);
    assert.ok(dup);
    assert.strictEqual(dup.slug, 'natal2026-copia');
  });

  test('Deve gravar clique de marketing e vincular ao contato nas tabelas de atribuição', () => {
    const linkId = 'mlk_test_3';
    marketingLinkQueries.insert.run({
      id: linkId,
      tenant_id: tenantId,
      name: 'Parceria de Influencer',
      slug: 'influencer',
      source: 'tiktok',
      medium: 'influencer',
      campaign: 'promo',
      content: null,
      term: null,
      meta_campaign_id: null,
      meta_adset_id: null,
      meta_ad_id: null,
      notes: null,
      active: 1,
    });

    const token = 'A1B2C3';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const clickId = 'cli_test_1';

    attributionClickQueries.insert.run({
      id: clickId,
      tenant_id: tenantId,
      marketing_link_id: linkId,
      entry_token_hash: tokenHash,
      anonymous_session_id: 'anon-session-123',
      fbclid: 'fb-click-123',
      gclid: 'g-click-123',
      ttclid: 'tt-click-123',
      msclkid: null,
      referrer: 'https://tiktok.com/influencer',
      user_agent_summary: 'Mozilla/5.0',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
    });

    // Simula a vinculação manual que ocorreria no webhook ao receber o token
    const click = attributionClickQueries.byTokenHash.get(tokenHash);
    assert.ok(click);
    assert.strictEqual(click.fbclid, 'fb-click-123');

    // Associa clique ao contato
    attributionClickQueries.linkContact.run(contactId, click.id);

    // Cria contact attribution
    const attrId = 'cat_test_1';
    contactAttributionQueries.insert.run({
      id: attrId,
      tenant_id: tenantId,
      contact_id: contactId,
      first_touch_click_id: click.id,
      last_touch_click_id: click.id,
      first_touch_at: new Date().toISOString(),
      last_touch_at: new Date().toISOString(),
    });

    // Atualiza o lead_source do contato
    const linkRow = marketingLinkQueries.byId.get(click.marketing_link_id, tenantId);
    contactQueries.setLeadSource.run(linkRow.source, linkRow.campaign || linkRow.medium || null, contactId);

    const updatedContact = contactQueries.byId.get(contactId);
    assert.strictEqual(updatedContact.lead_source, 'tiktok');
    assert.strictEqual(updatedContact.lead_source_detail, 'promo');

    // Valida a busca de atribuições nas views
    const attr = contactAttributionQueries.get.get(contactId, tenantId);
    assert.ok(attr);
    assert.strictEqual(attr.first_touch_click_id, click.id);
    assert.strictEqual(attr.last_touch_click_id, click.id);
  });

  test('Deve disparar eventos de conversão e enfileirar jobs do Conversions API', () => {
    const linkId = 'mlk_test_4';
    marketingLinkQueries.insert.run({
      id: linkId,
      tenant_id: tenantId,
      name: 'Google Ads Search',
      slug: 'googleads',
      source: 'google',
      medium: 'cpc',
      campaign: 'pesquisa',
      content: null,
      term: null,
      meta_campaign_id: null,
      meta_adset_id: null,
      meta_ad_id: null,
      notes: null,
      active: 1,
    });

    // Cria clique associado
    const token = 'T3K4N5';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const clickId = 'cli_test_2';
    attributionClickQueries.insert.run({
      id: clickId,
      tenant_id: tenantId,
      marketing_link_id: linkId,
      entry_token_hash: tokenHash,
      anonymous_session_id: 'anon-session-456',
      fbclid: 'fb-click-456',
      gclid: null,
      ttclid: null,
      msclkid: null,
      referrer: 'https://google.com',
      user_agent_summary: 'Mozilla/5.0',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
    });

    // Vincula contato e atribuição
    attributionClickQueries.linkContact.run(contactId, clickId);
    contactAttributionQueries.insert.run({
      id: 'cat_test_2',
      tenant_id: tenantId,
      contact_id: contactId,
      first_touch_click_id: clickId,
      last_touch_click_id: clickId,
      first_touch_at: new Date().toISOString(),
      last_touch_at: new Date().toISOString(),
    });

    // 1. Evento contact_created -> Lead
    emitDomainEvent({
      tenantId: tenantId,
      type: 'contact_created',
      entityType: 'contact',
      entityId: contactId,
      payload: { lead_source: 'google' },
    });

    // Verifica se evento Lead foi salvo
    const leadEvt = db.prepare(`SELECT * FROM marketing_conversions WHERE tenant_id = ? AND event_name = 'Lead'`).get(tenantId);
    assert.ok(leadEvt);
    assert.strictEqual(leadEvt.contact_id, contactId);
    assert.strictEqual(leadEvt.marketing_link_id, linkId);

    // Verifica se job de CAPI foi enfileirado
    const leadJob = db.prepare(`SELECT * FROM conversion_delivery_jobs WHERE tenant_id = ? AND conversion_event_id = ?`).get(tenantId, leadEvt.id);
    assert.ok(leadJob);
    assert.strictEqual(leadJob.status, 'pending');

    // 2. Evento buy_intent_changed -> QualifiedLead
    emitDomainEvent({
      tenantId: tenantId,
      type: 'buy_intent_changed',
      entityType: 'contact',
      entityId: contactId,
      payload: { old_intent: 'baixa', new_intent: 'alta' },
    });

    const qualEvt = db.prepare(`SELECT * FROM marketing_conversions WHERE tenant_id = ? AND event_name = 'QualifiedLead'`).get(tenantId);
    assert.ok(qualEvt);
    const qualJob = db.prepare(`SELECT * FROM conversion_delivery_jobs WHERE tenant_id = ? AND conversion_event_id = ?`).get(tenantId, qualEvt.id);
    assert.ok(qualJob);

    // 3. Evento checkout_sent -> InitiateCheckout
    const saleId = 'sal_test_123';
    saleQueries.insert.run(saleId, tenantId, contactId, 'pending', 150.00, '[]', null, 15000, '[]');

    emitDomainEvent({
      tenantId: tenantId,
      type: 'checkout_sent',
      entityType: 'sale',
      entityId: saleId,
      payload: {},
    });

    const checkEvt = db.prepare(`SELECT * FROM marketing_conversions WHERE tenant_id = ? AND event_name = 'InitiateCheckout'`).get(tenantId);
    assert.ok(checkEvt);
    assert.strictEqual(checkEvt.value_cents, 15000);

    // 4. Evento sale_paid -> Purchase
    db.prepare(`UPDATE sales SET status = 'paid', paid_at = datetime('now') WHERE id = ?`).run(saleId);
    emitDomainEvent({
      tenantId: tenantId,
      type: 'sale_paid',
      entityType: 'sale',
      entityId: saleId,
      payload: {},
    });

    const purcEvt = db.prepare(`SELECT * FROM marketing_conversions WHERE tenant_id = ? AND event_name = 'Purchase'`).get(tenantId);
    assert.ok(purcEvt);
    assert.strictEqual(purcEvt.value_cents, 15000);
  });

  test('Deve avaliar condições de marketing corretamente no engine de automações', () => {
    // Configura atribuição no contato
    const linkId = 'mlk_test_5';
    marketingLinkQueries.insert.run({
      id: linkId,
      tenant_id: tenantId,
      name: 'Campanha de Black Friday',
      slug: 'blackfriday',
      source: 'meta_ads',
      medium: 'paid_social',
      campaign: 'bf26',
      content: null,
      term: null,
      meta_campaign_id: null,
      meta_adset_id: null,
      meta_ad_id: null,
      notes: null,
      active: 1,
    });

    const clickId = 'cli_test_5';
    attributionClickQueries.insert.run({
      id: clickId,
      tenant_id: tenantId,
      marketing_link_id: linkId,
      entry_token_hash: 'somehash',
      anonymous_session_id: 'session-bf',
      fbclid: 'fbc-bf',
      gclid: null,
      ttclid: null,
      msclkid: null,
      referrer: 'https://facebook.com',
      user_agent_summary: 'Mozilla/5.0',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
    });

    attributionClickQueries.linkContact.run(contactId, clickId);
    contactAttributionQueries.insert.run({
      id: 'cat_test_5',
      tenant_id: tenantId,
      contact_id: contactId,
      first_touch_click_id: clickId,
      last_touch_click_id: clickId,
      first_touch_at: new Date().toISOString(),
      last_touch_at: new Date().toISOString(),
    });

    const tenant = tenantQueries.byId.get(tenantId);
    const contact = contactQueries.byId.get(contactId);

    // Condição: marketing_source_equals
    const res1 = evaluateCondition(
      { type: 'marketing_source_equals', value: 'meta_ads' },
      { tenant, contact }
    );
    assert.strictEqual(res1.pass, true);

    const res1Fail = evaluateCondition(
      { type: 'marketing_source_equals', value: 'google' },
      { tenant, contact }
    );
    assert.strictEqual(res1Fail.pass, false);

    // Condição: marketing_campaign_equals
    const res2 = evaluateCondition(
      { type: 'marketing_campaign_equals', value: 'bf26' },
      { tenant, contact }
    );
    assert.strictEqual(res2.pass, true);

    // Condição: marketing_link_equals
    const res3 = evaluateCondition(
      { type: 'marketing_link_equals', value: 'blackfriday' },
      { tenant, contact }
    );
    assert.strictEqual(res3.pass, true);

    // Condição: has_attribution
    const res4 = evaluateCondition(
      { type: 'has_attribution' },
      { tenant, contact }
    );
    assert.strictEqual(res4.pass, true);

    // Condição: attribution_model_equals
    const res5 = evaluateCondition(
      { type: 'attribution_model_equals', value: 'last_touch' },
      { tenant, contact }
    );
    assert.strictEqual(res5.pass, true);
  });

  test('Normalização e hash CAPI de dados do usuário', () => {
    assert.strictEqual(hashValue(' Douglas '), hashValue('douglas'));
    assert.strictEqual(hashPhone(' +55 (11) 99999-9999 '), hashPhone('5511999999999'));
    assert.strictEqual(hashPhone(''), null);
    assert.strictEqual(hashValue(null), null);
  });
});
