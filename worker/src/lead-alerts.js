import { getSetting } from './db.js';
import { leadAlertQueries } from './leads.js';
import { numberToJid } from './phone.js';

let timer = null;
let dependencies = null;

export function isQuietHour(hour, start, end) {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
export function buildLeadAlert(row) {
  const title = row.level === 'hot' ? '🔥 *Novo lead quente*' : '🟡 *Novo lead morno*';
  const link = `https://wa.me/${String(row.phone || '').replace(/\D/g, '')}`;
  return [title, '', `Empresa: ${row.name || 'Não informada'}`, `Sinal: ${row.reason || 'respondeu à campanha'}`, `Origem: ${row.search_query || row.source || 'campanha'}`, '', `Abrir conversa: ${link}`].join('\n');
}
export function enqueueLeadAlert({ jid, phone, name, heat }) {
  if (!jid || !heat) return;
  const context = leadAlertQueries.context.get(jid) || {};
  leadAlertQueries.enqueue.run({ jid, phone: phone || context.phone || '', name: context.name || name || '', level: heat.level, reason: heat.reason, source: context.source || '', search_query: context.query || '', created_at: Date.now() });
}
export async function flushLeadAlert(deps = dependencies) {
  if (!deps || getSetting('lead_alerts_enabled', '1') !== '1') return { sent: false, reason: 'disabled' };
  const adminPhone = getSetting('admin_summary_phone', '') || '';
  if (!adminPhone) return { sent: false, reason: 'no_admin_phone' };
  const quietStart = Number(getSetting('lead_alerts_quiet_start', '22'));
  const quietEnd = Number(getSetting('lead_alerts_quiet_end', '8'));
  if (isQuietHour(new Date().getHours(), quietStart, quietEnd)) return { sent: false, reason: 'quiet_hours' };
  const row = leadAlertQueries.pending.get();
  if (!row) return { sent: false, reason: 'empty' };
  const sender = deps.firstConnectedId();
  if (!sender) return { sent: false, reason: 'no_connected_number' };
  await deps.sendText(sender, numberToJid(adminPhone), buildLeadAlert(row));
  leadAlertQueries.markSent.run({ jid: row.jid, sent_at: Date.now() });
  return { sent: true, level: row.level };
}
export function startLeadAlerts(deps) {
  dependencies = deps;
  timer = setInterval(() => flushLeadAlert().catch((err) => console.warn('  [alerta lead]', err.message)), 60_000);
  console.log('  Alertas de leads iniciados.');
}
export function stopLeadAlerts() { if (timer) clearInterval(timer); timer = null; dependencies = null; }
