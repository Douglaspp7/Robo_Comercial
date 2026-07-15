import Stripe from 'stripe';
import { config, billingEnabled } from './config.js';
import { tenantQueries } from './db.js';

const stripe = billingEnabled ? new Stripe(config.stripe.secretKey) : null;

export { billingEnabled };

/** Cria (ou reaproveita) o cliente Stripe e abre uma sessao de checkout de assinatura. */
export async function createCheckoutSession(tenant) {
  if (!stripe) throw new Error('Billing nao configurado.');

  let customerId = tenant.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: tenant.email,
      metadata: { tenant_id: tenant.id },
    });
    customerId = customer.id;
    tenantQueries.setStripeCustomer.run(customerId, tenant.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: tenant.id,
    line_items: [{ price: config.stripe.priceId, quantity: 1 }],
    success_url: `${config.appUrl}/settings.html?assinatura=ok`,
    cancel_url: `${config.appUrl}/settings.html?assinatura=cancelada`,
  });
  return session.url;
}

/** Abre o portal de gerenciamento da assinatura (Stripe Billing Portal). */
export async function createPortalSession(tenant) {
  if (!stripe) throw new Error('Billing nao configurado.');
  if (!tenant.stripe_customer_id) throw new Error('Cliente ainda sem assinatura.');
  const session = await stripe.billingPortal.sessions.create({
    customer: tenant.stripe_customer_id,
    return_url: `${config.appUrl}/settings.html`,
  });
  return session.url;
}

/** Valida e processa um evento de webhook do Stripe. */
export function constructEvent(rawBody, signature) {
  if (!stripe) throw new Error('Billing nao configurado.');
  return stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
}

export async function handleStripeEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const tenant = session.client_reference_id
        ? tenantQueries.byId.get(session.client_reference_id)
        : null;
      if (tenant) {
        if (session.customer) tenantQueries.setStripeCustomer.run(session.customer, tenant.id);
        tenantQueries.setSubscription.run({
          id: tenant.id,
          status: 'active',
          sub_id: session.subscription || null,
        });
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const tenant = tenantQueries.byStripeCustomer.get(sub.customer);
      if (tenant) {
        // active/trialing => liberado; demais (canceled, past_due, unpaid) => bloqueado.
        const liberado = sub.status === 'active' || sub.status === 'trialing';
        tenantQueries.setSubscription.run({
          id: tenant.id,
          status: liberado ? 'active' : (sub.status || 'canceled'),
          sub_id: sub.id,
        });
      }
      break;
    }
    default:
      break;
  }
}
