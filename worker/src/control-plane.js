import { config } from './config.js';
import { createCampaign, queries, todayTotal } from './db.js';
import { getAllStates } from './wa.js';
import { numberToJid } from './phone.js';
import { isPaused } from './sender.js';

let timer = null;
let running = false;

async function request(path, body) {
  const response = await fetch(`${config.controlPlaneUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-robo-control-token': config.controlPlaneToken,
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `controle central HTTP ${response.status}`);
  return data;
}

function importCampaign(payload = {}) {
  const contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
  const items = contacts.map((contact) => ({
    lead_id: contact.id == null ? null : String(contact.id),
    name: contact.name || '',
    company_name: contact.company_name || contact.name || '',
    opening_question: contact.opening_question || '',
    phone: String(contact.phone || ''),
    jid: numberToJid(contact.phone),
  })).filter((contact) => contact.jid);
  if (!String(payload.message || '').trim() || items.length === 0) {
    throw new Error('campanha central sem mensagem ou contatos válidos');
  }
  return createCampaign(payload, items);
}

async function heartbeat(numbers) {
  return request('/api/robo/worker/heartbeat', {
    worker_id: config.workerId,
    dry_run: config.dryRun,
    paused: isPaused(),
    numbers: getAllStates(),
    configured_numbers: numbers.map((number) => number.id),
    today: todayTotal(),
    campaigns: queries.campaignStats.all(),
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    version: 'control-plane-v1',
  });
}

async function cycle(numbers) {
  if (running) return;
  running = true;
  try {
    await heartbeat(numbers);
    const claimed = await request('/api/robo/worker/claim', { worker_id: config.workerId });
    const job = claimed.job;
    if (!job) return;
    try {
      let result;
      if (job.type === 'campaign') result = importCampaign(job.payload);
      else throw new Error(`tipo de trabalho não suportado: ${job.type}`);
      await request(`/api/robo/worker/jobs/${encodeURIComponent(job.id)}/complete`, {
        worker_id: config.workerId, ok: true, result,
      });
      console.log(`  [controle] trabalho ${job.id} importado${config.dryRun ? ' (modo teste)' : ''}.`);
    } catch (error) {
      await request(`/api/robo/worker/jobs/${encodeURIComponent(job.id)}/complete`, {
        worker_id: config.workerId, ok: false, error: error.message,
      });
    }
  } catch (error) {
    console.warn(`  [controle] ${error.message}`);
  } finally {
    running = false;
  }
}

export function startControlPlane(numbers) {
  if (!config.controlPlaneUrl || !config.controlPlaneToken) {
    console.log('  Controle central desativado (configure CONTROL_PLANE_URL/TOKEN).');
    return;
  }
  const run = () => cycle(numbers);
  run();
  timer = setInterval(run, config.controlPollSec * 1000);
  timer.unref?.();
  console.log(`  Controle central: ${config.controlPlaneUrl} worker=${config.workerId} dryRun=${config.dryRun}.`);
}
