import { config } from './config.js';
import { db, getSetting, setSetting, suppressionCount } from './db.js';
import { getAllStates, firstConnectedId, sendText } from './wa.js';
import { numberToJid } from './phone.js';
import { leadStats } from './leads.js';

let timer = null;

function localDay() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

export function buildDailySummary({ day, numbers, campaigns, leads, today, suppressed }) {
  const online = numbers.filter((n) => n.connected).length;
  const sent = campaigns.reduce((sum, c) => sum + Number(c.sent_today || 0), 0);
  const failed = campaigns.reduce((sum, c) => sum + Number(c.failed_today || 0), 0);
  const pending = campaigns.reduce((sum, c) => sum + Number(c.pending || 0), 0);
  return [
    `📊 *Resumo diário do Robô Comercial — ${day}*`,
    '',
    `🟢 Sistema: ${online === numbers.length ? 'saudável' : 'atenção'}`,
    `📱 Chips: ${online}/${numbers.length} conectados`,
    `📤 Enviadas hoje: ${sent}`,
    `⏳ Pendentes: ${pending}`,
    `⚠️ Falhas hoje: ${failed}`,
    '',
    `🔎 Leads no pool: ${leads.total}`,
    `💬 Respostas hoje: ${today.replied}`,
    `🔥 Interessados hoje: ${today.interested}`,
    `🚫 Recusas hoje: ${today.opted_out}`,
    `🛑 Lista “não contatar”: ${suppressed}`,
    '',
    today.interested > 0 ? '✅ Há oportunidades para revisar no atendente Zapien.' : 'ℹ️ Nenhum novo interessado identificado hoje.',
  ].join('\n');
}

export function dailySummarySnapshot() {
  const since = startOfToday();
  const campaigns = db.prepare(`SELECT c.id,
    SUM(i.status='sent' AND i.sent_at>=@since) sent_today,
    SUM(i.status='failed' AND i.failed_at>=@since) failed_today,
    SUM(i.status='pending') pending
    FROM campaigns c LEFT JOIN campaign_items i ON i.campaign_id=c.id GROUP BY c.id`).all({ since });
  const today = db.prepare(`SELECT
    SUM(replied_at>=@since) replied,
    SUM(interested_at>=@since) interested,
    SUM(opted_out_at>=@since) opted_out FROM leads`).get({ since });
  return { day: localDay(), numbers: getAllStates(), campaigns, leads: leadStats(), today: { replied: today?.replied || 0, interested: today?.interested || 0, opted_out: today?.opted_out || 0 }, suppressed: suppressionCount() };
}

export async function sendDailySummary() {
  const phone = getSetting('admin_summary_phone', config.adminSummaryPhone) || '';
  if (!phone) return { sent: false, reason: 'disabled' };
  const sender = firstConnectedId();
  if (!sender) return { sent: false, reason: 'no_connected_number' };
  await sendText(sender, numberToJid(phone), buildDailySummary(dailySummarySnapshot()));
  setSetting('admin_summary_last_day', localDay());
  return { sent: true };
}

async function tick() {
  const phone = getSetting('admin_summary_phone', config.adminSummaryPhone) || '';
  const time = getSetting('admin_summary_time', config.adminSummaryTime) || config.adminSummaryTime;
  if (!phone) return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (hhmm < time || getSetting('admin_summary_last_day') === localDay()) return;
  try { await sendDailySummary(); }
  catch (err) { console.warn('  [resumo diário]', err.message); }
}

export function startDailySummary() {
  timer = setInterval(tick, 60_000);
  tick();
  console.log('  Agendador de resumo diário iniciado.');
}
export function stopDailySummary() { if (timer) clearInterval(timer); timer = null; }
