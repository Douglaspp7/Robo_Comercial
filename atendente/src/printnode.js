/**
 * PrintNode integration — thermal printer comanda printing.
 * REST API: Basic auth (apiKey as username, empty password).
 * Docs: https://www.printnode.com/en/docs/api/curl
 */

import https from 'node:https';

const BASE_URL = 'https://api.printnode.com';

function basicAuth(apiKey) {
  return 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
}

function request(method, path, apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: basicAuth(apiKey),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`PrintNode ${res.statusCode}: ${data}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Lista impressoras disponíveis para a chave de API. */
export async function listPrinters(apiKey) {
  const printers = await request('GET', '/printers', apiKey);
  return (Array.isArray(printers) ? printers : []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description || '',
    state: p.state || 'unknown',
    computer: p.computer?.name || '',
  }));
}

/**
 * Formata uma venda como texto de comanda para impressão térmica (ESC/POS via base64).
 * Retorna o conteúdo em texto puro — PrintNode aceita tipo 'raw_base64' ou 'pdf_uri'.
 * Usamos 'raw_base64' com texto UTF-8 codificado para impressoras genéricas.
 */
export function formatComanda(sale, businessName) {
  const sep = '--------------------------------';
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const lines = [];

  lines.push(businessName || 'ZAPIEN');
  lines.push(sep);

  if (sale.comanda_number) lines.push(`COMANDA #${sale.comanda_number}`);
  if (sale.order_type) {
    const tipos = { delivery: 'DELIVERY', retirada: 'RETIRADA', mesa: 'MESA' };
    lines.push(`TIPO: ${tipos[sale.order_type] || sale.order_type.toUpperCase()}`);
  }
  if (sale.table_number) lines.push(`MESA: ${sale.table_number}`);
  if (sale.contact_name || sale.phone) lines.push(`CLIENTE: ${sale.contact_name || sale.phone}`);
  lines.push(`DATA: ${now}`);
  lines.push(sep);
  lines.push('ITENS:');

  let items = [];
  try { items = JSON.parse(sale.items_json || '[]'); } catch { items = []; }
  for (const item of items) {
    const qty = item.quantidade || item.qty || 1;
    const price = (item.valor_unitario || item.price || 0).toFixed(2);
    const total = (qty * (item.valor_unitario || item.price || 0)).toFixed(2);
    lines.push(`${qty}x ${item.titulo || item.name}`);
    lines.push(`   R$ ${price}  ->  R$ ${total}`);
    if (item.obs) lines.push(`   OBS: ${item.obs}`);
  }

  lines.push(sep);
  const subtotal = (sale.total_cents || 0) / 100;
  const fee = (sale.delivery_fee || 0) / 100;
  if (fee > 0) {
    lines.push(`SUBTOTAL:  R$ ${(subtotal - fee).toFixed(2)}`);
    lines.push(`ENTREGA:   R$ ${fee.toFixed(2)}`);
  }
  lines.push(`TOTAL:     R$ ${subtotal.toFixed(2)}`);

  if (sale.delivery_address) {
    try {
      const addr = JSON.parse(sale.delivery_address);
      lines.push(sep);
      lines.push('ENTREGA:');
      if (addr.rua) lines.push(`${addr.rua}, ${addr.numero || 's/n'}`);
      if (addr.complemento) lines.push(addr.complemento);
      if (addr.bairro) lines.push(addr.bairro);
      if (addr.cep) lines.push(`CEP: ${addr.cep}`);
    } catch { /* ignore */ }
  }

  if (sale.estimated_minutes) {
    lines.push(`ETA: ~${sale.estimated_minutes} min`);
  }

  lines.push(sep);
  lines.push('');

  return lines.join('\n');
}

/**
 * Envia uma comanda para impressão via PrintNode.
 * @param {string} apiKey - Chave de API PrintNode (decifrada)
 * @param {number|string} printerId - ID da impressora no PrintNode
 * @param {object} sale - Linha da tabela sales (com campos food service)
 * @param {string} businessName - Nome do negócio para cabeçalho
 * @returns {Promise<number>} ID do print job
 */
export async function printComanda(apiKey, printerId, sale, businessName) {
  const content = formatComanda(sale, businessName);
  const contentBase64 = Buffer.from(content, 'utf8').toString('base64');
  const title = sale.comanda_number
    ? `Comanda #${sale.comanda_number}`
    : `Pedido ${sale.id.slice(-6)}`;

  const job = {
    printerId: Number(printerId),
    title,
    contentType: 'raw_base64',
    content: contentBase64,
    source: 'Zapien',
  };

  const result = await request('POST', '/printjobs', apiKey, job);
  return result;
}
