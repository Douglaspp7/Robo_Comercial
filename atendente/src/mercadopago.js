import { config } from './config.js';
import { saleQueries } from './db.js';
import { fetchWithTimeout } from './http.js';
import { deductStockForSale, restoreStockForSale } from './stock.js';
import crypto from 'node:crypto';

// Integração com o Mercado Pago (Checkout Pro).

export function areItemsEqual(itemsA, itemsB) {
  if (!Array.isArray(itemsA) || !Array.isArray(itemsB)) return false;
  if (itemsA.length !== itemsB.length) return false;
  
  const sortFn = (a, b) => (a.titulo || a.nome || '').localeCompare(b.titulo || b.nome || '');
  const sortedA = [...itemsA].sort(sortFn);
  const sortedB = [...itemsB].sort(sortFn);
  
  for (let i = 0; i < sortedA.length; i++) {
    const a = sortedA[i];
    const b = sortedB[i];
    if ((a.titulo || a.nome || '') !== (b.titulo || b.nome || '')) return false;
    if (Math.round(Number(a.quantidade) || 1) !== Math.round(Number(b.quantidade) || 1)) return false;
    if (Number(Number(a.valor_unitario || 0).toFixed(2)) !== Number(Number(b.valor_unitario || 0).toFixed(2))) return false;
  }
  return true;
}

async function generatePreference(tenant, contact, itens, saleId) {
  const body = {
    items: itens.map((i) => ({
      title: String(i.titulo).slice(0, 250),
      quantity: Math.max(1, Math.round(Number(i.quantidade) || 1)),
      unit_price: Number(Number(i.valor_unitario).toFixed(2)),
      currency_id: 'BRL',
    })),
    back_urls: { success: config.appUrl, pending: config.appUrl, failure: config.appUrl },
    auto_return: 'approved',
    external_reference: saleId,
    notification_url: `${config.appUrl}/api/mercadopago/checkout-webhook?tenant=${tenant.id}`,
  };

  // Timeout (sem retry): criar preferência é POST não-idempotente — repetir
  // poderia gerar cobranças/links duplicados. O timeout evita pendurar o slot.
  const res = await fetchWithTimeout('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tenant.mp_access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, 15000);

  if (!res.ok) {
    console.warn('Mercado Pago falhou:', res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return {
    link: data.init_point || data.sandbox_init_point || null,
    preferenceId: data.id
  };
}

/**
 * Cria um link de pagamento para um pedido.
 */
/**
 * @returns {Promise<{link: string|null, zeroedOut: string[]}>}
 */
export async function createPaymentLink(tenant, contact, pedido) {
  const none = { link: null, zeroedOut: [] };
  if (!tenant.mp_access_token) return none;
  const itens = (pedido?.itens || []).filter(
    (i) => i && i.titulo && Number(i.valor_unitario) > 0
  );
  if (!itens.length) return none;

  const totalAmount = itens.reduce((acc, i) => acc + (Number(i.valor_unitario) * Math.max(1, Math.round(Number(i.quantidade) || 1))), 0);
  const totalCents = Math.round(totalAmount * 100);

  // Deduplicação: verificar venda aberta recente
  const existing = saleQueries.latestOpenByContact.get(contact.id);
  if (existing) {
    let existingItems = [];
    try {
      existingItems = JSON.parse(existing.items_json || existing.items || '[]');
    } catch {}

    if (areItemsEqual(existingItems, itens)) {
      // Garante que o estoque já foi descontado pra esta venda (idempotente).
      const zeroedOut = deductStockForSale(tenant.id, existing);

      // Mesmos itens! Se já tem link de checkout gerado anteriormente para o MP, reutiliza
      if (existing.checkout_url && (existing.mp_preference_id || existing.payment_provider === 'mercadopago')) {
        return { link: existing.checkout_url, zeroedOut };
      }

      // Se não tem link (ex: rascunho sem link), gera o link e atualiza a venda existente
      const saleId = existing.id;
      const mpPref = await generatePreference(tenant, contact, itens, saleId);
      if (mpPref && mpPref.link) {
        try {
          saleQueries.updateCheckoutDetails.run({
            id: saleId,
            tenant_id: tenant.id,
            status: 'checkout_enviado',
            checkout_url: mpPref.link,
            payment_provider: 'mercadopago',
            mp_preference_id: mpPref.preferenceId,
            total_cents: totalCents,
            amount: totalAmount,
          });
        } catch (err) {
          console.error('Erro ao atualizar checkout na venda existente:', err.message);
        }
        return { link: mpPref.link, zeroedOut };
      }
      return { link: null, zeroedOut };
    } else {
      // Itens diferentes: cancela a venda aberta anterior marcando como perdida
      // e devolve ao estoque o que havia sido reservado por ela.
      try {
        saleQueries.updateStatus.run({
          id: existing.id,
          tenant_id: tenant.id,
          status: 'perdido'
        });
        restoreStockForSale(tenant.id, existing);
      } catch (err) {
        console.error('Erro ao cancelar venda anterior:', err.message);
      }
    }
  }

  // Cria nova venda do zero
  const saleId = crypto.randomUUID();
  const mpPref = await generatePreference(tenant, contact, itens, saleId);

  if (mpPref && mpPref.link) {
    let zeroedOut = [];
    try {
      saleQueries.insert.run(
        saleId,
        tenant.id,
        contact?.id || null,
        'checkout_enviado',
        totalAmount,
        JSON.stringify(itens),
        mpPref.preferenceId,
        totalCents,
        JSON.stringify(itens)
      );
      zeroedOut = deductStockForSale(tenant.id, saleQueries.byId.get(saleId));
    } catch (err) {
      console.error('Erro ao salvar nova venda:', err.message);
    }
    return { link: mpPref.link, zeroedOut };
  }

  return none;
}


/**
 * Cria uma cobrança isolada para a taxa de um agendamento.
 * Não reserva estoque e usa a venda apenas como registro financeiro.
 */
export async function createBookingFeeLink(tenant, contact, appointment, service) {
  if (!tenant.mp_access_token || !appointment?.fee_amount_cents || appointment.fee_amount_cents <= 0) {
    return { link: null, saleId: null };
  }

  const saleId = crypto.randomUUID();
  const item = {
    titulo: `Taxa de agendamento — ${service.name}`,
    quantidade: 1,
    valor_unitario: appointment.fee_amount_cents / 100,
  };
  const mpPref = await generatePreference(tenant, contact, [item], saleId);
  if (!mpPref?.link) return { link: null, saleId: null };

  saleQueries.insert.run(
    saleId,
    tenant.id,
    contact?.id || null,
    'checkout_enviado',
    item.valor_unitario,
    JSON.stringify([item]),
    mpPref.preferenceId,
    appointment.fee_amount_cents,
    JSON.stringify([item])
  );

  saleQueries.updateCheckoutDetails.run({
    id: saleId,
    tenant_id: tenant.id,
    status: 'checkout_enviado',
    checkout_url: mpPref.link,
    payment_provider: 'mercadopago',
    mp_preference_id: mpPref.preferenceId,
    total_cents: appointment.fee_amount_cents,
    amount: item.valor_unitario,
  });

  return { link: mpPref.link, saleId };
}
