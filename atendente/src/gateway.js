/**
 * Modo gateway — saída de mensagens pelo WORKER do Robo Comercial.
 *
 * Neste modo o atendente NÃO fala com a Meta: quem é dono do chip é o worker
 * (Baileys). Para responder um lead, o atendente chama POST /send do worker
 * informando o `number_id` (chip) por onde o lead está conversando — assim a
 * resposta sai pelo MESMO número que o abordou (essencial com 2 chips).
 *
 * O chip dono do contato fica em contacts.chip_id (gravado no /inbound). Se por
 * algum motivo não houver chip_id, o worker usa o 1º chip conectado.
 *
 * Nunca logamos o conteúdo — erros carregam só status/telefone (em quem chama).
 */
import { config } from './config.js';
import { contactQueries } from './db.js';

/** Descobre o chip (number_id) por onde este contato chegou. */
function chipForContact(tenant, phoneDigits) {
  try {
    const contact = tenant?.id
      ? contactQueries.byPhone.get(tenant.id, phoneDigits)
      : null;
    return contact?.chip_id || null;
  } catch {
    return null; // sem contato → worker escolhe o chip conectado
  }
}

/**
 * Envia um texto pelo worker. Usado por whatsapp.js quando GATEWAY_MODE=1.
 * Lança em falha (o chamador já trata como faz com a Meta).
 */
export async function sendViaWorker(tenant, to, text) {
  const { workerUrl, workerToken } = config.gateway;
  if (!workerUrl) throw new Error('WORKER_URL não configurado (modo gateway)');
  const body = String(text || '').trim();
  if (!body) return {}; // nada a enviar (ex.: imagem sem legenda) — no-op
  const phoneDigits = String(to || '').replace(/\D/g, '');
  const numberId = chipForContact(tenant, phoneDigits);

  const res = await fetch(`${workerUrl}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(workerToken ? { 'x-worker-token': workerToken } : {}),
    },
    body: JSON.stringify({ number_id: numberId, phone: to, text: body }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Falha no /send do worker (${res.status}): ${errBody}`);
  }
  return res.json().catch(() => ({}));
}
