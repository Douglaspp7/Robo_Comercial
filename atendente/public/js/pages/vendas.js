/**
 * Painel de Vendas — funil, pedidos e resultados financeiros.
 * Não tem o drawer de conversa (isso fica na Visão Geral); links de contato
 * aqui abrem o contato em /dashboard.html?contact=<telefone>.
 */

function fmtDate(str) {
  if (!str) return '';
  let s = str.trim().replace(' ', 'T');
  if (!s.endsWith('Z') && !s.includes('+')) s += 'Z';
  const d = new Date(s);
  if (isNaN(d)) return str.slice(0, 16);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(cents) {
  return ((Number(cents) || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtRelativeTime(str) {
  if (!str) return '';
  let s = str.trim().replace(' ', 'T');
  if (!s.endsWith('Z') && !s.includes('+')) s += 'Z';
  const d = new Date(s);
  if (isNaN(d)) return '';
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffDias = Math.round(diffH / 24);
  return `há ${diffDias} dia${diffDias === 1 ? '' : 's'}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const ui = {
    logoutBtn: document.getElementById('logoutBtn'),
    adminLink: document.getElementById('adminLink'),
    impersonateBar: document.getElementById('impersonateBar'),
    impersonateEmail: document.getElementById('impersonateEmail'),
    stopImpersonateBtn: document.getElementById('stopImpersonateBtn'),
    vendasKpisArea: document.getElementById('vendasKpisArea'),
    radarSection: document.getElementById('radarSection'),
    radarArea: document.getElementById('radarArea'),
    radarToggle: document.getElementById('radarToggle'),
    radarCount: document.getElementById('radarCount'),
    radarChevron: document.getElementById('radarChevron'),
    stuckMoneySection: document.getElementById('stuckMoneySection'),
    salesOpportunityEmpty: document.getElementById('salesOpportunityEmpty'),
    stuckMoneyArea: document.getElementById('stuckMoneyArea'),
    pipelineBoard: document.getElementById('pipelineBoard'),
    pipelineStageTabs: document.getElementById('pipelineStageTabs'),
    originArea: document.getElementById('originArea'),
    tipoClienteArea: document.getElementById('tipoClienteArea'),
    funnelChart: document.getElementById('funnelChart'),
    salesArea: document.getElementById('salesArea'),
  };

  let _csrfToken = null;
  let salesCache = [];
  let salesFilter = 'todos';
  let meData = null;
  let funnelChartObj = null;
  let saleNoResponseAlertHours = 2;
  let pipelineDataCache = null;
  let pipelineVisibleCount = {};

  async function getCsrfToken() {
    if (_csrfToken) return _csrfToken;
    const r = await fetch('/api/csrf-token');
    if (r.ok) _csrfToken = (await r.json()).token;
    return _csrfToken;
  }

  async function apiFetch(url, options = {}) {
    const token = await getCsrfToken();
    return fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        'X-CSRF-Token': token,
        ...options.headers,
      },
    });
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // O drawer de conversa só existe na Visão Geral — links daqui abrem o
  // contato lá (?contact=<telefone>[&assumir=1] pra já assumir a conversa).
  function contactUrl(phone, assumir) {
    return `/dashboard.html?contact=${encodeURIComponent(phone)}${assumir ? '&assumir=1' : ''}`;
  }

  async function logout() {
    await apiFetch('/api/logout', { method: 'POST' });
    location.href = '/';
  }
  async function stopImpersonate() {
    const r = await apiFetch('/api/admin/stop-impersonate', { method: 'POST' });
    const j = await r.json();
    location.href = j.redirect || '/admin.html';
  }
  if (ui.logoutBtn) ui.logoutBtn.addEventListener('click', logout);
  if (ui.stopImpersonateBtn) ui.stopImpersonateBtn.addEventListener('click', stopImpersonate);

  // 4 KPIs de destaque — os 2 financeiros de sempre + os 2 sinais mais
  // urgentes de dinheiro parado, promovidos do grid branco abaixo.
  function renderVendasKpis(s) {
    if (!ui.vendasKpisArea) return;
    const d = s.dinheiro_parado || {};
    ui.vendasKpisArea.innerHTML = `
      <div class="metric-card metric-card--success">
        <div class="metric-card-top">
          <span class="metric-label">Receita (Vendas reais)</span>
          <span class="metric-icon"><i data-lucide="dollar-sign"></i></span>
        </div>
        <div class="metric-value">R$ ${(s.receita_total || 0).toFixed(2).replace('.', ',')}</div>
        <div class="metric-helper">${s.vendas_reais || 0} vendas aprovadas via MP</div>
      </div>

      <div class="metric-card metric-card--ai">
        <div class="metric-card-top">
          <span class="metric-label">Taxa de conversão</span>
          <span class="metric-icon"><i data-lucide="percent"></i></span>
        </div>
        <div class="metric-value">${s.taxa_conversao}%</div>
        <div class="metric-helper">Visitantes em vendas</div>
      </div>

      <div class="metric-card metric-card--warning">
        <div class="metric-card-top">
          <span class="metric-label">Vendas paradas</span>
          <span class="metric-icon"><i data-lucide="wallet"></i></span>
        </div>
        <div class="metric-value">${fmtMoney(d.vendas_paradas_cents)}</div>
        <div class="metric-helper">Parado no funil</div>
      </div>

      <div class="metric-card metric-card--danger">
        <div class="metric-card-top">
          <span class="metric-label">Precisa de humano</span>
          <span class="metric-icon"><i data-lucide="user-round"></i></span>
        </div>
        <div class="metric-value">${d.precisa_humano || 0}</div>
        <div class="metric-helper">Atendimentos aguardando você</div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: ui.vendasKpisArea });
  }

  function updateOpportunityEmpty() {
    if (!ui.salesOpportunityEmpty) return;
    const radarVisible = ui.radarSection && ui.radarSection.style.display !== 'none';
    const stuckVisible = ui.stuckMoneySection && ui.stuckMoneySection.style.display !== 'none';
    ui.salesOpportunityEmpty.style.display = (!radarVisible && !stuckVisible) ? 'flex' : 'none';
  }

  // Os 4 sinais complementares de dinheiro parado (os 2 mais urgentes já
  // viraram KPI colorido acima, pra não repetir o mesmo número duas vezes).
  function renderStuckMoney(d) {
    if (!ui.stuckMoneySection || !ui.stuckMoneyArea) return;
    d = d || {};
    const total = d.orcamentos_sem_resposta + d.aguardando_pagamento + d.clientes_sem_retorno + (d.cadastros_incompletos || 0);
    if (!total) { ui.stuckMoneySection.style.display = 'none'; updateOpportunityEmpty(); return; }
    ui.stuckMoneySection.style.display = 'block';
    updateOpportunityEmpty();

    // Só mostra o que tem número — sem caixa de "0" competindo por atenção
    // (mesma lente do Radar de Receita). As duas com etapa equivalente no
    // funil já viram link direto pra lista filtrada na Visão Geral.
    const tiles = [
      { label: 'Orçamentos sem resposta', value: d.orcamentos_sem_resposta, icon: 'file-clock', stage: 'orcamento' },
      { label: 'Aguardando pagamento', value: d.aguardando_pagamento, icon: 'credit-card', stage: 'checkout' },
      { label: 'Clientes sem retorno', value: d.clientes_sem_retorno, icon: 'message-circle-off' },
      { label: 'Cadastros incompletos', value: d.cadastros_incompletos || 0, icon: 'user-x' },
    ].filter((t) => t.value > 0);

    ui.stuckMoneyArea.innerHTML = tiles.map((t) => {
      const tag = t.stage ? 'a' : 'div';
      const href = t.stage ? ` href="/dashboard.html?stage=${encodeURIComponent(t.stage)}"` : '';
      return `
        <${tag} class="stat-card" style="text-decoration:none;color:inherit;"${href}>
          <div class="stat-card-header">
            <span>${t.label}</span>
            <i data-lucide="${t.icon}" style="color:var(--danger-500);"></i>
          </div>
          <div class="stat-card-value">${t.value}</div>
        </${tag}>
      `;
    }).join('');
    if (window.lucide) window.lucide.createIcons({ root: ui.stuckMoneyArea });
  }

  // ── Radar de Receita: oportunidades comerciais acionáveis ───────────────
  // Reúne, num único lugar, sinais que hoje já existem espalhados pelo app
  // (demanda, lista de espera, recompra) mais dinheiro parado com contato
  // identificado (checkout pendente, frete sem compra, lead quente parado).
  // Ver src/opportunities.js. Ações usam delegação de evento (nada de
  // onclick inline), reaproveitando os endpoints que já existem.
  function radarContactItem(o, { valueLabel, showAssumir = false } = {}) {
    const meta = valueLabel ? valueLabel(o) : '';
    return `
      <div class="radar-item">
        <div class="radar-item-info">
          <a class="radar-item-name" href="${contactUrl(o.phone)}">${esc(o.name)}</a>
          ${meta ? `<span class="radar-item-meta">${esc(meta)}</span>` : ''}
        </div>
        <div class="radar-item-actions">
          ${o.mensagem ? `<button class="btn btn-icon btn-compact" title="Copiar mensagem" data-radar-copy="${esc(o.mensagem)}"><i data-lucide="copy"></i></button>` : ''}
          <a class="btn btn-icon btn-compact" title="Abrir conversa" href="${contactUrl(o.phone)}"><i data-lucide="message-square"></i></a>
          ${showAssumir ? `<a class="btn btn-icon btn-compact" title="Assumir atendimento" href="${contactUrl(o.phone, true)}"><i data-lucide="user-check"></i></a>` : ''}
        </div>
      </div>`;
  }

  function radarProductItem(o, { withNotify = false } = {}) {
    return `
      <div class="radar-item">
        <div class="radar-item-info">
          <span class="radar-item-name" style="max-width:none;">${esc(o.produto)}</span>
          <span class="radar-item-meta">${o.contatos} cliente(s)</span>
        </div>
        ${withNotify ? `
          <div class="radar-item-actions">
            <button class="btn btn-secondary btn-compact" data-radar-notify="${esc(o.produto)}">Avisar reposição</button>
          </div>` : ''}
      </div>`;
  }

  // Categoria sem oportunidade nenhuma não aparece — melhor mostrar só o que
  // é acionável do que 6 caixas fixas com "nada por aqui" (Prioridade 5/6 do
  // audit: reduzir poluição visual pro pequeno lojista).
  function radarCard({ icon, color, title, items, renderItem }) {
    if (!items.length) return '';
    return `
      <div class="radar-card">
        <div class="radar-card-header">
          <i data-lucide="${icon}" style="color:${color};"></i>
          <span>${title}</span>
          <span class="badge badge-gray">${items.length}</span>
        </div>
        <div class="radar-card-body">
          ${items.map(renderItem).join('')}
        </div>
      </div>`;
  }

  const RADAR_COLLAPSE_KEY = 'zapien_radar_collapsed';

  function applyRadarCollapse(collapsed) {
    if (!ui.radarArea || !ui.radarChevron) return;
    ui.radarArea.style.display = collapsed ? 'none' : '';
    ui.radarChevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
  }

  if (ui.radarToggle) {
    ui.radarToggle.addEventListener('click', () => {
      const collapsed = ui.radarArea.style.display !== 'none';
      applyRadarCollapse(collapsed);
      localStorage.setItem(RADAR_COLLAPSE_KEY, collapsed ? '1' : '0');
    });
  }

  function renderRevenueRadar(data) {
    if (!ui.radarSection || !ui.radarArea) return;
    data = data || {};
    const total = Object.values(data).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    if (!total) { ui.radarSection.style.display = 'none'; updateOpportunityEmpty(); return; }
    ui.radarSection.style.display = 'block';
    updateOpportunityEmpty();
    if (ui.radarCount) ui.radarCount.textContent = `${total} oportunidade${total === 1 ? '' : 's'}`;

    const cards = [
      radarCard({
        icon: 'flame', color: '#dc2626', title: 'Leads quentes parados',
        items: (data.leadsQuentesParados || []).slice(0, 5),
        renderItem: (o) => radarContactItem(o, { valueLabel: (x) => `Sem retorno ${fmtRelativeTime(x.lastMessageAt)}`, showAssumir: true }),
      }),
      radarCard({
        icon: 'credit-card', color: '#d97706', title: 'Checkouts pendentes',
        items: (data.checkoutPendente || []).slice(0, 5),
        renderItem: (o) => radarContactItem(o, { valueLabel: (x) => `${fmtMoney(x.valorCents)} · enviado ${fmtRelativeTime(x.criadoEm)}` }),
      }),
      radarCard({
        icon: 'truck', color: '#0ea5e9', title: 'Calcularam frete e não compraram',
        items: (data.freteSemCompra || []).slice(0, 5),
        renderItem: (o) => radarContactItem(o, { valueLabel: (x) => `Calculado ${fmtRelativeTime(x.ultimoCalculo)}` }),
      }),
      radarCard({
        icon: 'repeat', color: '#8b5cf6', title: 'Prontos para recompra',
        items: (data.recompra || []).slice(0, 5),
        renderItem: (o) => radarContactItem(o, { valueLabel: (x) => `${x.produto} · ${x.diasDesde} dias desde a última compra` }),
      }),
      radarCard({
        icon: 'bell', color: '#16a34a', title: 'Lista de espera de reposição',
        items: data.esperandoReposicao || [],
        renderItem: (o) => radarProductItem(o, { withNotify: true }),
      }),
      radarCard({
        icon: 'trending-up', color: '#ea580c', title: 'Alta demanda agora',
        items: data.demanda || [],
        renderItem: (o) => radarProductItem(o),
      }),
    ].filter(Boolean);

    ui.radarArea.innerHTML = cards.join('');
    applyRadarCollapse(localStorage.getItem(RADAR_COLLAPSE_KEY) === '1');
    if (window.lucide) window.lucide.createIcons({ root: ui.radarArea });
  }

  if (ui.radarArea) {
    ui.radarArea.addEventListener('click', async (e) => {
      const copyBtn = e.target.closest('[data-radar-copy]');
      if (copyBtn) {
        window.copyToClipboard(copyBtn.dataset.radarCopy);
        return;
      }
      const notifyBtn = e.target.closest('[data-radar-notify]');
      if (!notifyBtn) return;
      const nome = notifyBtn.dataset.radarNotify;
      const confirmed = await window.ZapUI.confirm({
        title: 'Avisar clientes',
        message: `Avisar quem está esperando "${nome}" que o produto voltou ao estoque?`,
        confirmText: 'Enviar avisos',
        cancelText: 'Agora não',
      });
      if (!confirmed) return;
      notifyBtn.disabled = true;
      try {
        const res = await apiFetch('/api/products/notify-restock', { method: 'POST', body: JSON.stringify({ nome }) });
        const data = await res.json();
        if (res.ok) {
          window.Toast?.show(`Aviso enviado para ${data.enviados} pessoa(s).`, 'success');
          loadOpportunities();
        } else {
          window.Toast?.show('Erro ao enviar aviso.', 'error');
        }
      } catch {
        window.Toast?.show('Erro de conexão ao enviar aviso.', 'error');
      } finally {
        notifyBtn.disabled = false;
      }
    });
  }

  async function loadOpportunities() {
    try {
      const res = await fetch('/api/opportunities');
      if (!res.ok) return;
      renderRevenueRadar(await res.json());
    } catch (err) {
      console.error('load/opportunities:', err);
    }
  }

  // ── Campanhas segmentadas por tag (WhatsApp Business API, Elite) ────────
  let campaignTemplates = [];

  function campaignVarCount(corpo) {
    const matches = String(corpo || '').match(/\{\{\d+\}\}/g);
    return matches ? new Set(matches).size : 0;
  }

  function renderCampaignVariables() {
    const sel = document.getElementById('campaign-template');
    const wrap = document.getElementById('campaign-variables');
    const preview = document.getElementById('campaign-template-preview');
    if (!sel || !wrap) return;
    const template = campaignTemplates.find((t) => t.nome === sel.value);
    wrap.innerHTML = '';
    if (preview) preview.textContent = template ? template.corpo : '';
    if (!template) return;
    const n = campaignVarCount(template.corpo);
    for (let i = 1; i <= n; i++) {
      const div = document.createElement('div');
      div.className = 'form-group mb-0';
      div.innerHTML = `<label class="form-label">Valor de {{${i}}}</label><input type="text" class="form-input campaign-var-input" data-idx="${i}">`;
      wrap.appendChild(div);
    }
  }

  function renderCampaignTemplateState({ unavailable = false } = {}) {
    const templateSelect = document.getElementById('campaign-template');
    const help = document.getElementById('campaign-template-help');
    const sendBtn = document.getElementById('campaign-send-btn');
    const hasTemplates = campaignTemplates.length > 0;

    if (help) help.style.display = hasTemplates ? 'none' : 'flex';
    if (sendBtn) sendBtn.disabled = unavailable || !hasTemplates;
    if (!templateSelect) return;

    if (hasTemplates) {
      templateSelect.disabled = false;
      templateSelect.innerHTML = '<option value="">Selecione um template...</option>' +
        campaignTemplates.map((t) => `<option value="${esc(t.nome)}">${esc(t.nome)}</option>`).join('');
    } else {
      templateSelect.disabled = true;
      templateSelect.innerHTML = '<option value="">Nenhum template cadastrado</option>';
    }
  }

  async function loadCampaignsUI() {
    const section = document.getElementById('campaignsSection');
    const notAvailable = document.getElementById('campaignsNotAvailable');
    if (!section) return;
    if (!meData?.planFeatures?.campaignsEnabled) {
      section.style.display = 'none';
      if (notAvailable) notAvailable.style.display = 'block';
      return;
    }
    section.style.display = 'block';
    if (notAvailable) notAvailable.style.display = 'none';

    try {
      const [tagsRes, templatesRes, historyRes] = await Promise.all([
        fetch('/api/campaigns/tags'),
        fetch('/api/whatsapp-templates'),
        fetch('/api/campaigns'),
      ]);
      const tagSelect = document.getElementById('campaign-tag');
      if (tagsRes.ok && tagSelect) {
        const tags = await tagsRes.json();
        tagSelect.innerHTML = '<option value="">Selecione uma tag...</option>' +
          tags.map((t) => `<option value="${esc(t.tag)}">${esc(t.tag)} (${t.n})</option>`).join('');
      }
      const templateSelect = document.getElementById('campaign-template');
      if (templatesRes.ok && templateSelect) {
        campaignTemplates = await templatesRes.json();
        renderCampaignTemplateState();
      } else {
        campaignTemplates = [];
        renderCampaignTemplateState({ unavailable: true });
      }
      const historyEl = document.getElementById('campaign-history');
      if (historyRes.ok && historyEl) {
        const historico = await historyRes.json();
        historyEl.innerHTML = historico.length ? historico.map((c) => `
          <div class="flex items-center justify-between gap-2" style="padding:8px 0; border-top:1px solid var(--border); font-size:0.8rem;">
            <span>${esc(c.template_nome)} → tag "${esc(c.tag)}"</span>
            <span style="color:var(--text-secondary);">${c.enviados}/${c.total_contatos} enviados${c.falhas ? `, ${c.falhas} falha(s)` : ''} · ${esc(c.created_at)}</span>
          </div>
        `).join('') : '';
      }
    } catch (err) {
      console.error('load/campaigns:', err);
    }
  }

  document.getElementById('campaign-template')?.addEventListener('change', renderCampaignVariables);

  document.getElementById('campaign-preview-btn')?.addEventListener('click', async () => {
    const tag = document.getElementById('campaign-tag')?.value;
    const resultEl = document.getElementById('campaign-audience-result');
    if (!tag) { window.Toast?.show('Selecione uma tag primeiro.', 'error'); return; }
    try {
      const res = await fetch(`/api/campaigns/audience?tag=${encodeURIComponent(tag)}`);
      const data = await res.json();
      if (!res.ok) throw new Error();
      if (resultEl) {
        resultEl.textContent = data.total
          ? `${data.total} contato(s) — ex: ${data.amostra.join(', ')}`
          : 'Nenhum contato com essa tag.';
      }
    } catch {
      if (resultEl) resultEl.textContent = 'Erro ao consultar audiência.';
    }
  });

  document.getElementById('campaign-send-btn')?.addEventListener('click', async () => {
    const tag = document.getElementById('campaign-tag')?.value;
    const templateNome = document.getElementById('campaign-template')?.value;
    const varInputs = Array.from(document.querySelectorAll('.campaign-var-input'))
      .sort((a, b) => Number(a.dataset.idx) - Number(b.dataset.idx))
      .map((el) => el.value);
    if (!tag || !templateNome) {
      window.Toast?.show('Selecione a tag e o template.', 'error');
      return;
    }
    const confirmed = await window.ZapUI.confirm({
      title: 'Enviar campanha agora',
      message: 'A campanha será enviada para todos os contatos com esta tag. O envio não pode ser desfeito.',
      confirmText: 'Enviar campanha',
      cancelText: 'Revisar antes',
      tone: 'danger',
    });
    if (!confirmed) return;

    const sendBtn = document.getElementById('campaign-send-btn');
    sendBtn.disabled = true;
    try {
      const res = await apiFetch('/api/campaigns/send', {
        method: 'POST',
        body: JSON.stringify({ tag, template_nome: templateNome, variaveis: varInputs }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Falha ao enviar');
      window.Toast?.show(`Campanha enviada: ${data.enviados}/${data.total} com sucesso.`, 'success');
      await loadCampaignsUI();
    } catch (err) {
      window.Toast?.show(err.message === 'audiencia_vazia' ? 'Nenhum contato com essa tag.' : 'Não foi possível enviar a campanha.', 'error');
    } finally {
      sendBtn.disabled = false;
    }
  });

  // ── Painel de Vendas (board por etapa) ─────────────────────────────────
  async function loadPipeline() {
    if (!ui.pipelineBoard) return;
    try {
      const res = await fetch('/api/pipeline');
      if (!res.ok) return;
      const data = await res.json();
      renderPipeline(data);
    } catch (err) {
      console.error('[pipeline] load', err);
    }
  }

  function pipelineCardHtml(card, stages) {
    const moveOptions = stages
      .map((s) => `<option value="${s.id}">${esc(s.label)}</option>`)
      .join('');
    const tarefaLinha = [
      card.proxima_tarefa ? `✅ ${esc(card.proxima_tarefa)}` : '',
      card.responsavel ? `👤 ${esc(card.responsavel)}` : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="feature-card pipeline-card"${card.prioridade === 'alta' ? ' style="border-left:3px solid var(--danger-500);"' : ''}>
        <div class="pipeline-card-row">
          <a class="contact-name" style="font-size:0.82rem;text-align:left;text-decoration:none;" href="${contactUrl(card.phone)}">${esc(card.name)}</a>
          <span style="flex-shrink:0;display:flex;align-items:center;gap:4px;font-size:0.68rem;color:var(--text-secondary);">
            ${card.needs_human ? '<span title="Precisa de humano">🚨</span>' : ''}${fmtRelativeTime(card.last_message_at)}
          </span>
        </div>
        <div class="pipeline-card-meta">${esc(card.phone)} · ${esc(card.lead_source_label)}</div>
        ${card.compras_pagas > 0 ? `
        <div class="pipeline-card-meta" style="color:var(--success-600, #16a34a);font-weight:600;">
          ${card.compras_pagas >= 2 ? '⭐ ' : ''}${card.compras_pagas} compra${card.compras_pagas > 1 ? 's' : ''} · ${fmtMoney(card.total_gasto_cents)} gastos
        </div>` : ''}
        ${card.produto_interesse || card.valor_cents ? `
        <div class="pipeline-card-row" style="margin-top:4px;">
          ${card.produto_interesse ? `<span class="pipeline-card-meta" style="margin-top:0;">📦 ${esc(card.produto_interesse)}</span>` : '<span></span>'}
          ${card.valor_cents ? `<span style="font-size:0.78rem;font-weight:700;color:var(--brand-600);flex-shrink:0;">${fmtMoney(card.valor_cents)}</span>` : ''}
        </div>` : ''}
        ${card.main_tag || card.prioridade === 'alta' ? `
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">
          ${card.main_tag ? `<span class="badge badge-gray" style="font-size:0.62rem;">${esc(card.main_tag)}</span>` : ''}
          ${card.prioridade === 'alta' ? '<span class="badge badge-danger" style="font-size:0.62rem;">Prioridade alta</span>' : ''}
        </div>` : ''}
        ${tarefaLinha ? `<div class="pipeline-card-meta">${tarefaLinha}</div>` : ''}
        <select class="form-select pipeline-move-select" data-phone="${esc(card.phone)}" style="margin-top:6px;width:100%;font-size:0.72rem;padding:4px 8px;">
          <option value="">Mover para...</option>
          ${moveOptions}
        </select>
      </div>
    `;
  }

  function sortPipelineCards(cards) {
    return [...cards].sort((a, b) => {
      if (a.needs_human !== b.needs_human) return a.needs_human ? -1 : 1;
      const aAlta = a.prioridade === 'alta' ? 1 : 0;
      const bAlta = b.prioridade === 'alta' ? 1 : 0;
      if (aAlta !== bAlta) return bAlta - aAlta;
      return (a.last_message_at || '').localeCompare(b.last_message_at || '');
    });
  }

  const isMobilePipeline = () => window.matchMedia('(max-width: 768px)').matches;
  const pipelinePageSize = () => (isMobilePipeline() ? 8 : 15);

  function renderPipelineStageTabs(stages, columns) {
    if (!ui.pipelineStageTabs) return;
    ui.pipelineStageTabs.innerHTML = stages.map((s, i) => `
      <button type="button" class="pipeline-stage-tab${i === 0 ? ' is-active' : ''}" data-stage="${s.id}">
        ${esc(s.label)} <span class="badge badge-gray">${(columns[s.id] || []).length}</span>
      </button>
    `).join('');
  }

  function renderPipeline(data) {
    if (!ui.pipelineBoard) return;
    pipelineDataCache = data;
    const stages = data.stages || [];
    const columns = data.columns || {};
    renderPipelineStageTabs(stages, columns);
    ui.pipelineBoard.innerHTML = stages.map((s) => {
      const allCards = sortPipelineCards(columns[s.id] || []);
      const visible = pipelineVisibleCount[s.id] || pipelinePageSize();
      const cards = allCards.slice(0, visible);
      const remaining = allCards.length - cards.length;
      return `
        <div class="pipeline-column" id="pipelineCol-${s.id}">
          <div class="pipeline-column-header" style="background:${s.color}22;border-left:4px solid ${s.color};">
            <strong style="font-size:0.8rem;">${esc(s.label)}</strong>
            <span class="badge badge-gray">${allCards.length}</span>
          </div>
          <div class="pipeline-cards">
            ${cards.map((c) => pipelineCardHtml(c, stages)).join('') || '<div style="font-size:0.75rem;color:var(--text-secondary);padding:8px;">Sem contatos</div>'}
            ${remaining > 0 ? `<button type="button" class="btn btn-secondary pipeline-show-more" data-stage="${s.id}">Ver mais ${remaining}</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
    if (window.lucide) window.lucide.createIcons({ root: ui.pipelineBoard });
  }

  if (ui.pipelineStageTabs) {
    ui.pipelineStageTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.pipeline-stage-tab');
      if (!tab) return;
      const col = document.getElementById(`pipelineCol-${tab.dataset.stage}`);
      if (col) col.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      ui.pipelineStageTabs.querySelectorAll('.pipeline-stage-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    });
  }

  if (ui.pipelineBoard) {
    ui.pipelineBoard.addEventListener('change', async (e) => {
      const select = e.target.closest('.pipeline-move-select');
      if (!select || !select.value) return;
      const phone = select.dataset.phone;
      const newStage = select.value;
      try {
        const res = await apiFetch(`/api/contacts/${encodeURIComponent(phone)}/stage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: newStage }),
        });
        const data = await res.json();
        if (!res.ok) { window.Toast?.show(data.error || 'Erro ao mover.', 'error'); return; }
        window.Toast?.show('Contato movido!', 'success');
        loadPipeline().catch(() => {});
      } catch (err) {
        window.Toast?.show('Erro de conexão ao mover contato.', 'error');
      }
    });

    let pipelineScrollTicking = false;
    ui.pipelineBoard.addEventListener('scroll', () => {
      if (pipelineScrollTicking || !pipelineDataCache) return;
      pipelineScrollTicking = true;
      requestAnimationFrame(() => {
        pipelineScrollTicking = false;
        const stages = pipelineDataCache.stages || [];
        const boardRect = ui.pipelineBoard.getBoundingClientRect();
        let closest = null;
        let closestDist = Infinity;
        for (const s of stages) {
          const col = document.getElementById(`pipelineCol-${s.id}`);
          if (!col) continue;
          const dist = Math.abs(col.getBoundingClientRect().left - boardRect.left);
          if (dist < closestDist) { closestDist = dist; closest = s.id; }
        }
        if (closest && ui.pipelineStageTabs) {
          ui.pipelineStageTabs.querySelectorAll('.pipeline-stage-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.stage === closest));
        }
      });
    }, { passive: true });

    ui.pipelineBoard.addEventListener('click', (e) => {
      const btn = e.target.closest('.pipeline-show-more');
      if (!btn || !pipelineDataCache) return;
      const stageId = btn.dataset.stage;
      pipelineVisibleCount[stageId] = (pipelineVisibleCount[stageId] || pipelinePageSize()) + pipelinePageSize();
      renderPipeline(pipelineDataCache);
    });
  }

  // ── Origem do lead ──────────────────────────────────────────────────────
  async function loadOrigin() {
    if (!ui.originArea) return;
    try {
      const res = await fetch('/api/stats/origem');
      if (!res.ok) return;
      const rows = await res.json();
      renderOrigin(rows);
    } catch (err) {
      console.error('[origin] load', err);
    }
  }

  function renderOrigin(rows) {
    if (!ui.originArea) return;
    if (!rows.length) {
      ui.originArea.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:24px;">Sem atendimentos registrados ainda.</div>';
      return;
    }
    ui.originArea.innerHTML = `
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>Origem</th>
              <th style="text-align:center;">Atendimentos</th>
              <th style="text-align:center;">Orçamentos</th>
              <th style="text-align:center;">Vendas</th>
              <th style="text-align:center;">Perdidas</th>
              <th style="text-align:center;">Conversão</th>
              <th style="text-align:right;">Valor vendido</th>
              <th style="text-align:right;">Valor parado</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td data-label="Origem">${esc(r.label)}</td>
                <td data-label="Atendimentos">${r.atendimentos}</td>
                <td data-label="Orçamentos">${r.orcamentos}</td>
                <td data-label="Vendas">${r.vendas_concluidas}</td>
                <td data-label="Perdidas">${r.vendas_perdidas}</td>
                <td data-label="Conversão">${r.taxa_conversao}%</td>
                <td data-label="Valor vendido">${fmtMoney(r.valor_vendido_cents)}</td>
                <td data-label="Valor parado">${fmtMoney(r.valor_parado_cents)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderTipoCliente(v) {
    if (!ui.tipoClienteArea) return;
    v = v || {};
    const pf = v.pf || { n: 0, valor_cents: 0 };
    const pj = v.pj || { n: 0, valor_cents: 0 };
    if (!pf.n && !pj.n) { ui.tipoClienteArea.innerHTML = ''; return; }
    ui.tipoClienteArea.innerHTML = `
      <div class="stat-card" style="flex:1;min-width:180px;">
        <div class="stat-card-header"><span>Pessoa física</span><i data-lucide="user"></i></div>
        <div class="stat-card-value">${pf.n}</div>
        <div class="stat-card-footer"><span>${fmtMoney(pf.valor_cents)} vendidos</span></div>
      </div>
      <div class="stat-card" style="flex:1;min-width:180px;">
        <div class="stat-card-header"><span>Empresa (CNPJ)</span><i data-lucide="building-2"></i></div>
        <div class="stat-card-value">${pj.n}</div>
        <div class="stat-card-footer"><span>${fmtMoney(pj.valor_cents)} vendidos</span></div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: ui.tipoClienteArea });
  }

  function renderFunnel(porEtapa) {
    if (!ui.funnelChart) return;
    if (funnelChartObj) { funnelChartObj.destroy(); }

    const totalContatos = porEtapa.reduce((sum, e) => sum + (e.total || 0), 0);
    const funnelConversionEl = document.getElementById('funnelConversion');
    if (funnelConversionEl) {
      funnelConversionEl.innerHTML = totalContatos
        ? porEtapa.map((e) => {
            const pct = Math.round(((e.total || 0) / totalContatos) * 100);
            return `<div style="display:flex;justify-content:space-between;font-size:0.75rem;padding:2px 0;">
              <span>${esc(e.label)}</span><span style="color:var(--text-secondary);">${e.total} (${pct}%)</span>
            </div>`;
          }).join('')
        : '';
    }

    const funnelColors = ['#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#f97316'];
    const bgColors = porEtapa.map((e, i) => funnelColors[i % funnelColors.length]);

    funnelChartObj = new Chart(ui.funnelChart, {
      type: 'bar',
      data: {
        labels: porEtapa.map((e) => e.label),
        datasets: [{
          data: porEtapa.map((e) => e.total),
          backgroundColor: bgColors,
          borderRadius: 4
        }],
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          // precision 0: contagem de contatos é inteira — sem ticks 0.2/0.4.
          x: { grid: { color: '#EAECF0' }, beginAtZero: true, ticks: { precision: 0 } },
          y: { grid: { display: false } },
        },
      },
    });
  }

  // ── Vendas e pedidos ────────────────────────────────────────────────────
  function saleStatusLabel(status) {
    return {
      rascunho: 'Rascunho',
      checkout_enviado: 'Checkout enviado',
      aguardando_pagamento: 'Aguardando pagamento',
      pago: 'Pago',
      perdido: 'Perdido',
    }[status] || status || '—';
  }

  window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text)
      .then(() => window.Toast?.show('Copiado para a área de transferência!', 'success'))
      .catch(() => window.Toast?.show('Erro ao copiar.', 'error'));
  };

  window.updateSaleStatus = async function(id, status) {
    try {
      const res = await apiFetch(`/api/sales/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      if (!res.ok) throw new Error('Falha ao atualizar status da venda');
      window.Toast?.show(`Venda atualizada para ${saleStatusLabel(status)}.`, 'success');
      await refreshData();
    } catch (err) {
      window.Toast?.show(err.message || 'Erro ao atualizar venda.', 'error');
    }
  };

  // Melhor Envio — gera etiqueta, imprime PDF e devolve o rastreio.
  // Fluxo:
  //   pending → clicou "Gerar etiqueta" → POST /api/sales/:id/etiqueta
  //   sucesso → mostra código e link do PDF
  //   422 scope_missing → toast com instrução pra reautorizar o token
  //   outros erros → toast com o motivo (saldo insuficiente, etc)
  window.gerarEtiquetaME = async function(id, ev) {
    if (ev?.currentTarget) {
      ev.currentTarget.disabled = true;
      ev.currentTarget.innerHTML = '<i data-lucide="loader-2" class="animate-spin"></i> Gerando...';
      if (window.lucide) window.lucide.createIcons({ root: ev.currentTarget });
    }
    try {
      const res = await apiFetch(`/api/sales/${id}/etiqueta`, { method: 'POST', body: JSON.stringify({}) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        window.Toast?.show(
          data.already_generated
            ? `Etiqueta já foi gerada. Rastreio: ${data.tracking}`
            : `Etiqueta gerada! Rastreio: ${data.tracking}`,
          'success',
        );
        if (data.labelUrl) window.open(data.labelUrl, '_blank', 'noopener');
        await refreshData();
        return;
      }
      // 422 scope_missing: token do lojista não tem os escopos de etiqueta
      // (shipping-generate, shipping-checkout, shipping-print)
      if (data.code === 'scope_missing') {
        window.Toast?.show(
          (data.hint || 'Token do Melhor Envio sem permissão para gerar etiqueta.') + ' Depois cole o novo token em Integrações.',
          'error',
          9000,
        );
        return;
      }
      window.Toast?.show(data.error || 'Falha ao gerar etiqueta.', 'error');
    } catch (err) {
      window.Toast?.show('Erro de conexão ao gerar etiqueta: ' + err.message, 'error');
    } finally {
      await refreshData(); // restaura o estado do botão via re-render
    }
  };

  // Envio manual do rastreio no WhatsApp. Idempotente no backend — se já
  // enviou uma vez, o próximo clique retorna { ok:true, already_sent:true }.
  window.notificarRastreioME = async function(id, ev) {
    if (ev?.currentTarget) {
      ev.currentTarget.disabled = true;
      ev.currentTarget.innerHTML = '<i data-lucide="loader-2" class="animate-spin"></i>';
      if (window.lucide) window.lucide.createIcons({ root: ev.currentTarget });
    }
    try {
      const res = await apiFetch(`/api/sales/${id}/etiqueta/notify`, { method: 'POST', body: JSON.stringify({}) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        window.Toast?.show(data.already_sent ? 'Rastreio já havia sido enviado.' : 'Rastreio enviado ao cliente no WhatsApp!', 'success');
      } else {
        window.Toast?.show(data.error || 'Falha ao enviar rastreio.', 'error');
      }
    } catch (err) {
      window.Toast?.show('Erro de conexão: ' + err.message, 'error');
    } finally {
      await refreshData();
    }
  };

  window.printComanda = async function(id) {
    try {
      const res = await apiFetch(`/api/sales/${id}/print`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const num = data.comanda_number ? ` #${data.comanda_number}` : '';
        window.Toast?.show(`Comanda${num} enviada para a impressora!`, 'success');
      } else {
        window.Toast?.show(data.error || 'Erro ao imprimir comanda.', 'error');
      }
    } catch (err) {
      window.Toast?.show('Erro de conexão ao imprimir.', 'error');
    }
  };

  // Botão de etiqueta Melhor Envio. Aparece só em vendas pagas com endereço
  // de entrega (order_type='delivery' ou delivery_address preenchido).
  // Estado vem de sale.me_label_status: pendente → 'Gerar etiqueta';
  // gerada → 'Ver etiqueta' (abre PDF); erro → 'Tentar de novo' (mostra motivo).
  function meEtiquetaButtonHtml(sale, opts = {}) {
    const compact = opts.compact !== false;
    const iconOnly = opts.iconOnly === true;
    if (sale.status !== 'pago') return '';
    const hasAddress = sale.delivery_address || sale.order_type === 'delivery';
    if (!hasAddress) return '';

    const st = sale.me_label_status || 'pendente';
    if (st === 'gerada' && sale.me_label_url) {
      const labelPdf = iconOnly ? '' : ' Ver etiqueta';
      let html = `<a href="${esc(sale.me_label_url)}" target="_blank" rel="noopener" class="btn ${compact ? 'btn-icon btn-compact' : 'btn-secondary btn-compact'}" title="Ver PDF da etiqueta (rastreio ${esc(sale.me_tracking_code || '')})"><i data-lucide="file-badge"></i>${labelPdf}</a>`;
      // Botão "Avisar cliente" (envia rastreio no WhatsApp).
      // Se já foi enviado antes, mostra confirmação e não permite reenvio.
      if (sale.me_tracking_sent_at) {
        const labelSent = iconOnly ? '' : ' Rastreio enviado';
        html += `<span class="btn ${compact ? 'btn-icon btn-compact' : 'btn-ghost btn-compact'}" style="cursor:default;color:var(--success-600, #16a34a);" title="Rastreio enviado ao cliente em ${esc(sale.me_tracking_sent_at)}"><i data-lucide="check"></i>${labelSent}</span>`;
      } else {
        const labelSend = iconOnly ? '' : ' Avisar cliente';
        html += `<button class="btn ${compact ? 'btn-icon btn-compact' : 'btn-primary btn-compact'}" title="Enviar rastreio pro cliente no WhatsApp" onclick="notificarRastreioME('${esc(sale.id)}', event)"><i data-lucide="send"></i>${labelSend}</button>`;
      }
      return html;
    }
    if (st === 'erro') {
      const label = iconOnly ? '' : ' Etiqueta';
      const err = esc(sale.me_label_error || 'Falha desconhecida');
      return `<button class="btn ${compact ? 'btn-icon btn-compact' : 'btn-secondary btn-compact'} text-danger" title="Erro: ${err}. Clique pra tentar de novo." onclick="gerarEtiquetaME('${esc(sale.id)}', event)"><i data-lucide="package-x"></i>${label}</button>`;
    }
    // pendente (nunca gerada)
    const label = iconOnly ? '' : ' Etiqueta';
    return `<button class="btn ${compact ? 'btn-icon btn-compact' : 'btn-secondary btn-compact'}" title="Gerar etiqueta no Melhor Envio" onclick="gerarEtiquetaME('${esc(sale.id)}', event)"><i data-lucide="package"></i>${label}</button>`;
  }

  function isSaleAwaitingResponse(sale) {
    const stalledStatuses = ['checkout_enviado', 'aguardando_pagamento', 'pending'];
    if (!stalledStatuses.includes(sale.status)) return false;
    const updatedAt = new Date(sale.updated_at);
    if (Number.isNaN(updatedAt.getTime())) return false;
    const hoursElapsed = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
    return hoursElapsed >= saleNoResponseAlertHours;
  }

  function saleNoResponseWarningHtml(sale) {
    if (!isSaleAwaitingResponse(sale)) return '';
    const hoursElapsed = (Date.now() - new Date(sale.updated_at).getTime()) / (1000 * 60 * 60);
    const roundedHours = Math.max(1, Math.round(hoursElapsed));
    const threshold = Math.max(1, Math.round(saleNoResponseAlertHours));
    const title = `Cliente sem resposta há ${roundedHours}h. Alerta configurado para ${threshold}h.`;
    return `<span class="sale-time-warning sale-time-warning-danger" title="${esc(title)}">🚨 ${roundedHours}h sem resposta</span>`;
  }

  function saleAssumeButtonHtml(phone, label = 'Assumir conversa') {
    return `<a class="btn btn-primary btn-compact" href="${contactUrl(phone, true)}">${label}</a>`;
  }

  function renderSalesMetrics(stats) {
    const area = document.getElementById('salesMetricsArea');
    if (!area) return;

    const totalCheckouts = (stats.sales_checkout_enviado || 0) + (stats.sales_pagos || 0) + (stats.sales_perdidos || 0);
    const convRate = totalCheckouts ? Math.round((stats.sales_pagos / totalCheckouts) * 100) : 0;

    const receitaPaga = fmtMoney(stats.sales_receita_paga_cents || 0);
    const receitaEmAberto = fmtMoney(stats.sales_receita_em_aberto_cents || 0);

    area.innerHTML = `
      <div class="metric-card">
        <span class="metric-card-title">Receita Paga</span>
        <span class="metric-card-value">${receitaPaga}</span>
        <span class="metric-card-subtitle">Vendas aprovadas</span>
      </div>
      <div class="metric-card">
        <span class="metric-card-title">Receita em Aberto</span>
        <span class="metric-card-value">${receitaEmAberto}</span>
        <span class="metric-card-subtitle">Checkouts pendentes</span>
      </div>
      <div class="metric-card">
        <span class="metric-card-title">Checkouts Enviados</span>
        <span class="metric-card-value">${stats.sales_checkout_enviado || 0}</span>
        <span class="metric-card-subtitle">Aguardando pagamento</span>
      </div>
      <div class="metric-card">
        <span class="metric-card-title">Vendas Pagas</span>
        <span class="metric-card-value">${stats.sales_pagos || 0}</span>
        <span class="metric-card-subtitle">Convertidas com sucesso</span>
      </div>
      <div class="metric-card">
        <span class="metric-card-title">Vendas Perdidas</span>
        <span class="metric-card-value">${stats.sales_perdidos || 0}</span>
        <span class="metric-card-subtitle">Canceladas/Expiradas</span>
      </div>
      <div class="metric-card">
        <span class="metric-card-title">Taxa de Conversão</span>
        <span class="metric-card-value">${convRate}%</span>
        <span class="metric-card-subtitle">Checkout para Pago</span>
      </div>
    `;
  }

  function renderDashboardSales(sales) {
    if (!ui.salesArea) return;

    let filteredSales = sales;
    if (salesFilter !== 'todos') {
      filteredSales = sales.filter(s => s.status === salesFilter);
    }

    if (!filteredSales.length) {
      if (!salesCache.length) {
        const mpConnected = meData?.mp_token_set || false;
        ui.salesArea.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">
              <i data-lucide="shopping-cart"></i>
            </div>
            <h3 class="empty-state-title">Nenhuma venda registrada ainda</h3>
            <p class="empty-state-desc">As vendas aparecerão aqui assim que a IA identificar um pedido ou enviar um link de pagamento nas conversas.</p>

            <div class="empty-state-features" style="margin-top: 16px; font-size: 0.875rem; color: var(--text-secondary); max-width: 450px;">
              ${mpConnected
                ? `<div style="display:flex;align-items:center;gap:8px;justify-content:center;background:#f0fdf4;border:1px solid #bbf7d0;padding:10px 14px;border-radius:8px;color:#166534;margin-bottom:12px;">
                     <i data-lucide="check-circle" style="width:16px;height:16px;color:#16a34a;flex-shrink:0;"></i>
                     <span><strong>Mercado Pago conectado!</strong> Os links de checkout serão gerados automaticamente.</span>
                   </div>`
                : `<div style="display:flex;align-items:center;gap:8px;justify-content:center;background:#fffbeb;border:1px solid #fde047;padding:10px 14px;border-radius:8px;color:#854d0e;margin-bottom:12px;">
                     <i data-lucide="alert-triangle" style="width:16px;height:16px;color:#ca8a04;flex-shrink:0;"></i>
                     <span>Conecte o Mercado Pago para habilitar checkouts automáticos.</span>
                   </div>`
              }
            </div>

            <div class="flex gap-4 justify-center flex-wrap">
              <a href="/settings.html" class="btn btn-secondary text-sm">
                <i data-lucide="plus"></i> Cadastrar produtos
              </a>
              ${!mpConnected
                ? `<a href="/settings.html" class="btn btn-primary text-sm">
                     <i data-lucide="credit-card"></i> Conectar Mercado Pago
                   </a>`
                : ''
              }
            </div>
          </div>
        `;
        if (window.lucide) window.lucide.createIcons({root: ui.salesArea});
        return;
      }

      ui.salesArea.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <i data-lucide="filter"></i>
          </div>
          <h3 class="empty-state-title">Nenhuma venda encontrada</h3>
          <p class="empty-state-desc">Não há nenhuma venda com o status "${saleStatusLabel(salesFilter)}" no momento.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({root: ui.salesArea});
      return;
    }

    const desktopRows = filteredSales.map((sale) => {
      const items = (sale.items || []).map(i => `${i.quantidade || 1}x ${i.titulo || i.nome || 'Item'}`).join(', ');
      const timeWarningHtml = saleNoResponseWarningHtml(sale);

      let actionsHtml = `<a class="btn btn-icon btn-compact" title="Abrir conversa" href="${contactUrl(sale.phone)}"><i data-lucide="message-square"></i></a>`;

      if (sale.checkout_url) {
        actionsHtml += `
          <a href="${esc(sale.checkout_url)}" target="_blank" rel="noopener" class="btn btn-icon btn-compact" title="Abrir checkout"><i data-lucide="external-link"></i></a>
          <button class="btn btn-icon btn-compact" title="Copiar link do checkout" onclick="copyToClipboard('${esc(sale.checkout_url)}')"><i data-lucide="copy"></i></button>
        `;
      }

      if (isSaleAwaitingResponse(sale)) {
        actionsHtml += saleAssumeButtonHtml(sale.phone, 'Assumir');
      }

      if (sale.order_type) {
        const tipoLabel = { delivery: '🛵 Delivery', retirada: '🏪 Retirada', mesa: '🪑 Mesa' }[sale.order_type] || sale.order_type;
        actionsHtml += `<button class="btn btn-icon btn-compact" title="Imprimir comanda" onclick="printComanda('${esc(sale.id)}')"><i data-lucide="printer"></i></button>`;
      }

      actionsHtml += meEtiquetaButtonHtml(sale, { iconOnly: true });

      if (sale.status !== 'pago') {
        actionsHtml += `
          <button class="btn btn-secondary btn-compact" onclick="updateSaleStatus('${sale.id}', 'pago')">Pago</button>
          <button class="btn btn-ghost btn-compact text-danger" onclick="updateSaleStatus('${sale.id}', 'perdido')">Perdido</button>
        `;
      } else {
        actionsHtml += `<button class="btn btn-ghost btn-compact" onclick="updateSaleStatus('${sale.id}', 'checkout_enviado')">Reabrir</button>`;
      }

      const orderTypeBadge = sale.order_type
        ? `<span class="badge badge-gray" style="margin-left:4px;font-size:0.65rem;">${{ delivery: '🛵', retirada: '🏪', mesa: '🪑' }[sale.order_type] || sale.order_type}</span>`
        : '';

      return `<tr>
        <td data-label="Cliente">
          <a class="contact-name" style="text-decoration:none;" href="${contactUrl(sale.phone)}">${esc(sale.name) || esc(sale.phone)}</a>
          <div class="contact-phone">${esc(sale.phone)}</div>
        </td>
        <td data-label="Pedido"><div class="sale-items" title="${esc(items)}">${esc(items || 'Sem itens')}${orderTypeBadge}</div></td>
        <td data-label="Valor"><strong>${fmtMoney(sale.total_cents)}</strong>${sale.delivery_fee > 0 ? `<div style="font-size:0.7rem;color:var(--text-secondary);">+${fmtMoney(sale.delivery_fee)} entrega</div>` : ''}</td>
        <td data-label="Status">
          <span class="sale-status sale-status-${esc(sale.status)}">${saleStatusLabel(sale.status)}</span>
          ${timeWarningHtml}
        </td>
        <td data-label="Atualizado">${fmtDate(sale.updated_at)}</td>
        <td data-label="Ação"><div class="flex items-center gap-2">${actionsHtml}</div></td>
      </tr>`;
    }).join('');

    const mobileCards = filteredSales.map((sale) => {
      const items = (sale.items || []).map(i => `${i.quantidade || 1}x ${i.titulo || i.nome || 'Item'}`).join(', ');
      const timeWarningHtml = saleNoResponseWarningHtml(sale);

      let actionsHtml = `<a class="btn btn-secondary btn-compact" href="${contactUrl(sale.phone)}"><i data-lucide="message-square"></i> Chat</a>`;

      if (sale.checkout_url) {
        actionsHtml += `
          <a href="${esc(sale.checkout_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-compact"><i data-lucide="external-link"></i> Checkout</a>
          <button class="btn btn-secondary btn-compact" onclick="copyToClipboard('${esc(sale.checkout_url)}')"><i data-lucide="copy"></i> Copiar</button>
        `;
      }

      if (isSaleAwaitingResponse(sale)) {
        actionsHtml += saleAssumeButtonHtml(sale.phone);
      }

      if (sale.order_type) {
        actionsHtml += `<button class="btn btn-secondary btn-compact" onclick="printComanda('${esc(sale.id)}')"><i data-lucide="printer"></i> Comanda</button>`;
      }

      actionsHtml += meEtiquetaButtonHtml(sale, { iconOnly: false });

      if (sale.status !== 'pago') {
        actionsHtml += `
          <button class="btn btn-primary btn-compact" onclick="updateSaleStatus('${sale.id}', 'pago')">Pago</button>
          <button class="btn btn-ghost btn-compact text-danger" onclick="updateSaleStatus('${sale.id}', 'perdido')">Perdido</button>
        `;
      } else {
        actionsHtml += `<button class="btn btn-ghost btn-compact" onclick="updateSaleStatus('${sale.id}', 'checkout_enviado')">Reabrir</button>`;
      }

      const orderTypeMobile = sale.order_type
        ? `<span style="font-size:0.7rem;color:var(--text-secondary);">${{ delivery: '🛵 Delivery', retirada: '🏪 Retirada', mesa: '🪑 Mesa' }[sale.order_type] || sale.order_type}</span>`
        : '';

      return `
        <div class="sale-mobile-card">
          <div class="sale-mobile-card-header">
            <div class="sale-mobile-card-client">
              <a class="sale-mobile-card-name" style="text-decoration:none;" href="${contactUrl(sale.phone)}">${esc(sale.name) || esc(sale.phone)}</a>
              <span class="sale-mobile-card-phone">${esc(sale.phone)}</span>
              ${orderTypeMobile}
            </div>
            <div>
              <span class="sale-status sale-status-${esc(sale.status)}">${saleStatusLabel(sale.status)}</span>
              ${timeWarningHtml ? `<div style="margin-top: 4px; text-align: right;">${timeWarningHtml}</div>` : ''}
            </div>
          </div>
          <div class="sale-mobile-card-body">
            <div class="sale-mobile-card-items">${esc(items || 'Sem itens')}</div>
            <div class="sale-mobile-card-price-status">
              <span class="sale-mobile-card-price">${fmtMoney(sale.total_cents)}</span>
              ${sale.delivery_fee > 0 ? `<span style="font-size:0.7rem;color:var(--text-secondary);">+${fmtMoney(sale.delivery_fee)} entrega</span>` : ''}
            </div>
          </div>
          <div class="sale-mobile-card-footer">
            <div style="font-size:0.6875rem; color:var(--text-secondary); margin-bottom: 4px;">Atualizado: ${fmtDate(sale.updated_at)}</div>
            <div class="sale-mobile-card-actions">${actionsHtml}</div>
          </div>
        </div>
      `;
    }).join('');

    ui.salesArea.innerHTML = `
      <div class="table-container">
        <table class="table">
          <thead><tr><th>Cliente</th><th>Pedido</th><th>Valor</th><th>Status</th><th>Atualizado</th><th>Ações</th></tr></thead>
          <tbody>${desktopRows}</tbody>
        </table>
      </div>
      <div class="sales-cards-container">
        ${mobileCards}
      </div>
    `;
    if (window.lucide) window.lucide.createIcons({root: ui.salesArea});
  }

  document.querySelectorAll('.sales-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.sales-filter-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      salesFilter = e.currentTarget.dataset.status;
      renderDashboardSales(salesCache);
    });
  });

  // ── Boot / dados ────────────────────────────────────────────────────────
  async function loadDashboardSettings() {
    try {
      const settingsRes = await fetch('/api/settings');
      if (!settingsRes.ok) return;
      const settings = await settingsRes.json();
      const configuredHours = Number(settings.business?.alerta_sem_resposta_horas);
      if (Number.isFinite(configuredHours) && configuredHours > 0) {
        saleNoResponseAlertHours = configuredHours;
      }
    } catch (err) {
      console.error('load/settings:', err);
    }
  }

  async function refreshData() {
    const [statsRes, salesRes] = await Promise.all([
      fetch('/api/stats').catch(() => null), fetch('/api/sales').catch(() => null),
    ]);

    const emptyStats = { receita_total: 0, vendas_reais: 0, taxa_conversao: 0, por_etapa: [],
      dinheiro_parado: { vendas_paradas_cents: 0, orcamentos_sem_resposta: 0, aguardando_pagamento: 0, fretes_sem_compra: 0, clientes_sem_retorno: 0, precisa_humano: 0, cadastros_incompletos: 0 },
      vendas_por_tipo_cliente: { pf: { n: 0, valor_cents: 0 }, pj: { n: 0, valor_cents: 0 }, indefinido: { n: 0, valor_cents: 0 } } };

    let stats = emptyStats;
    if (statsRes && statsRes.ok) {
      try { stats = await statsRes.json(); } catch { stats = emptyStats; }
    }
    renderVendasKpis(stats);
    renderSalesMetrics(stats);
    renderStuckMoney(stats.dinheiro_parado);
    renderTipoCliente(stats.vendas_por_tipo_cliente);
    if (window.Chart) renderFunnel(stats.por_etapa || []);

    if (salesRes && salesRes.ok) {
      try { salesCache = await salesRes.json(); } catch { salesCache = []; }
    } else {
      salesCache = [];
    }
    renderDashboardSales(salesCache);
  }

  async function load() {
    let me = {};
    try {
      const meRes = await fetch('/api/me');
      if (meRes.ok) me = await meRes.json();
    } catch (err) { console.error('load/me:', err); }

    meData = me;
    const anyBilling = me.features?.billingEnabled || me.features?.mpBillingEnabled;
    if (anyBilling && !me.is_admin && !me.impersonatedBy && !me.subscription?.canUseBot) {
      location.href = '/plans.html';
      return;
    }

    if (me.is_admin && ui.adminLink) ui.adminLink.classList.remove('hidden');
    if (!me.is_admin) { const s = document.getElementById('supportBtn'); if (s) s.style.display = ''; }
    if (me.impersonatedBy && ui.impersonateBar) {
      ui.impersonateBar.style.display = 'flex';
      if (ui.impersonateEmail) ui.impersonateEmail.textContent = me.email;
    }
    window.ZapUI.setupProfileDropdown(me, apiFetch);
    window.ZapUI.setupSupportLink(me.supportPhone);

    loadOrigin().catch((err) => console.error('load/origin:', err));
    loadPipeline().catch((err) => console.error('load/pipeline:', err));
    loadOpportunities().catch((err) => console.error('load/opportunities:', err));
    loadCampaignsUI().catch((err) => console.error('load/campaigns:', err));
    await loadDashboardSettings();
    await refreshData();

    const salesRefresh = window.ZapUI.createRefreshScheduler({
      interval: 30000,
      task: () => Promise.all([
        refreshData(),
        loadPipeline(),
        loadOpportunities(),
      ]),
    });
    salesRefresh.start();
  }

  load().catch(console.error);

  // ── Fiscal export / balancete ────────────────────────────────────────────
  function initFiscalExport() {
    const fromEl = document.getElementById('fiscal-from');
    const toEl = document.getElementById('fiscal-to');
    const exportBtn = document.getElementById('fiscal-export-btn');
    const monthBtn = document.getElementById('fiscal-month-btn');
    const lastMonthBtn = document.getElementById('fiscal-lastmonth-btn');
    if (!fromEl || !toEl || !exportBtn) return;

    function setCurrentMonth() {
      const now = new Date();
      const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
      fromEl.value = `${y}-${m}-01`;
      toEl.value = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
      updateExportHref();
    }

    function setLastMonth() {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      fromEl.value = first.toISOString().slice(0, 10);
      toEl.value = last.toISOString().slice(0, 10);
      updateExportHref();
    }

    function updateExportHref() {
      const from = fromEl.value;
      const to = toEl.value;
      if (from && to) {
        exportBtn.href = `/api/sales/export/fiscal.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      }
    }

    monthBtn?.addEventListener('click', setCurrentMonth);
    lastMonthBtn?.addEventListener('click', setLastMonth);
    fromEl.addEventListener('change', updateExportHref);
    toEl.addEventListener('change', updateExportHref);
    setCurrentMonth();
  }

  initFiscalExport();
});
