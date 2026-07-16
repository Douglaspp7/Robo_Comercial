import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { db, tenantIntegrationQueries, googleCalendarBlockQueries, appointmentQueries } from './db.js';
import { encryptSecret, decryptSecret } from './crypto.js';

const PROVIDER = 'google_calendar';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
const redirectUri = () => `${config.appUrl.replace(/\/$/, '')}/api/google-calendar/oauth/callback`;
export const googleCalendarEnabled = () => Boolean(config.google?.clientId && config.google?.clientSecret);
export const googleCalendarState = (session) => createHmac('sha256', config.sessionSecret).update(`google_calendar:${session}`).digest('hex');
export function verifyGoogleCalendarState(session, state) {
  const value = typeof state === 'string' ? state.toLowerCase() : '';
  const expected = googleCalendarState(session);
  return value.length === expected.length && /^[0-9a-f]+$/.test(value) && timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'));
}
export function googleCalendarOAuthUrl(session) {
  if (!googleCalendarEnabled()) throw new Error('Google Calendar não configurado.');
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: config.google.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: googleCalendarState(session) })}`;
}
async function tokenRequest(body) {
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(data.error_description || 'Não foi possível conectar ao Google Calendar.');
  return data;
}
async function accessToken(tenantId) {
  const row = tenantIntegrationQueries.get.get(tenantId, PROVIDER);
  if (!row) throw new Error('Google Calendar não conectado.');
  if (!row.expires_at || new Date(row.expires_at).getTime() > Date.now() + 60_000) return decryptSecret(row.access_token);
  const data = await tokenRequest({ client_id: config.google.clientId, client_secret: config.google.clientSecret, refresh_token: decryptSecret(row.refresh_token), grant_type: 'refresh_token' });
  tenantIntegrationQueries.setTokens.run({ tenant_id: tenantId, provider: PROVIDER, access_token: encryptSecret(data.access_token), refresh_token: null, expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString() });
  return data.access_token;
}
async function calendarFetch(path, token, options = {}) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Erro Google Calendar (${res.status}).`);
  return data;
}
export async function connectGoogleCalendar(tenant, code) {
  const data = await tokenRequest({ client_id: config.google.clientId, client_secret: config.google.clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
  const token = data.access_token;
  const calendars = await calendarFetch('/users/me/calendarList?minAccessRole=writer', token);
  const calendar = calendars.items?.find((item) => item.primary) || calendars.items?.[0];
  if (!calendar) throw new Error('Nenhum calendário com permissão de escrita foi encontrado.');
  tenantIntegrationQueries.upsert.run({ tenant_id: tenant.id, provider: PROVIDER, access_token: encryptSecret(token), refresh_token: data.refresh_token ? encryptSecret(data.refresh_token) : null, expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(), external_id: calendar.id, external_url: null, metadata_json: JSON.stringify({ name: calendar.summary || 'Agenda principal' }), connected_at: null, last_sync_at: null });
  await syncGoogleCalendar(tenant.id);
}
export function googleCalendarStatus(tenantId) {
  const row = tenantIntegrationQueries.get.get(tenantId, PROVIDER);
  if (!row) return { connected: false, enabled: googleCalendarEnabled() };
  let meta = {}; try { meta = JSON.parse(row.metadata_json || '{}'); } catch { /* noop */ }
  return { connected: true, enabled: true, calendar_name: meta.name || 'Agenda principal', last_sync_at: row.last_sync_at || '' };
}
export async function syncGoogleCalendar(tenantId) {
  const row = tenantIntegrationQueries.get.get(tenantId, PROVIDER);
  const token = await accessToken(tenantId);
  const from = new Date(); from.setDate(from.getDate() - 1);
  const to = new Date(); to.setDate(to.getDate() + 90);
  const query = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', showDeleted: 'false', maxResults: '2500' });
  const data = await calendarFetch(`/calendars/${encodeURIComponent(row.external_id)}/events?${query}`, token);
  const replace = db.transaction(() => {
    googleCalendarBlockQueries.clear.run(tenantId);
    for (const event of data.items || []) {
      const start = event.start?.dateTime; const end = event.end?.dateTime;
      if (!start || !end || event.transparency === 'transparent' || event.status === 'cancelled') continue;
      googleCalendarBlockQueries.insert.run({ tenant_id: tenantId, event_id: event.id, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), title: event.summary || 'Ocupado no Google Calendar' });
    }
  });
  replace();
  tenantIntegrationQueries.markSynced.run(tenantId, PROVIDER);
  return googleCalendarStatus(tenantId);
}
export async function createGoogleCalendarEvent(tenantId, appointment) {
  const row = tenantIntegrationQueries.get.get(tenantId, PROVIDER);
  if (!row) return null;
  const token = await accessToken(tenantId);
  const event = await calendarFetch(`/calendars/${encodeURIComponent(row.external_id)}/events`, token, { method: 'POST', body: JSON.stringify({ summary: `${appointment.service_name || 'Atendimento'} — ${appointment.customer_name}`, description: `Criado pelo Zapien${appointment.customer_phone ? `\nWhatsApp: ${appointment.customer_phone}` : ''}${appointment.notes ? `\n${appointment.notes}` : ''}`, start: { dateTime: appointment.starts_at, timeZone: 'America/Sao_Paulo' }, end: { dateTime: appointment.ends_at, timeZone: 'America/Sao_Paulo' }, extendedProperties: { private: { zapien_appointment_id: appointment.id } } }) });
  appointmentQueries.setGoogleEvent.run({ id: appointment.id, tenant_id: tenantId, google_event_id: event.id });
  return event.id;
}
export async function cancelGoogleCalendarEvent(tenantId, appointment) {
  if (!appointment?.google_event_id) return;
  const row = tenantIntegrationQueries.get.get(tenantId, PROVIDER); if (!row) return;
  const token = await accessToken(tenantId);
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(row.external_id)}/events/${encodeURIComponent(appointment.google_event_id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error('Não foi possível cancelar no Google Calendar.');
}
export function disconnectGoogleCalendar(tenantId) {
  googleCalendarBlockQueries.clear.run(tenantId);
  tenantIntegrationQueries.disconnect.run(tenantId, PROVIDER);
}
