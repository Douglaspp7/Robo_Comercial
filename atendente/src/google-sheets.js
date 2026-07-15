import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { db, tenantIntegrationQueries, contactTagQueries } from './db.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import { getRevenueRadar } from './opportunities.js';
import { normalizeBusiness } from './business.js';

const PROVIDER = 'google_sheets';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SHEET_TABS = ['Clientes', 'Vendas', 'Oportunidades', 'Lista de espera'];

const HEADERS = {
  Clientes: ['Data de criação', 'Nome', 'WhatsApp', 'Etapa', 'Intenção de compra', 'Produto mencionado', 'Origem', 'Tags', 'Última interação', 'Próxima ação', 'Precisa de humano'],
  Vendas: ['Data', 'Cliente', 'WhatsApp', 'Produto', 'Valor', 'Status', 'Link de pagamento', 'Provedor', 'ID da venda', 'Última atualização'],
  Oportunidades: ['Data', 'Tipo', 'Cliente', 'WhatsApp', 'Produto', 'Valor estimado', 'Motivo', 'Mensagem sugerida', 'Status'],
  'Lista de espera': ['Data', 'Produto', 'Cliente', 'WhatsApp', 'Status', 'Avisado em'],
};

function googleConfigured() {
  return Boolean(config.google?.clientId && config.google?.clientSecret);
}

function redirectUri() {
  return config.google?.redirectUri || `${config.appUrl.replace(/\/$/, '')}/api/google-sheets/oauth/callback`;
}

export function googleSheetsEnabled() {
  return googleConfigured();
}

export function googleOAuthState(sessionToken) {
  return createHmac('sha256', config.sessionSecret).update(`google_sheets:${sessionToken}`).digest('hex');
}

export function verifyGoogleOAuthState(sessionToken, state) {
  const stateNorm = typeof state === 'string' ? state.toLowerCase() : '';
  const expected = googleOAuthState(sessionToken);
  return stateNorm.length === expected.length && /^[0-9a-f]+$/.test(stateNorm) && timingSafeEqual(Buffer.from(stateNorm, 'hex'), Buffer.from(expected, 'hex'));
}

export function googleOAuthUrl(sessionToken) {
  if (!googleConfigured()) throw new Error('Google Sheets não configurado.');
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SHEETS_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: googleOAuthState(sessionToken),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function googleFetch(path, token, options = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error?.message || data.error_description || `Erro Google Sheets (${res.status})`);
  return data;
}

async function exchangeCode(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Não foi possível conectar ao Google Sheets.');
  return data;
}

async function refreshAccessToken(row) {
  const refreshToken = decryptSecret(row.refresh_token);
  if (!refreshToken) throw new Error('Conecte o Google Sheets novamente.');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Não foi possível renovar a conexão com o Google.');
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
  tenantIntegrationQueries.setTokens.run({
    tenant_id: row.tenant_id,
    provider: PROVIDER,
    access_token: encryptSecret(data.access_token),
    refresh_token: null,
    expires_at: expiresAt,
  });
  return data.access_token;
}

async function accessTokenForTenant(tenantId) {
  const row = tenantIntegrationQueries.get.get(tenantId, PROVIDER);
  if (!row) throw new Error('Google Sheets não conectado.');
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAt && expiresAt < Date.now() + 60_000) return refreshAccessToken(row);
  return decryptSecret(row.access_token);
}

async function ensureSpreadsheet(tenant, token, existing = null) {
  if (existing?.external_id) return existing;
  const title = `Zapien - CRM ${tenant.business_name || 'da loja'}`.slice(0, 90);
  const body = { properties: { title }, sheets: SHEET_TABS.map((tab) => ({ properties: { title: tab } })) };
  const created = await googleFetch('', token, { method: 'POST', body: JSON.stringify(body) });
  const meta = { spreadsheet_name: created.properties?.title || title };
  tenantIntegrationQueries.setExternal.run({
    tenant_id: tenant.id,
    provider: PROVIDER,
    external_id: created.spreadsheetId,
    external_url: created.spreadsheetUrl,
    metadata_json: JSON.stringify(meta),
  });
  return tenantIntegrationQueries.get.get(tenant.id, PROVIDER);
}

