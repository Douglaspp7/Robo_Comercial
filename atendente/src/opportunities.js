import { db } from './db.js';
import { getDemandSignals } from './demand-signals.js';
import { getRepurchaseSuggestions } from './repurchase.js';
import { productWaitlistQueries } from './db.js';

const LIST_LIMIT = 20;

function firstName(name) {
  return (name || '').trim().split(' ')[0];
}

/**
 * Radar de Receita — reúne, num único lugar, as oportunidades comerciais que
 * hoje já existem espalhadas pelo app (demanda agregada, lista de espera,
 * recompra) mais três sinais novos de "dinheiro parado com contato
 * identificado" (checkout pendente, frete sem compra, lead quente parado),
 * cada uma já com mensagem pronta pra copiar/enviar. Nenhuma automação de
 * envio em massa aqui — só agregação de dados que o app já registra.
 */
export function getRevenueRadar(tenantId, produtos) {
  const demanda = getDemandSignals(tenantId).map((d) => ({
    tipo: 'demanda',
    produto: d.produto,
    contatos: d.contatos,
    titulo: `${d.contatos} pessoas perguntaram sobre "${d.produto}" nas últimas ${d.janelaHoras}h`,
  }));

  const esperandoReposicao = productWaitlistQueries.countsByTenant.all(tenantId).map((r) => ({
    tipo: 'lista_espera',
    produto: r.produto_nome,
    contatos: r.n,
    titulo: `${r.n} cliente(s) esperando "${r.produto_nome}" voltar ao estoque`,
  }));

  const checkoutPendente = db.prepare(`
    SELECT s.id, s.total_cents, s.checkout_url, s.created_at, c.wa_phone, c.name
    FROM sales s
    JOIN contacts c ON c.id = s.contact_id
    WHERE s.tenant_id = ? AND s.status IN ('checkout_enviado', 'aguardando_pagamento', 'pending')
    ORDER BY s.created_at ASC
    LIMIT ?
  `).all(tenantId, LIST_LIMIT).map((r) => ({
    tipo: 'checkout_pendente',
    phone: r.wa_phone,
    name: r.name || r.wa_phone,
    valorCents: r.total_cents || 0,
    checkoutUrl: r.checkout_url || '',
    criadoEm: r.created_at,
    mensagem: 'Oi! Vi que seu pedido ainda está aguardando o pagamento 🙂 Posso te ajudar a finalizar? Qualquer dúvida, me chama!',
  }));

  const freteSemCompra = db.prepare(`
    SELECT c.wa_phone, c.name, MAX(fc.created_at) AS ultimo_calculo
    FROM frete_calculos fc
    JOIN contacts c ON c.id = fc.contact_id
    WHERE fc.tenant_id = ? AND c.stage != 'fechado'
    GROUP BY c.id
    ORDER BY ultimo_calculo DESC
    LIMIT ?
  `).all(tenantId, LIST_LIMIT).map((r) => ({
    tipo: 'frete_sem_compra',
    phone: r.wa_phone,
    name: r.name || r.wa_phone,
    ultimoCalculo: r.ultimo_calculo,
    mensagem: `Oi${r.name ? ' ' + firstName(r.name) : ''}! Vi que você calculou o frete — ainda tem interesse? Posso te ajudar a fechar a compra 😊`,
  }));

  const recompra = getRepurchaseSuggestions(tenantId, produtos).slice(0, LIST_LIMIT);

  const leadsQuentesParados = db.prepare(`
    SELECT wa_phone, name, stage, summary, last_message_at
    FROM contacts
    WHERE tenant_id = ? AND buy_intent = 'alta' AND handoff_status = 'none'
      AND stage IN ('orcamento', 'negociacao', 'checkout')
      AND datetime(last_message_at) < datetime('now', '-24 hours')
    ORDER BY last_message_at ASC
    LIMIT ?
  `).all(tenantId, LIST_LIMIT).map((r) => ({
    tipo: 'lead_quente_parado',
    phone: r.wa_phone,
    name: r.name || r.wa_phone,
    stage: r.stage,
    summary: r.summary || '',
    lastMessageAt: r.last_message_at,
    mensagem: `Oi${r.name ? ' ' + firstName(r.name) : ''}! Passando para saber se você ainda tem interesse — posso te ajudar a fechar? 😊`,
  }));

  return { demanda, esperandoReposicao, checkoutPendente, freteSemCompra, recompra, leadsQuentesParados };
}
