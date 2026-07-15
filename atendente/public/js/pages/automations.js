/**
 * Automações — lista, construtor em 4 etapas (Quando → Se → Então → Revisar),
 * teste em simulação (dry run) e histórico de execuções.
 */
document.addEventListener('DOMContentLoaded', () => {
  let _csrfToken = null;
  let options = null;      // /api/automations/options
  let automations = [];
  let limitActive = 0;
  let activeCount = 0;
  let businessType = 'loja';

  async function getCsrfToken() {
    if (_csrfToken) return _csrfToken;
    const r = await fetch('/api/csrf-token');
    if (r.ok) _csrfToken = (await r.json()).token;
    return _csrfToken;
  }

  async function apiFetch(url, opts = {}) {
    const token = await getCsrfToken();
    return fetch(url, {
      ...opts,
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        'X-CSRF-Token': token,
        ...opts.headers,
      },
    });
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Rótulos humanos ────────────────────────────────────────────────────────
  const TRIGGER_LABEL = {
    contact_created: 'um novo cliente chegar',
    stage_changed: 'um cliente mudar de etapa',
    buy_intent_changed: 'a intenção de compra mudar',
    handoff_requested: 'um cliente pedir atendimento humano',
    checkout_sent: 'um link de pagamento for enviado',
    sale_paid: 'um pagamento for aprovado',
    product_restocked: 'um produto voltar ao estoque',
    contact_idle: 'um cliente ficar sem responder',
  };
  const CONDITION_LABEL = {
    stage_equals: 'a etapa for',
    stage_in: 'a etapa estiver entre',
    buy_intent_equals: 'a intenção de compra for',
    has_tag: 'o cliente tiver a tag',
    does_not_have_tag: 'o cliente NÃO tiver a tag',
    product_equals: 'o produto for',
    sale_amount_greater_than: 'o valor da venda for maior que',
    sale_amount_less_than: 'o valor da venda for menor que',
    origin_equals: 'a origem do cliente for',
    customer_type_equals: 'o tipo de cliente for',
    within_business_hours: 'estiver dentro do horário de atendimento',
    outside_business_hours: 'estiver fora do horário de atendimento',
  };
  const ACTION_LABEL = {
    add_tag: 'adicionar a tag',
    remove_tag: 'remover a tag',
    change_stage: 'mover o cliente para a etapa',
    pause_ai: 'pausar o atendimento automático',
    resume_ai: 'retomar o atendimento automático',
    create_internal_notification: 'criar um aviso na Central de Avisos',
    send_push_notification: 'enviar notificação no seu aparelho',
    send_whatsapp_template: 'enviar o template aprovado',
    dispatch_existing_webhook: 'disparar seu webhook (Integrações)',
  };
  const BUY_INTENTS = [['baixa', 'Baixa'], ['media', 'Média'], ['alta', 'Alta']];
  const RUN_STATUS = {
    success: ['Executada', 'badge-success'],
    skipped: ['Não se aplicou', 'badge-gray'],
    failed: ['Falhou', 'badge-danger'],
  };
  const BUSINESS_LABEL = {
    loja: 'Loja e produtos',
    servicos: 'Serviços',
    alimentacao: 'Alimentação e delivery',
    digital: 'Produtos digitais',
  };
  const GOAL_META = {
    alta_intencao_parada: {
      title: 'Retomar cliente interessado',
      benefit: 'Avise você quando um cliente com alta intenção parar de responder.',
      icon: 'flame',
    },
    checkout_sem_pagamento: {
      title: 'Lembrar pagamento pendente',
      benefit: 'Envie um lembrete aprovado quando o pagamento não chegar.',
      icon: 'credit-card',
    },
    pedido_atendimento_humano: {
      title: 'Não perder pedido de ajuda',
      benefit: 'Avise sua equipe assim que alguém pedir atendimento humano.',
      icon: 'headphones',
    },
    pagamento_aprovado: {
      title: 'Organizar quem já comprou',
      benefit: 'Marque clientes automaticamente depois do pagamento aprovado.',
      icon: 'badge-check',
    },
    produto_voltou_estoque: {
      title: 'Acompanhar reposição de estoque',
      benefit: 'Registre um aviso sempre que a lista de espera for atendida.',
      icon: 'package-check',
    },
  };
  const GOAL_ORDER = {
    loja: ['checkout_sem_pagamento', 'alta_intencao_parada', 'produto_voltou_estoque', 'pedido_atendimento_humano', 'pagamento_aprovado'],
    servicos: ['pedido_atendimento_humano', 'alta_intencao_parada', 'checkout_sem_pagamento', 'pagamento_aprovado', 'produto_voltou_estoque'],
    alimentacao: ['pedido_atendimento_humano', 'checkout_sem_pagamento', 'pagamento_aprovado', 'alta_intencao_parada', 'produto_voltou_estoque'],
    digital: ['checkout_sem_pagamento', 'pagamento_aprovado', 'alta_intencao_parada', 'pedido_atendimento_humano', 'produto_voltou_estoque'],
  };

  function normalizeBusinessType(value) {
    const type = String(value || '').toLowerCase();
    if (['alimentacao', 'pizzaria', 'restaurante', 'delivery'].includes(type)) return 'alimentacao';
    if (['servicos', 'serviço', 'serviços'].includes(type)) return 'servicos';
    if (['digital', 'produto_digital', 'infoproduto'].includes(type)) return 'digital';
    return 'loja';
  }

  function fmtDateTime(iso) {
    if (!iso) return 'Nunca';
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function minutesLabel(min) {
    if (!min) return '';
    if (min % 1440 === 0) return `${min / 1440} dia(s)`;
    if (min % 60 === 0) return `${min / 60} hora(s)`;
    return `${min} minuto(s)`;
  }

  function stageLabel(id) {
    return options?.stages.find((s) => s.id === id)?.label || id;
  }

  function conditionSentence(c) {
    switch (c.type) {
      case 'stage_equals': return `${CONDITION_LABEL[c.type]} "${stageLabel(c.value)}"`;
      case 'stage_in': return `${CONDITION_LABEL[c.type]} ${c.values.map(stageLabel).map((v) => `"${v}"`).join(', ')}`;
      case 'sale_amount_greater_than':
      case 'sale_amount_less_than': return `${CONDITION_LABEL[c.type]} R$ ${Number(c.value).toFixed(2).replace('.', ',')}`;
      case 'within_business_hours':
      case 'outside_business_hours': return CONDITION_LABEL[c.type];
      default: return `${CONDITION_LABEL[c.type] || c.type} "${c.value ?? ''}"`;
    }
  }

  function actionSentence(a) {
    switch (a.type) {
      case 'add_tag': case 'remove_tag': return `${ACTION_LABEL[a.type]} "${a.tag}"`;
      case 'change_stage': return `${ACTION_LABEL[a.type]} "${stageLabel(a.stage)}"`;
      case 'send_whatsapp_template': return `${ACTION_LABEL[a.type]} "${a.template_nome || '—'}"`;
      case 'create_internal_notification': return a.title ? `${ACTION_LABEL[a.type]}: "${a.title}"` : ACTION_LABEL[a.type];
      case 'send_push_notification': return a.title ? `${ACTION_LABEL[a.type]}: "${a.title}"` : ACTION_LABEL[a.type];
      default: return ACTION_LABEL[a.type] || a.type;
    }
  }

  function humanSummary(a) {
    let when = `Quando ${TRIGGER_LABEL[a.trigger_type] || a.trigger_type}`;
    if (a.trigger_type === 'contact_idle' && a.trigger_config?.idle_minutes) {
      when = `Quando um cliente ficar ${minutesLabel(a.trigger_config.idle_minutes)} sem responder`;
    } else if (a.trigger_config?.delay_minutes) {
      when += ` e se passarem ${minutesLabel(a.trigger_config.delay_minutes)}`;
    }
    const ifs = (a.conditions || []).length
      ? `, se ${a.conditions.map(conditionSentence).join(' e ')}`
      : '';
    const thens = ` então ${a.actions.map(actionSentence).join(', depois ')}`;
    return `${when}${ifs},${thens}.`;
  }

  // ── Lista ──────────────────────────────────────────────────────────────────
  async function load() {
    const stateEl = document.getElementById('automations-skeleton');
    if (stateEl) {
      stateEl.style.display = 'block';
      window.ZapUI.renderAsyncState(stateEl, {
        state: 'loading',
        title: 'Carregando suas automações…',
        message: 'Estamos organizando regras, limites e recomendações.',
      });
    }
    try {
      const [listRes, optRes, meRes, settingsRes] = await Promise.all([
        fetch('/api/automations'),
        fetch('/api/automations/options'),
        fetch('/api/me').catch(() => null),
        fetch('/api/settings').catch(() => null),
      ]);
      if (!listRes.ok || !optRes.ok) throw new Error();
      const data = await listRes.json();
      options = await optRes.json();
      automations = data.automations;
      limitActive = data.limit_active;
      activeCount = data.active_count;
      if (settingsRes?.ok) {
        const settings = await settingsRes.json();
        businessType = normalizeBusinessType(settings.business?.tipo_negocio);
      }
      if (meRes?.ok) {
        const me = await meRes.json();
        window.ZapUI.setupProfileDropdown(me, apiFetch);
        window.ZapUI.setupSupportLink(me.features?.supportPhone);
        if (me.is_admin) document.getElementById('adminLink')?.classList.remove('hidden');
      }
      render();
    } catch {
      if (stateEl) {
        window.ZapUI.renderAsyncState(stateEl, {
          state: 'error',
          title: 'Não foi possível carregar as automações',
          message: 'Sua configuração continua segura. Verifique a conexão e tente novamente.',
          actionLabel: 'Tentar novamente',
          onAction: load,
        });
      }
    }
  }

  function render() {
    document.getElementById('automations-skeleton').style.display = 'none';
    const listEl = document.getElementById('automations-list');
    const ownedEl = document.getElementById('automations-owned');
    const emptyEl = document.getElementById('automations-empty');
    const limitInfo = document.getElementById('automations-limit-info');
    const usageCard = document.getElementById('automation-usage-card');
    const usageBar = document.getElementById('automation-usage-bar');
    const percent = limitActive > 0 ? Math.min(100, Math.round((activeCount / limitActive) * 100)) : 0;
    if (limitInfo) limitInfo.textContent = `${activeCount} de ${limitActive} em uso · ${Math.max(0, limitActive - activeCount)} disponível(is)`;
    if (usageBar) usageBar.style.width = `${percent}%`;
    if (usageCard) {
      usageCard.classList.toggle('is-warning', percent >= 70 && percent < 100);
      usageCard.classList.toggle('is-full', percent >= 100);
    }

    renderGoals();

    if (!automations.length) {
      emptyEl.style.display = 'block';
      ownedEl.style.display = 'none';
    } else {
      emptyEl.style.display = 'none';
      ownedEl.style.display = 'block';
      document.getElementById('automations-count').textContent = `${automations.length} criada(s)`;
      listEl.innerHTML = automations.map((a) => {
        const failedRecently = a.last_run_status === 'failed';
        return `
        <div class="automation-card" data-id="${esc(a.id)}">
          <div class="automation-card-head">
            <div style="flex:1; min-width:200px;">
              <div class="automation-card-title">${esc(a.name)}</div>
              <div class="automation-card-summary">${esc(humanSummary(a))}</div>
            </div>
            <span class="badge ${a.enabled ? 'badge-success' : 'badge-gray'}">${a.enabled ? 'Ativa' : 'Pausada'}</span>
            ${failedRecently ? '<span class="badge badge-danger">Falhou recentemente</span>' : ''}
          </div>
          <div class="automation-card-meta">
            <span>Executada ${a.runs_total} vez(es)</span>
            <span>Última execução: ${esc(fmtDateTime(a.last_run_at))}</span>
          </div>
          <div class="automation-card-actions">
            <button class="btn btn-secondary" data-act="toggle">${a.enabled ? 'Pausar' : 'Ativar'}</button>
            <button class="btn btn-secondary" data-act="edit">Editar</button>
            <button class="btn btn-secondary" data-act="duplicate">Duplicar</button>
            <button class="btn btn-secondary" data-act="history">Histórico</button>
            <button class="btn btn-secondary" data-act="delete" style="color:var(--danger-600);">Excluir</button>
          </div>
        </div>`;
      }).join('');
    }
    if (window.lucide) window.lucide.createIcons();
  }

  function goalIssues(automation, creating = !editingId) {
    const issues = [];
    const actions = automation?.actions || [];
    if (actions.some((a) => a.type === 'send_whatsapp_template' && !a.template_nome)) {
      issues.push({ type: 'template', text: 'Escolha um template aprovado do WhatsApp antes de ativar.', link: '/integrations.html', linkText: 'Cadastrar template' });
    }
    if (actions.some((a) => a.type === 'dispatch_existing_webhook') && !options?.webhook_configured) {
      issues.push({ type: 'webhook', text: 'Conecte o webhook que receberá os dados do pagamento.', link: '/integrations.html', linkText: 'Configurar integração' });
    }
    if (creating && limitActive > 0 && activeCount >= limitActive) {
      issues.push({ type: 'limit', text: 'Seu limite de automações ativas foi atingido.', link: '/plans.html', linkText: 'Ver planos' });
    }
    return issues;
  }

  function prepareGoal(preset) {
    const automation = structuredClone(preset.automation);
    automation.actions = (automation.actions || []).map((action) => {
      if (action.type === 'send_whatsapp_template' && !action.template_nome && options.templates?.length) {
        return { ...action, template_nome: options.templates[0].nome };
      }
      return action;
    });
    return automation;
  }

  function renderGoals() {
    const grid = document.getElementById('automation-goals-grid');
    const badge = document.getElementById('automation-profile-badge');
    if (!grid || !options) return;
    const order = GOAL_ORDER[businessType] || GOAL_ORDER.loja;
    const rank = new Map(order.map((id, index) => [id, index]));
    const presets = [...options.presets].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
    badge.innerHTML = `<i data-lucide="sparkles"></i> Para ${esc(BUSINESS_LABEL[businessType])}`;
    grid.innerHTML = presets.map((preset, index) => {
      const meta = GOAL_META[preset.id] || { title: preset.name, benefit: preset.summary, icon: 'zap' };
      const issues = goalIssues(prepareGoal(preset), true);
      const status = issues.length
        ? `<span class="goal-status needs-setup"><i data-lucide="wrench"></i> Requer configuração</span>`
        : '<span class="goal-status is-ready"><i data-lucide="check"></i> Pronto para revisar</span>';
      return `
        <button type="button" class="automation-goal-card" data-preset="${esc(preset.id)}">
          <span class="automation-goal-icon"><i data-lucide="${meta.icon}"></i></span>
          <span class="automation-goal-copy">
            <span class="automation-goal-topline">${index < 2 ? '<span class="goal-recommended">Recomendado</span>' : '<span>Também pode ajudar</span>'}</span>
            <strong>${esc(meta.title)}</strong>
            <span>${esc(meta.benefit)}</span>
            ${status}
          </span>
          <i data-lucide="arrow-right" class="automation-goal-arrow"></i>
        </button>`;
    }).join('');
  }

  document.querySelector('.app-content').addEventListener('click', async (e) => {
    const presetBtn = e.target.closest('[data-preset]');
    if (presetBtn) {
      const preset = options.presets.find((p) => p.id === presetBtn.dataset.preset);
      if (preset) openBuilder(null, prepareGoal(preset), { guided: true, goalId: preset.id });
      return;
    }
    const actBtn = e.target.closest('[data-act]');
    if (!actBtn) return;
    const card = actBtn.closest('.automation-card');
    const automation = automations.find((a) => a.id === card?.dataset.id);
    if (!automation) return;

    if (actBtn.dataset.act === 'toggle') {
      const r = await apiFetch(`/api/automations/${automation.id}/toggle`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { window.Toast?.show(j.error || 'Não foi possível alterar.', 'error'); return; }
      window.Toast?.show(j.enabled ? 'Automação ativada.' : 'Automação pausada.', 'success');
      await load();
    } else if (actBtn.dataset.act === 'edit') {
      openBuilder(automation, structuredClone({
        name: automation.name,
        description: automation.description,
        trigger_type: automation.trigger_type,
        trigger_config: automation.trigger_config,
        conditions: automation.conditions,
        actions: automation.actions,
        cooldown_seconds: automation.cooldown_seconds,
      }));
    } else if (actBtn.dataset.act === 'duplicate') {
      const r = await apiFetch(`/api/automations/${automation.id}/duplicate`, { method: 'POST' });
      if (!r.ok) { window.Toast?.show('Não foi possível duplicar.', 'error'); return; }
      window.Toast?.show('Cópia criada (pausada).', 'success');
      await load();
    } else if (actBtn.dataset.act === 'delete') {
      const ok = await window.ZapUI.confirm({
        title: 'Excluir automação',
        message: `Excluir "${automation.name}"? O histórico de execuções também será removido.`,
        confirmText: 'Excluir',
        cancelText: 'Manter',
        tone: 'danger',
      });
      if (!ok) return;
      const r = await apiFetch(`/api/automations/${automation.id}`, { method: 'DELETE' });
      if (!r.ok) { window.Toast?.show('Não foi possível excluir.', 'error'); return; }
      window.Toast?.show('Automação excluída.', 'success');
      await load();
    } else if (actBtn.dataset.act === 'history') {
      openHistory(automation);
    }
  });

  // ── Construtor ─────────────────────────────────────────────────────────────
  const modal = document.getElementById('builder-modal');
  let editingId = null;
  let draft = null;
  let step = 0;
  let guidedMode = false;
  let editingEnabled = null;

  function defaultDraft() {
    return {
      name: '',
      trigger_type: 'contact_created',
      trigger_config: {},
      conditions: [],
      actions: [{ type: 'create_internal_notification' }],
      cooldown_seconds: 0,
    };
  }

  function openBuilder(existing, prefill, context = {}) {
    editingId = existing?.id || null;
    editingEnabled = existing ? Boolean(existing.enabled) : null;
    draft = prefill || defaultDraft();
    guidedMode = Boolean(context.guided);
    step = 0;
    document.getElementById('builder-title').textContent = editingId ? 'Editar automação' : (guidedMode ? 'Confirme sua automação' : 'Criar do zero');
    document.getElementById('b-name').value = draft.name || '';
    const triggerSel = document.getElementById('b-trigger');
    triggerSel.innerHTML = options.triggers.map((t) =>
      `<option value="${t}" ${draft.trigger_type === t ? 'selected' : ''}>Quando ${esc(TRIGGER_LABEL[t] || t)}</option>`
    ).join('');
    document.getElementById('b-idle-minutes').value = String(draft.trigger_config?.idle_minutes || 120);
    document.getElementById('b-delay-minutes').value = String(draft.trigger_config?.delay_minutes || 0);
    document.getElementById('b-enabled').checked = editingId ? editingEnabled : goalIssues(draft).length === 0;
    document.getElementById('b-dry-run-result').style.display = 'none';
    syncTriggerFields();
    renderConditions();
    renderActions();
    document.getElementById('b-guided-note').style.display = guidedMode ? 'flex' : 'none';
    goToStep(guidedMode ? 3 : 0);
    modal.classList.add('open');
    if (window.lucide) window.lucide.createIcons({ root: modal });
  }

  function closeBuilder() { modal.classList.remove('open'); }
  document.getElementById('builder-close').addEventListener('click', closeBuilder);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeBuilder(); });

  function syncTriggerFields() {
    const isIdle = document.getElementById('b-trigger').value === 'contact_idle';
    document.getElementById('b-idle-group').style.display = isIdle ? 'block' : 'none';
    document.getElementById('b-delay-group').style.display = isIdle ? 'none' : 'block';
  }
  document.getElementById('b-trigger').addEventListener('change', syncTriggerFields);

  function goToStep(n) {
    step = n;
    document.querySelectorAll('#builder-steps .automation-step').forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.toggle('is-active', s === n);
      el.classList.toggle('is-done', s < n);
    });
    document.querySelectorAll('.builder-pane').forEach((el) => {
      el.style.display = Number(el.dataset.pane) === n ? 'block' : 'none';
    });
    document.getElementById('b-back').style.display = n > 0 ? 'inline-flex' : 'none';
    document.getElementById('b-back').textContent = guidedMode && n === 3 ? 'Revisar detalhes' : 'Voltar';
    document.getElementById('b-next').style.display = n < 3 ? 'inline-flex' : 'none';
    document.getElementById('b-save').style.display = n === 3 ? 'inline-flex' : 'none';
    document.getElementById('b-test').style.display = n === 3 && editingId ? 'inline-flex' : 'none';
    if (n === 3) renderReview();
  }
  document.querySelectorAll('#builder-steps .automation-step').forEach((el) => {
    el.addEventListener('click', () => { collectDraft(); goToStep(Number(el.dataset.step)); });
  });
  document.getElementById('b-back').addEventListener('click', () => { collectDraft(); goToStep(step - 1); });
  document.getElementById('b-next').addEventListener('click', () => {
    collectDraft();
    if (step === 0 && (draft.name || '').trim().length < 2) {
      window.Toast?.show('Dê um nome para a automação.', 'error');
      return;
    }
    if (step === 2 && !draft.actions.length) {
      window.Toast?.show('Adicione pelo menos uma ação.', 'error');
      return;
    }
    goToStep(step + 1);
  });

  function collectDraft() {
    draft.name = document.getElementById('b-name').value.trim();
    draft.trigger_type = document.getElementById('b-trigger').value;
    draft.trigger_config = {};
    if (draft.trigger_type === 'contact_idle') {
      draft.trigger_config.idle_minutes = Number(document.getElementById('b-idle-minutes').value);
    } else {
      const delay = Number(document.getElementById('b-delay-minutes').value);
      if (delay > 0) draft.trigger_config.delay_minutes = delay;
    }
    draft.conditions = readConditionRows();
    draft.actions = readActionRows();
  }

  // ── Condições (UI) ─────────────────────────────────────────────────────────
  function conditionValueControl(c) {
    switch (c.type) {
      case 'stage_equals':
        return `<select class="form-select" data-field="value">${options.stages.map((s) => `<option value="${s.id}" ${c.value === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>`;
      case 'stage_in':
        return `<select class="form-select" data-field="values" multiple size="4">${options.stages.map((s) => `<option value="${s.id}" ${(c.values || []).includes(s.id) ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>`;
      case 'buy_intent_equals':
        return `<select class="form-select" data-field="value">${BUY_INTENTS.map(([v, l]) => `<option value="${v}" ${c.value === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
      case 'has_tag':
      case 'does_not_have_tag':
        return `<input class="form-input" data-field="value" list="tags-list" maxlength="40" placeholder="nome da tag" value="${esc(c.value || '')}">`;
      case 'sale_amount_greater_than':
      case 'sale_amount_less_than':
        return `<input class="form-input" data-field="value" type="number" min="0" step="0.01" placeholder="0,00" value="${esc(c.value ?? '')}">`;
      case 'within_business_hours':
      case 'outside_business_hours':
        return `<span class="form-hint" style="margin:0; align-self:center;">sem valor — usa seu horário configurado</span>`;
      default:
        return `<input class="form-input" data-field="value" maxlength="60" value="${esc(c.value || '')}">`;
    }
  }

  function renderConditions() {
    const wrap = document.getElementById('b-conditions');
    wrap.innerHTML = (draft.conditions || []).map((c, i) => `
      <div class="builder-row" data-index="${i}">
        <select class="form-select" data-field="type">
          ${options.conditions.map((t) => `<option value="${t}" ${c.type === t ? 'selected' : ''}>${esc(CONDITION_LABEL[t] || t)}</option>`).join('')}
        </select>
        ${conditionValueControl(c)}
        <button type="button" class="btn btn-icon" data-remove-condition="${i}" title="Remover"><i data-lucide="trash-2"></i></button>
      </div>
    `).join('') + `<datalist id="tags-list">${(options.tags || []).map((t) => `<option value="${esc(t)}">`).join('')}</datalist>`;
    if (window.lucide) window.lucide.createIcons({ root: wrap });
  }

  function readConditionRows() {
    return [...document.querySelectorAll('#b-conditions .builder-row')].map((row) => {
      const type = row.querySelector('[data-field="type"]').value;
      const c = { type };
      const valuesEl = row.querySelector('[data-field="values"]');
      const valueEl = row.querySelector('[data-field="value"]');
      if (valuesEl) c.values = [...valuesEl.selectedOptions].map((o) => o.value);
      else if (valueEl) {
        c.value = /amount/.test(type) ? Number(valueEl.value) : valueEl.value.trim();
      }
      return c;
    });
  }

  document.getElementById('b-add-condition').addEventListener('click', () => {
    draft.conditions = readConditionRows();
    draft.conditions.push({ type: 'stage_equals', value: options.stages[0]?.id });
    renderConditions();
  });
  document.getElementById('b-conditions').addEventListener('change', (e) => {
    if (e.target.dataset.field === 'type') {
      draft.conditions = readConditionRows();
      renderConditions();
    }
  });
  document.getElementById('b-conditions').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-condition]');
    if (!btn) return;
    draft.conditions = readConditionRows();
    draft.conditions.splice(Number(btn.dataset.removeCondition), 1);
    renderConditions();
  });

  // ── Ações (UI) ─────────────────────────────────────────────────────────────
  function actionValueControl(a) {
    switch (a.type) {
      case 'add_tag': case 'remove_tag':
        return `<input class="form-input" data-field="tag" list="tags-list" maxlength="40" placeholder="nome da tag" value="${esc(a.tag || '')}">`;
      case 'change_stage':
        return `<select class="form-select" data-field="stage">${options.stages.map((s) => `<option value="${s.id}" ${a.stage === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>`;
      case 'create_internal_notification':
        return `<input class="form-input" data-field="title" maxlength="120" placeholder="Título do aviso (opcional)" value="${esc(a.title || '')}">`;
      case 'send_push_notification':
        return `<input class="form-input" data-field="title" maxlength="120" placeholder="Título da notificação (opcional)" value="${esc(a.title || '')}">`;
      case 'send_whatsapp_template': {
        if (!options.templates.length) {
          return `<span class="form-hint" style="margin:0; align-self:center;">Nenhum template cadastrado — cadastre em Integrações.</span>`;
        }
        return `<select class="form-select" data-field="template_nome">${options.templates.map((t) => `<option value="${esc(t.nome)}" ${a.template_nome === t.nome ? 'selected' : ''}>${esc(t.nome)} (${esc(t.idioma)})</option>`).join('')}</select>`;
      }
      case 'dispatch_existing_webhook':
        return options.webhook_configured
          ? `<span class="form-hint" style="margin:0; align-self:center;">usa o webhook já configurado</span>`
          : `<span class="form-hint" style="margin:0; align-self:center; color:var(--danger-600);">webhook não configurado em Integrações</span>`;
      default:
        return '';
    }
  }

  function renderActions() {
    const wrap = document.getElementById('b-actions');
    wrap.innerHTML = (draft.actions || []).map((a, i) => `
      <div class="builder-row" data-index="${i}">
        <select class="form-select" data-field="type">
          ${options.actions.map((t) => `<option value="${t}" ${a.type === t ? 'selected' : ''}>${esc(ACTION_LABEL[t] || t)}</option>`).join('')}
        </select>
        ${actionValueControl(a)}
        <button type="button" class="btn btn-icon" data-remove-action="${i}" title="Remover"><i data-lucide="trash-2"></i></button>
      </div>
    `).join('');
    if (window.lucide) window.lucide.createIcons({ root: wrap });
  }

  function readActionRows() {
    return [...document.querySelectorAll('#b-actions .builder-row')].map((row) => {
      const type = row.querySelector('[data-field="type"]').value;
      const a = { type };
      for (const field of ['tag', 'stage', 'title', 'template_nome']) {
        const el = row.querySelector(`[data-field="${field}"]`);
        if (el && el.value.trim()) a[field] = el.value.trim();
      }
      return a;
    });
  }

  document.getElementById('b-add-action').addEventListener('click', () => {
    draft.actions = readActionRows();
    draft.actions.push({ type: 'add_tag' });
    renderActions();
  });
  document.getElementById('b-actions').addEventListener('change', (e) => {
    if (e.target.dataset.field === 'type') {
      draft.actions = readActionRows();
      renderActions();
    }
  });
  document.getElementById('b-actions').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-action]');
    if (!btn) return;
    draft.actions = readActionRows();
    draft.actions.splice(Number(btn.dataset.removeAction), 1);
    renderActions();
  });

  // ── Revisar / salvar / testar ──────────────────────────────────────────────
  function renderReview() {
    document.getElementById('b-review').innerHTML =
      `<strong>${esc(draft.name || 'Sem nome')}</strong><br>${esc(humanSummary(draft))}`;
    const issues = goalIssues(draft);
    const readiness = document.getElementById('b-readiness');
    readiness.innerHTML = issues.length
      ? `<div class="automation-readiness-box needs-attention"><strong><i data-lucide="circle-alert"></i> Antes de ativar</strong>${issues.map((issue) => `<div><span>${esc(issue.text)}</span><a href="${issue.link}">${esc(issue.linkText)} <i data-lucide="external-link"></i></a></div>`).join('')}</div>`
      : '<div class="automation-readiness-box is-ready"><strong><i data-lucide="circle-check"></i> Tudo pronto para funcionar</strong><span>O Zapien começará a observar esse objetivo depois que você salvar.</span></div>';
    const enabled = document.getElementById('b-enabled').checked;
    document.getElementById('b-save').innerHTML = enabled
      ? '<i data-lucide="zap"></i> Ativar automação'
      : '<i data-lucide="pause"></i> Salvar pausada';
    if (window.lucide) window.lucide.createIcons({ root: document.querySelector('[data-pane="3"]') });
  }

  document.getElementById('b-enabled').addEventListener('change', renderReview);

  document.getElementById('b-save').addEventListener('click', async () => {
    collectDraft();
    const issues = goalIssues(draft);
    if (document.getElementById('b-enabled').checked && issues.length) {
      window.Toast?.show('Conclua a configuração indicada ou salve a automação pausada.', 'error');
      renderReview();
      return;
    }
    const body = {
      name: draft.name,
      trigger_type: draft.trigger_type,
      trigger_config: draft.trigger_config,
      conditions: draft.conditions,
      actions: draft.actions,
      cooldown_seconds: draft.cooldown_seconds || 0,
      enabled: document.getElementById('b-enabled').checked,
    };
    const url = editingId ? `/api/automations/${editingId}` : '/api/automations';
    const method = editingId ? 'PUT' : 'POST';
    const r = await apiFetch(url, { method, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      window.Toast?.show(j.error || 'Não foi possível salvar a automação.', 'error');
      return;
    }
    const wantsEnabled = document.getElementById('b-enabled').checked;
    if (editingId && wantsEnabled !== editingEnabled) {
      const toggleRes = await apiFetch(`/api/automations/${editingId}/toggle`, { method: 'POST' });
      if (!toggleRes.ok) {
        const toggleData = await toggleRes.json().catch(() => ({}));
        window.Toast?.show(toggleData.error || 'As alterações foram salvas, mas não foi possível mudar o status.', 'error');
        closeBuilder();
        await load();
        return;
      }
    }
    window.Toast?.show('Automação salva! ⚡', 'success');
    closeBuilder();
    await load();
  });

  document.getElementById('b-test').addEventListener('click', async () => {
    if (!editingId) return;
    const el = document.getElementById('b-dry-run-result');
    el.style.display = 'block';
    el.innerHTML = 'Simulando…';
    const r = await apiFetch(`/api/automations/${editingId}/test`, {
      method: 'POST',
      body: JSON.stringify({ dry_run: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { el.innerHTML = esc(j.error || 'Não foi possível simular.'); return; }
    el.innerHTML = `
      <div><strong>Simulação</strong> ${j.sample_contact ? `(com o contato mais recente: etapa "${esc(stageLabel(j.sample_contact.stage))}", intenção ${esc(j.sample_contact.buy_intent)})` : '(sem contato de exemplo)'} — nada foi enviado.</div>
      <div style="margin-top:6px;"><strong>Condições:</strong> ${j.conditions.length ? j.conditions.map((c) => `<span class="${c.pass ? 'ok' : 'fail'}">${esc(CONDITION_LABEL[c.type] || c.type)} ${c.pass ? '✓' : '✗'}</span>`).join(' · ') : 'nenhuma (vale sempre)'}</div>
      <div style="margin-top:6px;"><strong>Ações:</strong></div>
      ${j.actions.map((a) => `<div>${a.would_run ? '<span class="ok">✓ rodaria</span>' : '<span class="fail">✗ não rodaria</span>'} — ${esc(ACTION_LABEL[a.type] || a.type)}${a.blocked_reason ? ` <em>(${esc(a.blocked_reason)})</em>` : ''}</div>`).join('')}
    `;
  });

  document.getElementById('new-automation-btn').addEventListener('click', () => openBuilder(null, null));

  // ── Histórico ──────────────────────────────────────────────────────────────
  const historyModal = document.getElementById('history-modal');
  let historyAutomation = null;
  let historyPage = 1;

  async function loadHistory() {
    const body = document.getElementById('history-body');
    window.ZapUI.renderAsyncState(body, {
      state: 'loading',
      title: 'Carregando histórico…',
      message: 'Buscando as execuções mais recentes.',
      compact: true,
    });
    try {
      const r = await fetch(`/api/automations/${historyAutomation.id}/runs?page=${historyPage}&limit=10`);
      if (!r.ok) throw new Error();
      const j = await r.json();
      document.getElementById('history-page-info').textContent = `Página ${j.page} · ${j.total} execução(ões)`;
      if (!j.runs.length) {
        window.ZapUI.renderAsyncState(body, {
          state: 'empty',
          title: 'Nenhuma execução ainda',
          message: 'Assim que o gatilho acontecer, o resultado aparecerá aqui.',
          compact: true,
        });
        return;
      }
      body.setAttribute('aria-busy', 'false');
      body.innerHTML = j.runs.map((run) => {
        const [lbl, cls] = RUN_STATUS[run.status] || [run.status, 'badge-gray'];
        return `
        <div class="automation-history-run">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <span class="badge ${cls}">${lbl}</span>
            <span>${esc(fmtDateTime(run.started_at))}</span>
            ${run.error_summary ? `<span style="color:var(--danger-600);">${esc(run.error_summary)}</span>` : ''}
          </div>
          ${run.actions.length ? `<div class="run-actions">${run.actions.map((a) => `${esc(ACTION_LABEL[a.type] || a.type)}: ${esc(a.status)}${a.error ? ` (${esc(a.error)})` : ''}`).join(' · ')}</div>` : ''}
        </div>`;
      }).join('');
    } catch {
      window.ZapUI.renderAsyncState(body, {
        state: 'error',
        title: 'Não foi possível carregar o histórico',
        message: 'Tente novamente sem fechar esta janela.',
        actionLabel: 'Tentar novamente',
        onAction: loadHistory,
        compact: true,
      });
    }
  }

  function openHistory(automation) {
    historyAutomation = automation;
    historyPage = 1;
    document.getElementById('history-title').textContent = `Histórico — ${automation.name}`;
    historyModal.classList.add('open');
    loadHistory();
    if (window.lucide) window.lucide.createIcons({ root: historyModal });
  }
  document.getElementById('history-close').addEventListener('click', () => historyModal.classList.remove('open'));
  historyModal.addEventListener('click', (e) => { if (e.target === historyModal) historyModal.classList.remove('open'); });
  document.getElementById('history-prev').addEventListener('click', () => { if (historyPage > 1) { historyPage--; loadHistory(); } });
  document.getElementById('history-next').addEventListener('click', () => { historyPage++; loadHistory(); });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await apiFetch('/api/logout', { method: 'POST' });
    location.href = '/';
  });

  load();
});