async function writeTab(spreadsheetId, token, tab, rows) {
  const values = [HEADERS[tab], ...rows];
  const range = `${encodeURIComponent(tab)}!A1`;
  await googleFetch(`/${spreadsheetId}/values/${range}:clear`, token, { method: 'POST', body: '{}' });
  await googleFetch(`/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, token, { method: 'PUT', body: JSON.stringify({ values }) });
}

function money(cents, amount) {
  const n = cents != null ? Number(cents) / 100 : Number(amount || 0);
  return Number.isFinite(n) ? n : 0;
}

function productFromSale(s) {
  try {
    const items = JSON.parse(s.items_json || s.items || '[]');
    if (Array.isArray(items)) return items.map((i) => i.nome || i.name || i.produto || '').filter(Boolean).join(', ');
  } catch { /* noop */ }
  return s.items || '';
}

function buildRows(tenantId, businessJson = '{}') {
  const contacts = db.prepare(`SELECT * FROM contacts WHERE tenant_id = ? ORDER BY created_at ASC`).all(tenantId);
  const tagsByContact = new Map(contacts.map((c) => [c.id, contactTagQueries.byContact.all(c.id).map((r) => r.tag).join(', ')]));
  const clientes = contacts.map((c) => [
    c.created_at, c.name || '', c.wa_phone, c.stage || '', c.buy_intent || '', c.last_produto_mencionado || '',
    c.lead_source || '', tagsByContact.get(c.id) || '', c.last_message_at || '', c.proxima_tarefa || '', c.needs_human ? 'Sim' : 'Não',
  ]);

  const vendas = db.prepare(`
    SELECT s.*, c.name, c.wa_phone FROM sales s
    LEFT JOIN contacts c ON c.id = s.contact_id
    WHERE s.tenant_id = ? ORDER BY s.created_at ASC
  `).all(tenantId).map((s) => [
    s.created_at, s.name || '', s.wa_phone || '', productFromSale(s), money(s.total_cents, s.amount), s.status || '',
    s.checkout_url || '', s.payment_provider || '', s.id, s.updated_at || '',
  ]);

  const waitlist = db.prepare(`
    SELECT pw.*, c.name, c.wa_phone FROM product_waitlist pw
    LEFT JOIN contacts c ON c.id = pw.contact_id
    WHERE pw.tenant_id = ? ORDER BY pw.created_at ASC
  `).all(tenantId).map((w) => [w.created_at, w.produto_nome, w.name || '', w.wa_phone || '', w.notified_at ? 'Avisado' : 'Aguardando', w.notified_at || '']);

  const produtos = normalizeBusiness(businessJson).produtos || [];
  const radar = getRevenueRadar(tenantId, produtos);
  const oppRows = [];
  (radar.checkoutPendente || []).forEach((o) => oppRows.push([o.criadoEm || '', 'Checkout pendente', o.name || '', o.phone || '', '', money(o.valorCents, 0), 'Pagamento ainda não confirmado', o.mensagem || '', 'Aberta']));
  (radar.freteSemCompra || []).forEach((o) => oppRows.push([o.ultimoCalculo || '', 'Frete calculado sem compra', o.name || '', o.phone || '', '', '', 'Cliente calculou frete e não comprou', o.mensagem || '', 'Aberta']));
  (radar.leadsQuentesParados || []).forEach((o) => oppRows.push([o.lastMessageAt || '', 'Lead quente parado', o.name || '', o.phone || '', '', '', 'Alta intenção sem retorno recente', o.mensagem || '', 'Aberta']));
  (radar.recompra || []).forEach((o) => oppRows.push([o.ultimaCompraAt || '', 'Recompra sugerida', o.name || '', o.phone || '', o.produto || '', '', 'Ciclo de recompra vencido', o.mensagem || '', 'Aberta']));
  (radar.esperandoReposicao || []).forEach((o) => oppRows.push(['', 'Produto esgotado procurado', '', '', o.produto || '', '', o.titulo || '', '', 'Aberta']));

  return { Clientes: clientes, Vendas: vendas, Oportunidades: oppRows, 'Lista de espera': waitlist };
}

export async function connectGoogleSheets(tenant, code) {
  const data = await exchangeCode(code);
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
  tenantIntegrationQueries.upsert.run({
    tenant_id: tenant.id,
    provider: PROVIDER,
    access_token: encryptSecret(data.access_token),
    refresh_token: data.refresh_token ? encryptSecret(data.refresh_token) : null,
    expires_at: expiresAt,
    external_id: null,
    external_url: null,
    metadata_json: '{}',
    connected_at: null,
    last_sync_at: null,
  });
  const row = await ensureSpreadsheet(tenant, data.access_token, null);
  await syncGoogleSheets(tenant);
  return row;
}

export function googleSheetsStatus(tenantId) {
  const row = tenantIntegrationQueries.get.get(tenantId, PROVIDER);
  if (!row) return { connected: false };
  let meta = {};
  try { meta = JSON.parse(row.metadata_json || '{}'); } catch { meta = {}; }
  return {
    connected: true,
    spreadsheet_id: row.external_id || '',
    spreadsheet_url: row.external_url || '',
    spreadsheet_name: meta.spreadsheet_name || 'Zapien - CRM da loja',
    last_sync_at: row.last_sync_at || '',
  };
}

export async function syncGoogleSheets(tenant) {
  if (!googleConfigured()) throw new Error('Google Sheets não configurado.');
  const token = await accessTokenForTenant(tenant.id);
  const row = await ensureSpreadsheet(tenant, token, tenantIntegrationQueries.get.get(tenant.id, PROVIDER));
  const spreadsheetId = row.external_id;
  const rowsByTab = buildRows(tenant.id, tenant.business_json);
  for (const tab of SHEET_TABS) await writeTab(spreadsheetId, token, tab, rowsByTab[tab] || []);
  tenantIntegrationQueries.markSynced.run(tenant.id, PROVIDER);
  return googleSheetsStatus(tenant.id);
}

export function disconnectGoogleSheets(tenantId) {
  tenantIntegrationQueries.disconnect.run(tenantId, PROVIDER);
}
