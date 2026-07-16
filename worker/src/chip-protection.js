import { db, getSetting, setSetting } from './db.js';

let pauseWorker = null;
export function startChipProtection({ setPaused }) { pauseWorker = setPaused; }
export function resetDeliveryFailures() { setSetting('delivery_failure_streak', '0'); }
export function recordDeliveryFailure() {
  const streak = Number(getSetting('delivery_failure_streak', '0')) + 1;
  setSetting('delivery_failure_streak', String(streak));
  if (streak >= 5 && pauseWorker) { pauseWorker(true); setSetting('auto_pause_reason', '5 falhas consecutivas de envio'); return true; }
  return false;
}
export function evaluateOptoutProtection() {
  const since = new Date(); since.setHours(0,0,0,0);
  const row = db.prepare(`SELECT SUM(contacted_at>=@since) contacted, SUM(opted_out_at>=@since) optouts FROM leads`).get({ since: since.getTime() });
  const contacted = Number(row?.contacted || 0); const optouts = Number(row?.optouts || 0);
  if (contacted >= 10 && optouts / contacted >= 0.15 && pauseWorker) {
    pauseWorker(true); setSetting('auto_pause_reason', `recusa elevada: ${optouts}/${contacted}`); return true;
  }
  return false;
}
