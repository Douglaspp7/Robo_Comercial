/**
 * Dashboard Logic
 */

// Converte timestamp UTC do banco (sem marcador de fuso) para hora local do navegador.
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

// Tempo relativo curto (ex: "há 2h", "há 3 dias") para "tempo desde a última resposta".
function fmtRelativeTime(str) {
  if (!str) return '';
  let s = str.trim().replace(' ', 'T');
  if (!s.endsWith('Z') && !s.includes('+')) s += 'Z';
  const d = new Date(s);
  if (isNaN(d)) return '';
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'agora mesmo';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `há ${diffD} dia${diffD > 1 ? 's' : ''}`;
}

// "mar/2026" — usado no "Cliente desde" do drawer.
function fmtMesAno(str) {
  if (!str) return '';
  let s = str.trim().replace(' ', 'T');
  if (!s.endsWith('Z') && !s.includes('+')) s += 'Z';
  const d = new Date(s);
  if (isNaN(d)) return str.slice(0, 7);
  const mes = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${mes}/${d.getFullYear()}`;
}

// Formata minutos em "X min" ou "Xh Ymin" para o KPI de tempo médio de resposta.
function fmtTempoResposta(min) {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h}h ${rest}min` : `${h}h`;
}

document.addEventListener('DOMContentLoaded', () => {
  const ui = {
    logoutBtn: document.getElementById('logoutBtn'),
    adminLink: document.getElementById('adminLink'),
    impersonateBar: document.getElementById('impersonateBar'),
    impersonateEmail: document.getElementById('impersonateEmail'),
    stopImpersonateBtn: document.getElementById('stopImpersonateBtn'),
    bannerArea: document.getElementById('bannerArea'),
    operationHealth: document.getElementById('operationHealth'),
    kpisArea: document.getElementById('kpisArea'),
    dailyChart: document.getElementById('dailyChart'),
    lastUpdate: document.getElementById('lastUpdate'),
    searchInput: document.getElementById('searchInput'),
    stageFilter: document.getElementById('stageFilter'),
    tagFilter: document.getElementById('tagFilter'),
    contactsArea: document.getElementById('contactsArea'),
    csvBtn: document.getElementById('csvBtn'),
    archivedBtn: document.getElementById('archivedBtn'),
    archivedModal: document.getElementById('archivedModal'),
    archivedModalClose: document.getElementById('archivedModalClose'),
    archivedListArea: document.getElementById('archivedListArea'),

    // Drawer
    drawer: document.getElementById('drawer'),
    drawerOverlay: document.getElementById('drawerOverlay'),
    drawerCloseBtn: document.getElementById('drawerCloseBtn'),
    drawerName: document.getElementById('drawerName'),
    drawerMeta: document.getElementById('drawerMeta'),
    drawerLtv: document.getElementById('drawerLtv'),
    drawerSummary: document.getElementById('drawerSummary'),
    drawerDetailsToggle: document.getElementById('drawerDetailsToggle'),
    drawerDetails: document.getElementById('drawerDetails'),
    drawerHandoffBtn: document.getElementById('drawerHandoffBtn'),
    nextActionCard: document.getElementById('nextActionCard'),
    nextActionAcao: document.getElementById('nextActionAcao'),
    nextActionMotivo: document.getElementById('nextActionMotivo'),
    nextActionMensagemRow: document.getElementById('nextActionMensagemRow'),
    nextActionMensagem: document.getElementById('nextActionMensagem'),
    nextActionCopyBtn: document.getElementById('nextActionCopyBtn'),
    nextActionUseBtn: document.getElementById('nextActionUseBtn'),
    drawerMoreBtn: document.getElementById('drawerMoreBtn'),
    drawerMoreMenu: document.getElementById('drawerMoreMenu'),
    drawerClearBtn: document.getElementById('drawerClearBtn'),
    drawerArchiveBtn: document.getElementById('drawerArchiveBtn'),
    drawerDeleteBtn: document.getElementById('drawerDeleteBtn'),
    drawerMsgsArea: document.getElementById('drawerMsgsArea'),
    drawerNotesArea: document.getElementById('drawerNotesArea'),
    drawerInput: document.getElementById('drawerInput'),
    drawerSendBtn: document.getElementById('drawerSendBtn'),
    drawerFooter: document.getElementById('drawerFooter'),
    drawerAttachBtn: document.getElementById('drawerAttachBtn'),
    drawerFileInput: document.getElementById('drawerFileInput'),
    drawerFilePreview: document.getElementById('drawerFilePreview'),
    drawerFilePreviewName: document.getElementById('drawerFilePreviewName'),
    drawerFileRemoveBtn: document.getElementById('drawerFileRemoveBtn'),
    noteInput: document.getElementById('noteInput'),
    noteSaveBtn: document.getElementById('noteSaveBtn'),

    // Cadastro (CRM)
    crmTagsArea: document.getElementById('crmTagsArea'),
    crmTagInput: document.getElementById('crmTagInput'),
    crmTagAddBtn: document.getElementById('crmTagAddBtn'),
    crmTipoCliente: document.getElementById('crmTipoCliente'),
    crmLeadSource: document.getElementById('crmLeadSource'),
    crmDocSaved: document.getElementById('crmDocSaved'),
    crmDocMasked: document.getElementById('crmDocMasked'),
    crmDocRevealBtn: document.getElementById('crmDocRevealBtn'),
    crmDocEditBtn: document.getElementById('crmDocEditBtn'),
    crmDocEditRow: document.getElementById('crmDocEditRow'),
    crmDocInput: document.getElementById('crmDocInput'),
    crmCnpjLookupBtn: document.getElementById('crmCnpjLookupBtn'),
    crmPjFields: document.getElementById('crmPjFields'),
    crmRazaoSocial: document.getElementById('crmRazaoSocial'),
    crmNomeFantasia: document.getElementById('crmNomeFantasia'),
    crmEmail: document.getElementById('crmEmail'),
    crmCep: document.getElementById('crmCep'),
    crmEndereco: document.getElementById('crmEndereco'),
    crmCidade: document.getElementById('crmCidade'),
    crmUf: document.getElementById('crmUf'),
    crmResponsavel: document.getElementById('crmResponsavel'),
    crmPrioridade: document.getElementById('crmPrioridade'),
    crmProximaTarefa: document.getElementById('crmProximaTarefa'),
    crmPrazoResposta: document.getElementById('crmPrazoResposta'),
    crmSaveBtn: document.getElementById('crmSaveBtn'),
    crmAssignedUser: document.getElementById('crmAssignedUser'),
    crmAssignedTeam: document.getElementById('crmAssignedTeam'),
    assignFilter: document.getElementById('assignFilter'),
    operationTestModal: document.getElementById('operationTestModal'),
    operationTestClose: document.getElementById('operationTestClose'),
    operationTestDone: document.getElementById('operationTestDone'),
    operationTestSetup: document.getElementById('operationTestSetup'),
    operationTestRunning: document.getElementById('operationTestRunning'),
    operationTestMessage: document.getElementById('operationTestMessage'),
    operationTestStart: document.getElementById('operationTestStart'),
    operationTestAgain: document.getElementById('operationTestAgain'),
    operationTestSteps: document.getElementById('operationTestSteps'),
    operationTestSummary: document.getElementById('operationTestSummary'),
    operationTestProgressBar: document.getElementById('operationTestProgressBar'),
    operationTestAiPreview: document.getElementById('operationTestAiPreview'),
    operationTestAiText: document.getElementById('operationTestAiText'),
    operationTestFinish: document.getElementById('operationTestFinish'),
  };

  let _csrfToken = null;
  let stageMeta = {};
  let contactsCache = [];
  let filteredCache = [];
  let meData = null;
  let drawerPhone = null;
  let pendingFile = null;
  let quickReplies = [];
  let dailyChartObj = null;
  let planFeatures = {};
  let handoffSummary = { waiting: 0, in_progress: 0, oldest_waiting_at: null, items: [] };
  const ORIGINAL_TITLE = document.title;

  const AVATAR_COLORS = [
    { bg: '#e0f2fe', text: '#0369a1' }, // Blue
    { bg: '#fce7f3', text: '#be185d' }, // Pink
    { bg: '#dcfce7', text: '#15803d' }, // Green
    { bg: '#fef3c7', text: '#b45309' }, // Yellow
    { bg: '#f3e8ff', text: '#7e22ce' }, // Purple
    { bg: '#ffedd5', text: '#c2410c' }, // Orange
    { bg: '#e0e7ff', text: '#4338ca' }  // Indigo
  ];

  function getColorForString(str) {
    if (!str) return { bg: '#f1f5f9', text: '#475569' };
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

    function updateGreeting() {
    const el = document.getElementById('time-greeting');
    if (el) el.textContent = 'Hoje';
  }
  updateGreeting();
  setInterval(updateGreeting, 60000);

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

  // ── Insights: central de prioridades + relatório de valor ─────────────────
  async function loadInsights() {
    const r = await fetch('/api/insights');
    if (!r.ok) return;
    const data = await r.json();
    renderPriorityCenter(data.priorities || {});
    renderValueReport(data.value || {});
  }

  function filterToStage(stage) {
    if (ui.stageFilter) ui.stageFilter.value = stage || '';
    if (ui.searchInput) ui.searchInput.value = '';
    applyFilter();
    document.getElementById('contactsArea')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.filterToStage = filterToStage;

  function renderPriorityCenter(p) {
    const area = document.getElementById('priorityCenter');
    if (!area) return;
    const cards = [];
    if (p.aguardando_humano > 0) cards.push({ n: p.aguardando_humano, label: 'Aguardando você assumir', icon: '🙋', color: '#dc2626', action: "filterToStage('')" });
    if (p.leads_quentes > 0) cards.push({ n: p.leads_quentes, label: 'Leads quentes (prontos p/ comprar)', icon: '🔥', color: '#ea580c', action: "filterToStage('negociacao')" });
    if (p.checkouts_pendentes > 0) cards.push({ n: p.checkouts_pendentes, label: 'Checkouts sem pagamento', icon: '💳', color: '#d97706', action: "filterToStage('checkout')" });
    if (p.sem_resposta_24h > 0) cards.push({ n: p.sem_resposta_24h, label: 'Sem resposta há +24h', icon: '⏰', color: '#7c3aed', action: "filterToStage('')" });
    if (!cards.length) { area.innerHTML = '<div class="insights-card calm-state"><div class="insights-title"><i data-lucide="check-circle" style="width:18px;height:18px;color:var(--brand-500);"></i> Tudo tranquilo por enquanto</div><p>A IA está cuidando dos atendimentos dos seus clientes.</p></div>'; if (window.lucide) window.lucide.createIcons({ root: area }); return; }
    area.innerHTML = `
      <div class="insights-card">
        <div class="insights-title"><i data-lucide="target" style="width:18px;height:18px;"></i> Precisa da sua atenção agora</div>
        <div class="priority-grid">
          ${cards.map(c => `
            <button class="priority-tile" style="border-left:4px solid ${c.color};" onclick="${c.action}">
              <span class="priority-tile-num">${c.icon} ${c.n}</span>
              <span class="priority-tile-label">${c.label}</span>
            </button>`).join('')}
        </div>
      </div>`;
    if (window.lucide) window.lucide.createIcons({ root: area });
  }

  function renderValueReport(v) {
    const area = document.getElementById('valueReport');
    if (!area) return;
    if (!v.ia_mensagens && !v.clientes_atendidos) { area.innerHTML = ''; return; }
    const items = [
      { n: v.ia_mensagens || 0, label: 'mensagens respondidas pela IA', icon: 'message-square' },
      { n: v.clientes_atendidos || 0, label: 'clientes atendidos', icon: 'users' },
      { n: v.ia_fora_horario || 0, label: 'atendimentos fora do horário comercial*', icon: 'moon' },
      { n: v.vendas || 0, label: 'vendas registradas no funil', icon: 'check-circle' },
    ];
    area.innerHTML = `
      <div class="insights-card value-report">
        <div class="insights-title"><i data-lucide="sparkles" style="width:18px;height:18px;"></i> O que sua atendente já fez por você</div>
        <div class="value-grid">
          ${items.map(i => `
            <div class="value-item">
              <i data-lucide="${i.icon}"></i>
              <div><div class="value-num">${i.n}</div><div class="value-label">${i.label}</div></div>
            </div>`).join('')}
        </div>
        <div class="value-note">* estimativa baseada no horário das respostas (fora de 8h–18h).</div>
      </div>`;
    if (window.lucide) window.lucide.createIcons({ root: area });
  }

  // Bind events
  if(ui.logoutBtn) ui.logoutBtn.addEventListener('click', logout);
  if(ui.stopImpersonateBtn) ui.stopImpersonateBtn.addEventListener('click', stopImpersonate);
  if(ui.searchInput) ui.searchInput.addEventListener('input', applyFilter);
  if(ui.stageFilter) ui.stageFilter.addEventListener('change', applyFilter);
  if(ui.tagFilter) ui.tagFilter.addEventListener('change', applyFilter);
  if(ui.assignFilter) ui.assignFilter.addEventListener('change', applyFilter);
  const contactFiltersDetails = document.querySelector('.filters-details');
  if (contactFiltersDetails && window.matchMedia?.('(max-width: 768px)').matches) contactFiltersDetails.open = false;

  if(ui.csvBtn) ui.csvBtn.addEventListener('click', exportCSV);
  if(ui.archivedBtn) ui.archivedBtn.addEventListener('click', openArchivedModal);
  if(ui.archivedModalClose) ui.archivedModalClose.addEventListener('click', () => ui.archivedModal.classList.remove('open'));
  if(ui.archivedModal) ui.archivedModal.addEventListener('click', (e) => { if (e.target === ui.archivedModal) ui.archivedModal.classList.remove('open'); });

  // Drawer events (lambdas diferidas para closeChat não ser avaliado antes de window.closeChat ser atribuído)
  if(ui.drawerCloseBtn) ui.drawerCloseBtn.addEventListener('click', () => closeChat());
  if(ui.drawerOverlay) ui.drawerOverlay.addEventListener('click', () => closeChat());
  if(ui.drawerHandoffBtn) ui.drawerHandoffBtn.addEventListener('click', toggleHandoff);
  if(ui.drawerDetailsToggle) ui.drawerDetailsToggle.addEventListener('click', () => {
    const open = ui.drawerDetails?.classList.toggle('is-open');
    ui.drawerDetailsToggle.classList.toggle('is-open', open);
    ui.drawerDetailsToggle.querySelector('span').textContent = open ? 'Ocultar resumo e próxima ação' : 'Ver resumo e próxima ação';
  });
  if(ui.drawerMoreBtn) ui.drawerMoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ui.drawerMoreMenu?.classList.toggle('hidden');
  });
  document.addEventListener('click', () => ui.drawerMoreMenu?.classList.add('hidden'));
  if(ui.drawerMoreMenu) ui.drawerMoreMenu.addEventListener('click', (e) => e.stopPropagation());
  if(ui.drawerClearBtn) ui.drawerClearBtn.addEventListener('click', () => { ui.drawerMoreMenu?.classList.add('hidden'); clearHistory(); });
  if(ui.drawerArchiveBtn) ui.drawerArchiveBtn.addEventListener('click', () => { ui.drawerMoreMenu?.classList.add('hidden'); archiveContact(); });
  if(ui.drawerDeleteBtn) ui.drawerDeleteBtn.addEventListener('click', () => { ui.drawerMoreMenu?.classList.add('hidden'); deleteContact(); });
  if(ui.drawerSendBtn) ui.drawerSendBtn.addEventListener('click', sendReply);
  if(ui.drawerAttachBtn) ui.drawerAttachBtn.addEventListener('click', () => ui.drawerFileInput?.click());
  if(ui.drawerFileInput) ui.drawerFileInput.addEventListener('change', () => {
    const file = ui.drawerFileInput.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      window.Toast?.show('Arquivo muito grande (máx. 20MB).', 'error');
      ui.drawerFileInput.value = '';
      return;
    }
    pendingFile = file;
    if (ui.drawerFilePreviewName) ui.drawerFilePreviewName.textContent = file.name;
    if (ui.drawerFilePreview) ui.drawerFilePreview.style.display = 'flex';
  });
  if(ui.drawerFileRemoveBtn) ui.drawerFileRemoveBtn.addEventListener('click', () => {
    pendingFile = null;
    if (ui.drawerFileInput) ui.drawerFileInput.value = '';
    if (ui.drawerFilePreview) ui.drawerFilePreview.style.display = 'none';
  });
  if(ui.noteSaveBtn) ui.noteSaveBtn.addEventListener('click', addNote);
  
  if(ui.drawerInput) {
    ui.drawerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
    });
    ui.drawerInput.addEventListener('input', () => {
      ui.drawerInput.style.height = 'auto';
      ui.drawerInput.style.height = Math.min(ui.drawerInput.scrollHeight, 120) + 'px';
    });
  }

  if(ui.noteInput) {
    ui.noteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); addNote(); }
    });
  }
  
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeChat(); });

  // Init tabs
  document.querySelectorAll('.drawer-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const targetId = e.currentTarget.dataset.target;
      document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.drawer-pane').forEach(p => p.classList.remove('active'));
      e.currentTarget.classList.add('active');
      document.getElementById(targetId).classList.add('active');
      if (targetId === 'paneNotes' && drawerPhone) loadNotes();
      if (targetId === 'paneSales' && drawerPhone) loadSales();
      if (targetId === 'paneCadastro' && drawerPhone) loadCrm();
    });
  });

  async function load() {
    // Carrega /api/me — se falhar, vai direto ao refreshData com dados zerados
    let me = {};
    try {
      const meRes = await fetch('/api/me');
      if (meRes.ok) me = await meRes.json();
    } catch(err) { console.error('load/me:', err); }

    try {
      const agentRes = await fetch('/api/agent/me');
      if (agentRes.ok) window.agentMe = await agentRes.json();
    } catch(err) { console.error('load/agentMe:', err); }

    meData = me;
    planFeatures = me.planFeatures || {};

    const anyBilling = me.features?.billingEnabled || me.features?.mpBillingEnabled;
    if (anyBilling && !me.is_admin && !me.impersonatedBy && !me.subscription?.canUseBot) {
      location.href = '/plans.html';
      return;
    }

    if (me.is_admin && ui.adminLink) ui.adminLink.classList.remove('hidden');
    if (!me.is_admin) { const s = document.getElementById('supportBtn'); if (s) s.style.display = ''; }
    if (me.impersonatedBy && ui.impersonateBar) {
      ui.impersonateBar.style.display = 'flex';
      if(ui.impersonateEmail) ui.impersonateEmail.textContent = me.email;
    }
    renderBanner(me.subscription, me.features);
    window.ZapUI?.setupProfileDropdown(me, apiFetch);
    window.ZapUI?.setupSupportLink(me.supportPhone);

    if (!planFeatures.csvExport && ui.csvBtn) {
      ui.csvBtn.title = 'Disponível no plano Pro';
      ui.csvBtn.onclick = (e) => { e.preventDefault(); e.stopImmediatePropagation(); window.Toast?.show('Exportação CSV disponível no plano Pro.', 'error'); };
      ui.csvBtn.style.opacity = '0.5';
    }

    if (!planFeatures.notas) {
      const notesTab = document.querySelector('[data-target="paneNotes"]');
      if (notesTab) {
        notesTab.innerHTML = '📋 Notas <span class="badge badge-ai" style="padding: 2px 6px; font-size: 0.65rem; margin-left: 4px;">Pro</span>';
        notesTab.onclick = (e) => { e.preventDefault(); e.stopImmediatePropagation(); window.Toast?.show('Notas internas disponíveis no plano Pro.', 'error'); };
      }
    }

    // Atualizações periódicas usam um agendador sem sobreposição e pausam
    // automaticamente quando a aba fica em segundo plano.
    const handoffRefresh = window.ZapUI?.createRefreshScheduler({
      interval: 12000,
      task: loadHandoffSummary,
    });
    handoffRefresh?.start({ immediate: true });

    // Insights entram no mesmo ciclo dos dados principais para evitar picos de
    // requisições e múltiplas renderizações simultâneas.
    loadInsights().catch(() => {});
    if (planFeatures.liveRefresh) {
      const dashboardRefresh = window.ZapUI?.createRefreshScheduler({
        interval: 30000,
        task: () => Promise.all([refreshData(), loadInsights()]),
      });
      dashboardRefresh?.start();
    }

    // Carrega /api/meta para popular o filtro de etapas — falha não bloqueia o dashboard
    try {
      const metaRes = await fetch('/api/meta');
      if (metaRes.ok) {
        const meta = await metaRes.json();
        if(ui.stageFilter && Array.isArray(meta.stages)) {
          meta.stages.forEach((s) => {
            stageMeta[s.id] = s;
            const opt = document.createElement('option');
            opt.value = s.id; opt.textContent = s.label;
            ui.stageFilter.appendChild(opt);
          });
        }
      }
    } catch(err) { console.error('load/meta:', err); }

    loadTagOptions().catch((err) => console.error('load/tags:', err));

    // PR 2: Carrega atendentes e equipes para atribuição
    try {
      const assignRes = await fetch('/api/agent/list-assignables');
      if (assignRes.ok) {
        const assignData = await assignRes.json();
        if (ui.crmAssignedUser) {
          ui.crmAssignedUser.innerHTML = '<option value="">Ninguém (Sem atendente)</option>' +
            assignData.users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
        }
        if (ui.crmAssignedTeam) {
          ui.crmAssignedTeam.innerHTML = '<option value="">Nenhuma (Sem equipe)</option>' +
            assignData.teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
        }
      }
    } catch (err) {
      console.error('Erro ao carregar lista de atendentes/equipes:', err);
    }

    // refreshData sempre executa — substitui o skeleton mesmo sem dados
    await refreshData();
    await loadOperationHealth();

    if (new URLSearchParams(location.search).get('subscribed') === '1') {
      history.replaceState({}, '', '/dashboard.html');
      window.Toast?.show('Assinatura criada! O acesso será ativado após a confirmação.', 'success');
    }

    // Abre um contato direto por link (ex: vindo do Painel de Vendas, que não
    // tem o drawer de conversa) — ?contact=<telefone>[&assumir=1].
    const params = new URLSearchParams(location.search);
    const contactParam = params.get('contact');
    if (contactParam) {
      const assumir = params.get('assumir') === '1';
      history.replaceState({}, '', '/dashboard.html');
      await openChat(contactParam);
      if (assumir) {
        const c = contactsCache.find((x) => x.phone === contactParam);
        if (c && c.handoff_status !== 'in_progress') await toggleHandoff();
      }
    }

    // Filtra direto por etapa vindo de outro card/página (ex: "Dinheiro parado
    // no funil" no Painel de Vendas) — ?stage=<etapa>.
    const stageParam = params.get('stage');
    if (stageParam) {
      history.replaceState({}, '', '/dashboard.html');
      filterToStage(stageParam);
    }
  }

  async function refreshData() {
    const [statsRes, contactsRes] = await Promise.all([
      fetch('/api/stats').catch(()=>null), fetch('/api/contacts').catch(()=>null),
    ]);

    const emptyStats = { total_contatos: 0, contatos_hoje: 0, intencao_alta: 0,
      aguardando_humano: 0, por_dia: [], tempo_medio_resposta_min: null, total_mensagens: 0 };

    let stats = emptyStats;
    if(statsRes && statsRes.ok) {
      try { stats = await statsRes.json(); } catch { stats = emptyStats; }
    }
    renderKpis(stats);
    if (window.Chart) {
      renderDaily(stats.por_dia || []);
    }

    if(contactsRes && contactsRes.ok) {
      try { contactsCache = await contactsRes.json(); } catch { contactsCache = []; }
      applyFilter();
      updateDrawerInfo();
    } else {
      applyFilter();
    }
    renderPriorityList();
    loadRepurchaseSuggestions().catch(() => {});
    loadDemandSignals().catch(() => {});

    if(ui.lastUpdate) ui.lastUpdate.textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }

  function renderBanner(sub, features) {
    if(!ui.bannerArea) return;
    const anyBilling = features?.billingEnabled || features?.mpBillingEnabled;
    if (!anyBilling || !sub) return;
    
    if (sub.status === 'trial') return; // sem banner durante o período de testes
    if (!sub.canUseBot) {
      if (sub.status === 'trial_expirado') {
        ui.bannerArea.innerHTML =
          '<div class="billing-banner">' +
          '<span>🚫 Período de teste encerrado — o bot parou de responder seus clientes.</span>' +
          '<a href="/plans.html" class="btn">Assinar agora</a></div>';
      } else {
        ui.bannerArea.innerHTML =
          '<div class="billing-banner">' +
          '<span>🚫 Assinatura inativa — o bot parou de responder seus clientes.</span>' +
          '<a href="/plans.html" class="btn">Reativar</a></div>';
      }
    }
  }

  function renderKpis(s) {
    if(!ui.kpisArea) return;

    // KPIs de atendimento/conversa — métricas financeiras (receita, taxa de
    // conversão) ficam no Painel de Vendas, não aqui.
    ui.kpisArea.innerHTML = `
      <div class="stat-card" style="background: linear-gradient(135deg, #2E90FA, #1570DA); color: white; border: none;">
        <div class="stat-card-header" style="color: rgba(255,255,255,0.9);">
          <span>Clientes atendidos</span>
          <i data-lucide="users" style="color: white;"></i>
        </div>
        <div class="stat-card-value" style="color: white;">${s.contatos_hoje}</div>
        <div class="stat-card-footer" style="color: rgba(255,255,255,0.8);">
          <i data-lucide="trending-up"></i>
          <span>Total: ${s.total_contatos}</span>
        </div>
      </div>

      <div class="stat-card" style="background: linear-gradient(135deg, #F79009, #DC6803); color: white; border: none;">
        <div class="stat-card-header" style="color: rgba(255,255,255,0.9);">
          <span>Leads quentes</span>
          <i data-lucide="flame" style="color: white;"></i>
        </div>
        <div class="stat-card-value" style="color: white;">${s.intencao_alta}</div>
        <div class="stat-card-footer" style="color: rgba(255,255,255,0.8);">
          <span>Prontos para comprar</span>
        </div>
      </div>

      <div class="stat-card" style="background: linear-gradient(135deg, #0891b2, #0e7490); color: white; border: none;">
        <div class="stat-card-header" style="color: rgba(255,255,255,0.9);">
          <span>Aguardando você</span>
          <i data-lucide="clock" style="color: white;"></i>
        </div>
        <div class="stat-card-value" style="color: white;">${s.aguardando_humano || 0}</div>
        <div class="stat-card-footer" style="color: rgba(255,255,255,0.8);">
          <span>Últimos 7 dias</span>
        </div>
      </div>

      <div class="stat-card" style="background: linear-gradient(135deg, #db2777, #be185d); color: white; border: none;">
        <div class="stat-card-header" style="color: rgba(255,255,255,0.9);">
          <span>Mensagens da IA</span>
          <i data-lucide="message-circle" style="color: white;"></i>
        </div>
        <div class="stat-card-value" style="color: white;">${s.ia_mensagens || s.total_mensagens || 0}</div>
        <div class="stat-card-footer" style="color: rgba(255,255,255,0.8);">
          <span>Total no atendimento</span>
        </div>
      </div>
    `;
    
    if(window.lucide) window.lucide.createIcons({root: ui.kpisArea});
  }

  // Lista "Precisa da sua atenção" — função própria (não só dentro de
  // renderKpis) pra poder atualizar na hora depois de assumir/devolver uma
  // conversa, sem esperar o próximo ciclo de atualização automática.
  function renderPriorityList() {
    const priorityArea = document.getElementById('priorityArea');
    const priorityList = document.getElementById('priorityList');
    if (!priorityArea || !priorityList) return;
    // Só quem ainda não foi assumido por ninguém — needs_human continua 1
    // mesmo depois de alguém assumir (só volta a 0 quando devolve pra IA),
    // então filtrar por handoff_status é o que realmente diz "ainda
    // aguardando", evitando reexibir quem já está em atendimento humano.
    const waiting = contactsCache.filter(c => c.handoff_status === 'waiting');
    if (!waiting.length) { priorityArea.style.display = 'none'; return; }
    priorityArea.style.display = 'block';
    priorityList.innerHTML = waiting.slice(0,5).map(c => {
      return `<div class="feature-card" style="padding:16px; display:flex; align-items:center; justify-content:space-between; cursor:pointer;" onclick="openChat('${esc(c.phone)}')">
        <div class="flex items-center gap-2">
          <div class="avatar">${(c.name || 'U')[0].toUpperCase()}</div>
          <div>
            <div style="font-weight:600">${esc(c.name) || esc(c.phone)}</div>
            <div style="font-size:0.75rem; color:var(--danger-500)">Aguardando humano</div>
          </div>
        </div>
        <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.75rem;" onclick="event.stopPropagation(); handleHandoffAction('${esc(c.phone)}', 'waiting')">Assumir</button>
      </div>`;
    }).join('');
  }

  // ── Hora de recompra (previsão por ciclo de consumo) ─────────────────────
  async function loadRepurchaseSuggestions() {
    const area = document.getElementById('repurchaseArea');
    const list = document.getElementById('repurchaseList');
    if (!area || !list) return;
    try {
      const res = await fetch('/api/repurchase-suggestions');
      if (!res.ok) return;
      const suggestions = await res.json();
      if (!Array.isArray(suggestions) || !suggestions.length) { area.style.display = 'none'; return; }
      area.style.display = 'block';
      list.innerHTML = suggestions.slice(0, 5).map((s) => `
        <div class="feature-card" style="padding:16px; display:flex; align-items:center; justify-content:space-between; cursor:pointer; gap:12px;" data-open-phone="${esc(s.phone)}">
          <div class="flex items-center gap-2">
            <div class="avatar">${(s.name || 'U')[0].toUpperCase()}</div>
            <div>
              <div style="font-weight:600">${esc(s.name) || esc(s.phone)}</div>
              <div style="font-size:0.75rem; color:var(--text-secondary)">Levou ${esc(s.produto)} há ${s.diasDesde} dias (ciclo: ${s.cicloDias}d)</div>
            </div>
          </div>
          <div class="flex items-center gap-2" style="flex-shrink:0;">
            <button class="btn btn-secondary repurchase-copy-btn" style="padding: 6px 12px; font-size: 0.75rem;" data-mensagem="${esc(s.mensagem)}">Copiar mensagem</button>
            <button class="btn btn-primary repurchase-send-btn" style="padding: 6px 12px; font-size: 0.75rem;" data-phone="${esc(s.phone)}" data-mensagem="${esc(s.mensagem)}">Enviar agora</button>
          </div>
        </div>
      `).join('');
      if (window.lucide) window.lucide.createIcons({ root: list });
    } catch { area.style.display = 'none'; }
  }

  document.getElementById('repurchaseList')?.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.repurchase-copy-btn');
    if (copyBtn) {
      try {
        await navigator.clipboard.writeText(copyBtn.dataset.mensagem || '');
        window.Toast?.show('Mensagem copiada!', 'success');
      } catch {
        window.Toast?.show('Não foi possível copiar automaticamente.', 'error');
      }
      return;
    }

    const sendBtn = e.target.closest('.repurchase-send-btn');
    if (sendBtn) {
      const phone = sendBtn.dataset.phone;
      const mensagem = sendBtn.dataset.mensagem || '';
      if (!phone || !mensagem) return;
      sendBtn.disabled = true;
      try {
        const res = await apiFetch(`/api/contacts/${encodeURIComponent(phone)}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: mensagem }),
        });
        if (!res.ok) throw new Error();
        window.Toast?.show('Mensagem enviada!', 'success');
        sendBtn.closest('.feature-card')?.remove();
      } catch {
        window.Toast?.show('Não foi possível enviar agora. Tente pelo WhatsApp.', 'error');
        sendBtn.disabled = false;
      }
      return;
    }

    const card = e.target.closest('.feature-card[data-open-phone]');
    if (card) openChat(card.dataset.openPhone);
  });

  // ── Tendência agora (sinal de demanda agregada) ──────────────────────────
  async function loadDemandSignals() {
    const area = document.getElementById('demandArea');
    const list = document.getElementById('demandList');
    if (!area || !list) return;
    try {
      const res = await fetch('/api/demand-signals');
      if (!res.ok) return;
      const signals = await res.json();
      if (!Array.isArray(signals) || !signals.length) { area.style.display = 'none'; return; }
      area.style.display = 'block';
      list.innerHTML = signals.slice(0, 5).map((s) => `
        <div class="feature-card" style="padding:16px; display:flex; align-items:center; gap:12px;">
          <i data-lucide="flame" style="color:var(--warning-500); flex-shrink:0;"></i>
          <div style="font-size:0.875rem;">
            <strong>${s.contatos} pessoas</strong> perguntaram sobre <strong>${esc(s.produto)}</strong> nas últimas ${s.janelaHoras}h — hora de aproveitar (story, post ou destaque no catálogo)!
          </div>
        </div>
      `).join('');
      if (window.lucide) window.lucide.createIcons({ root: list });
    } catch { area.style.display = 'none'; }
  }

  function renderDaily(porDia) {
    if(!ui.dailyChart) return;
    if (dailyChartObj) { dailyChartObj.destroy(); }
    
    dailyChartObj = new Chart(ui.dailyChart, {
      type: 'line',
      data: {
        labels: porDia.map((d) => d.dia.slice(5)),
        datasets: [{
          data: porDia.map((d) => d.total),
          borderColor: '#8b5cf6', 
          backgroundColor: 'rgba(139, 92, 246, 0.15)',
          fill: true, tension: .4, pointRadius: 4, pointBackgroundColor: '#8b5cf6'
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          // precision 0: contagem de contatos é inteira — sem ticks 0.2/0.4.
          y: { grid: { color: '#EAECF0' }, beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }

  function applyFilter() {
    const q = (ui.searchInput?.value || '').toLowerCase();
    const stage = ui.stageFilter?.value;
    const tag = ui.tagFilter?.value;
    const assign = ui.assignFilter?.value || 'all';

    filteredCache = contactsCache.filter((c) => {
      const matchQ = !q || (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q);
      const matchS = !stage || c.stage === stage;
      const matchT = !tag || (c.tags || []).includes(tag);
      
      let matchAssign = true;
      if (assign === 'mine') {
        if (window.agentMe) {
          if (window.agentMe.is_owner) {
            matchAssign = !c.assigned_user_id;
          } else {
            matchAssign = c.assigned_user_id === window.agentMe.id;
          }
        }
      } else if (assign === 'team') {
        if (window.agentMe) {
          if (window.agentMe.is_owner) {
            matchAssign = !!c.assigned_team_id;
          } else {
            const myTeams = window.agentMe.teams || [];
            matchAssign = myTeams.includes(c.assigned_team_id);
          }
        }
      } else if (assign === 'unassigned') {
        matchAssign = !c.assigned_user_id;
      }

      return matchQ && matchS && matchT && matchAssign;
    });
    // Sort: waiting first, then in_progress, then by buy_intent/last_message_at
    filteredCache.sort((a, b) => {
      const statusOrder = { waiting: 0, in_progress: 1, none: 2 };
      const aOrd = statusOrder[a.handoff_status || 'none'] ?? 2;
      const bOrd = statusOrder[b.handoff_status || 'none'] ?? 2;
      if (aOrd !== bOrd) return aOrd - bOrd;
      const intentOrder = { alta: 0, media: 1, baixa: 2 };
      const aInt = intentOrder[a.buy_intent] ?? 2;
      const bInt = intentOrder[b.buy_intent] ?? 2;
      if (aInt !== bInt) return aInt - bInt;
      return (b.last_message_at || '').localeCompare(a.last_message_at || '');
    });
    renderContacts(filteredCache);
  }

  async function loadHandoffSummary() {
    try {
      const r = await fetch('/api/handoffs/summary');
      if (r.ok) {
        handoffSummary = await r.json();
        renderHandoffBanner();
        updatePageTitle();
      }
    } catch {}
  }

  function renderHandoffBanner() {
    const area = document.getElementById('handoffBannerArea');
    if (!area) return;
    if (handoffSummary.waiting > 0) {
      const oldestMs = handoffSummary.oldest_waiting_at
        ? Math.floor((Date.now() - new Date(handoffSummary.oldest_waiting_at.endsWith('Z') ? handoffSummary.oldest_waiting_at : handoffSummary.oldest_waiting_at + 'Z').getTime()) / 60000)
        : null;
      const waitText = oldestMs !== null ? ` — aguardando há ${oldestMs} min` : '';
      area.innerHTML = `<div class="handoff-banner">
        <div>
          <div class="handoff-banner-text">🚨 ${handoffSummary.waiting} atendimento${handoffSummary.waiting > 1 ? 's' : ''} aguardando humano${waitText}</div>
          ${handoffSummary.items.length > 0 ? `<div class="handoff-banner-sub">${handoffSummary.items.slice(0,3).map(i => esc(i.name || i.phone)).join(', ')}${handoffSummary.items.length > 3 ? ' e mais...' : ''}</div>` : ''}
        </div>
        <div class="handoff-banner-actions">
          <button class="btn" style="background:#fff;color:#dc2626;font-weight:700;white-space:nowrap;" onclick="openOldestHandoff()">Ver fila</button>
          <button class="btn" style="background:#fff;color:#dc2626;font-weight:700;white-space:nowrap;" onclick="claimOldestHandoff()">Assumir mais antigo</button>
        </div>
      </div>`;
    } else {
      area.innerHTML = '';
    }
  }

  function updatePageTitle() {
    if (handoffSummary.waiting > 0) {
      document.title = `(${handoffSummary.waiting}) Atendimentos pendentes — Zapien`;
    } else {
      document.title = ORIGINAL_TITLE;
    }
  }

  function renderContacts(contacts) {
    if(!ui.contactsArea) return;
    if (!contacts.length) {
      const isFirstUse = contactsCache.length === 0;
      ui.contactsArea.innerHTML = isFirstUse ? `
        <div class="empty-state dashboard-ready-state">
          <div class="empty-state-icon">
            <i data-lucide="message-circle"></i>
          </div>
          <h3 class="empty-state-title">Sua central de conversas está pronta</h3>
          <p class="empty-state-desc">Os próximos atendimentos serão organizados aqui automaticamente, com etapa da venda, intenção e resumo da IA.</p>
          <a href="/settings.html#wa-link-section" class="btn btn-secondary dashboard-ready-cta"><i data-lucide="send"></i> Ver meu link de atendimento</a>
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-state-icon"><i data-lucide="search-x"></i></div>
          <h3 class="empty-state-title">Nenhum contato corresponde aos filtros</h3>
          <p class="empty-state-desc">Limpe a busca ou ajuste os filtros para ver outras conversas.</p>
        </div>
      `;
      if(window.lucide) window.lucide.createIcons({root: ui.contactsArea});
      return;
    }
    
    const rows = contacts.map((c) => {
      const st = stageMeta[c.stage] || { label: c.stage || 'Desconhecido' };
      const intentClass = { alta: 'intent-high', media: 'intent-medium', baixa: 'intent-low' }[c.buy_intent] || 'intent-low';
      const intentText = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }[c.buy_intent] || '—';
      const handoffStatus = c.handoff_status || 'none';
      let humanBadge = '';
      if (handoffStatus === 'waiting') {
        humanBadge = '<span class="handoff-badge-waiting" style="margin-left:8px;">🚨 Aguardando humano</span>';
      } else if (handoffStatus === 'in_progress') {
        humanBadge = '<span class="handoff-badge-in-progress" style="margin-left:8px;">👤 Em atendimento</span>';
      } else if (c.needs_human) {
        humanBadge = '<span class="badge badge-warning" style="margin-left: 8px;">Aguardando humano</span>';
      }

      const btnLabel = (handoffStatus === 'in_progress') ? 'Devolver' : (handoffStatus === 'waiting' ? 'Assumir' : (c.needs_human ? 'Devolver' : 'Assumir'));
      const btnClass = (handoffStatus === 'in_progress' || c.needs_human) ? 'btn-secondary' : 'btn-ghost';
      
      const avatarColor = getColorForString(c.name || c.phone);
      const stageColor = getColorForString(st.label);
      
      return `<tr>
        <td data-label="Nome">
          <div class="contact-name-cell">
            <div class="avatar" style="background-color: ${avatarColor.bg}; color: ${avatarColor.text}; border: 1px solid rgba(0,0,0,0.05);">${(c.name || 'U')[0].toUpperCase()}</div>
            <div class="contact-info">
              <button class="contact-name" onclick="openChat('${esc(c.phone)}')">${esc(c.name) || esc(c.phone)}</button>
              <div class="contact-phone">${esc(c.phone)}</div>
            </div>
          </div>
        </td>
        <td data-label="Etapa"><span class="badge" style="background-color: ${stageColor.bg}; color: ${stageColor.text};">${esc(st.label)}</span>${humanBadge}</td>
        <td data-label="Intenção"><span class="${intentClass}">${intentText}</span></td>
        <td data-label="Resumo" class="hidden md:table-cell"><div class="contact-summary" title="${esc(c.summary || '')}">${esc(c.summary || 'Sem resumo')}</div></td>
        <td data-label="Último contato">${fmtDate(c.last_message_at)}</td>
        <td data-label="Ação">
          <div class="flex items-center gap-2">
            <button class="btn btn-icon" title="Abrir conversa" onclick="openChat('${esc(c.phone)}')"><i data-lucide="message-square"></i></button>
            <button class="btn ${btnClass}" onclick="handleHandoffAction('${esc(c.phone)}', '${handoffStatus}')" style="padding: 6px 12px; font-size: 0.75rem;">${btnLabel}</button>
            <button class="btn btn-icon" title="Arquivar contato" onclick="quickArchiveContact('${esc(c.phone)}')"><i data-lucide="archive"></i></button>
            <div class="contact-more-wrap">
              <button class="btn btn-icon" title="Mais ações" data-more-btn="${esc(c.phone)}" onclick="toggleContactMoreMenu(event, '${esc(c.phone)}')"><i data-lucide="more-horizontal"></i></button>
              <div class="contact-more-menu" data-more-menu="${esc(c.phone)}" hidden>
                <button class="contact-more-item contact-more-item-danger" onclick="confirmDeleteContact('${esc(c.phone)}')">
                  <i data-lucide="trash-2"></i>
                  <span>Excluir contato</span>
                </button>
              </div>
            </div>
          </div>
        </td>
      </tr>`;
    }).join('');
    
    ui.contactsArea.innerHTML = `
      <div class="table-container">
        <table class="table data-table">
          <thead>
            <tr>
              <th>Nome e Contato</th>
              <th>Etapa</th>
              <th>Intenção</th>
              <th class="hidden md:table-cell">Resumo da IA</th>
              <th>Último contato</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    if(window.lucide) window.lucide.createIcons({root: ui.contactsArea});
  }

  function exportCSV() {
    window.open('/api/contacts/export.csv', '_blank');
  }

  // Drawer
  window.openChat = async (phone) => {
    const c = contactsCache.find((x) => x.phone === phone);
    if (!c) return;
    drawerPhone = phone;
    pendingFile = null;
    if (ui.drawerFileInput) ui.drawerFileInput.value = '';
    if (ui.drawerFilePreview) ui.drawerFilePreview.style.display = 'none';
    // Recolhe resumo/próxima ação de novo a cada contato aberto — evita herdar
    // o estado "aberto" do contato anterior.
    if (ui.drawerDetails) ui.drawerDetails.classList.remove('is-open');
    if (ui.drawerDetailsToggle) {
      ui.drawerDetailsToggle.classList.remove('is-open');
      const span = ui.drawerDetailsToggle.querySelector('span');
      if (span) span.textContent = 'Ver resumo e próxima ação';
    }

    ui.drawerName.textContent = c.name || phone;
    const st = stageMeta[c.stage] || { label: c.stage || 'Desconhecido' };
    const intentLabel = { alta: 'Intenção Alta', media: 'Intenção Média', baixa: 'Intenção Baixa' }[c.buy_intent] || '';
    const stageColor = getColorForString(st.label);
    
    ui.drawerMeta.innerHTML = `
      <span class="badge" style="background-color: ${stageColor.bg}; color: ${stageColor.text};">${esc(st.label)}</span>
      ${intentLabel ? `<span class="badge badge-warning">${intentLabel}</span>` : ''}
      <span>${phone}</span>
    `;
    renderDrawerLtv(c);

    const sum = (c.summary || '').trim();
    if (sum) { 
      ui.drawerSummary.textContent = sum; 
      ui.drawerSummary.style.display = 'block'; 
    } else { 
      ui.drawerSummary.style.display = 'none'; 
    }

    try {
      const s = await (await fetch('/api/settings')).json();
      quickReplies = s.business?.respostas_rapidas || [];
    } catch { quickReplies = []; }

    updateHandoffUI(c.needs_human, c.handoff_status || 'none');
    loadNextAction(phone).catch(() => {});

    ui.drawerOverlay.classList.add('open');
    ui.drawer.classList.add('open');

    // Switch to msgs tab
    document.querySelector('[data-target="paneMsg"]').click();
    ui.drawerMsgsArea.innerHTML = '<div style="text-align:center; padding:24px;"><i data-lucide="loader-2" class="spin"></i></div>';
    if(window.lucide) window.lucide.createIcons({root: ui.drawerMsgsArea});
    
    try {
      const msgs = await (await fetch(`/api/contacts/${encodeURIComponent(phone)}/messages`)).json();
      renderMsgs(msgs);
    } catch {
      ui.drawerMsgsArea.innerHTML = '<div style="text-align:center; color:var(--danger-500); padding:24px;">Erro ao carregar mensagens.</div>';
    }
  };

  window.closeChat = () => {
    ui.drawerOverlay.classList.remove('open');
    ui.drawer.classList.remove('open');
    drawerPhone = null;
  };

  // "Cliente desde mar/2026 · 4 compras · R$ 380,00 gastos" — histórico agregado
  // do contato pra reconhecer cliente fiel de bate-pronto ao abrir a conversa.
  function renderDrawerLtv(c) {
    if (!ui.drawerLtv) return;
    const partes = [];
    if (c.cliente_desde) partes.push(`Cliente desde ${fmtMesAno(c.cliente_desde)}`);
    const compras = Number(c.compras_pagas) || 0;
    if (compras > 0) {
      partes.push(`${compras} compra${compras > 1 ? 's' : ''}`);
      partes.push(`${fmtMoney(c.total_gasto_cents)} gastos`);
    }
    if (!partes.length) { ui.drawerLtv.style.display = 'none'; return; }
    const vip = compras >= 2
      ? '<span class="badge" style="background:#fef3c7;color:#92400e;margin-right:6px;">⭐ Cliente fiel</span>'
      : '';
    ui.drawerLtv.innerHTML = vip + esc(partes.join(' · '));
    ui.drawerLtv.style.display = 'block';
  }

  function updateDrawerInfo() {
    if(!drawerPhone) return;
    const c = contactsCache.find((x) => x.phone === drawerPhone);
    if (c) {
      const st = stageMeta[c.stage] || { label: c.stage || 'Desconhecido' };
      const intentLabel = { alta: 'Intenção Alta', media: 'Intenção Média', baixa: 'Intenção Baixa' }[c.buy_intent] || '';
      const stageColor = getColorForString(st.label);
      if(ui.drawerMeta) {
        ui.drawerMeta.innerHTML = `
          <span class="badge" style="background-color: ${stageColor.bg}; color: ${stageColor.text};">${esc(st.label)}</span>
          ${intentLabel ? `<span class="badge badge-warning">${intentLabel}</span>` : ''}
          <span>${esc(drawerPhone)}</span>
        `;
      }
      renderDrawerLtv(c);
      if(ui.drawerSummary) {
        const sum = (c.summary || '').trim();
        if (sum) { ui.drawerSummary.textContent = sum; ui.drawerSummary.style.display = 'block'; }
        else ui.drawerSummary.style.display = 'none';
      }
    }
  }

  function renderMsgs(msgs) {
    if (!msgs.length) {
      ui.drawerMsgsArea.innerHTML = `
        <div class="empty-state" style="padding: 32px 16px; margin: 24px; background: transparent; border: none;">
          <div class="empty-state-icon" style="background: transparent;">
            <i data-lucide="message-square" style="color: var(--gray-300);"></i>
          </div>
          <h3 class="empty-state-title" style="font-size: 1rem;">Nenhuma mensagem</h3>
          <p class="empty-state-desc">As mensagens da conversa aparecerão aqui.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ root: ui.drawerMsgsArea });
      return;
    }
    ui.drawerMsgsArea.innerHTML = msgs.map((m) => {
      const time = fmtDate(m.created_at);
      const label = m.role === 'user' ? 'Cliente' : 'IA';
      const caption = (m.content || '').replace(/^\[[^\]]+\]\s*/, '');
      const text = caption.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      const cssClass = m.role === 'user' ? 'user' : (m.role === 'assistant' ? 'assistant' : 'system');

      if(cssClass === 'system') {
        return `<div class="chat-bubble-wrapper system"><div class="chat-bubble">${text}</div></div>`;
      }

      const mediaHtml = m.media_id ? renderMediaBlock(m.media_id, m.media_mime, m.media_filename) : '';
      const textHtml = text ? `<div class="chat-bubble">${text}</div>` : '';

      return `<div class="chat-bubble-wrapper ${cssClass}">
        <div class="chat-bubble-sender">${label}</div>
        ${mediaHtml}${textHtml}
        <div class="chat-bubble-time">${time}</div>
      </div>`;
    }).join('');

    // Scroll to bottom
    const pane = ui.drawerMsgsArea.parentElement;
    pane.scrollTop = pane.scrollHeight;
    if(window.lucide) window.lucide.createIcons({root: ui.drawerMsgsArea});
  }

  async function loadSales() {
    if (!drawerPhone) return;
    const uiSalesArea = document.getElementById('drawerSalesArea');
    if (!uiSalesArea) return;
    uiSalesArea.innerHTML = '<div style="text-align:center; padding:24px;"><i data-lucide="loader-2" class="spin"></i></div>';
    if(window.lucide) window.lucide.createIcons({root: uiSalesArea});
    try {
      const r = await fetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/sales`);
      if (r.ok) {
        const sales = await r.json();
        renderDrawerSales(sales);
      } else {
        uiSalesArea.innerHTML = '<div style="text-align:center; color:var(--danger-500); padding:24px;">Erro ao carregar histórico.</div>';
      }
    } catch {
      uiSalesArea.innerHTML = '<div style="text-align:center; color:var(--danger-500); padding:24px;">Erro ao carregar histórico.</div>';
    }
  }

  function renderDrawerSales(sales) {
    const uiSalesArea = document.getElementById('drawerSalesArea');
    if (!sales.length) {
      uiSalesArea.innerHTML = `
        <div class="empty-state" style="padding: 32px 16px;">
          <div class="empty-state-icon">
            <i data-lucide="shopping-bag"></i>
          </div>
          <h3 class="empty-state-title">Nenhuma venda</h3>
          <p class="empty-state-desc">Este contato ainda não possui vendas registradas.</p>
        </div>
      `;
      if(window.lucide) window.lucide.createIcons({root: uiSalesArea});
      return;
    }
    
    // Resumo agregado no topo: total já gasto (vendas pagas) + nº de compras.
    const pagas = sales.filter((s) => s.status === 'pago' || s.status === 'paid');
    const totalPago = pagas.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
    const resumoHtml = pagas.length ? `
      <div class="feature-card" style="padding:14px 16px; margin-bottom:12px; display:flex; align-items:center; gap:12px; background:var(--success-50, #f0fdf4); border-color:var(--success-200, #bbf7d0);">
        <i data-lucide="trophy" style="width:20px;height:20px;color:var(--success-600, #16a34a);flex-shrink:0;"></i>
        <div style="min-width:0;">
          <div style="font-weight:700;">R$ ${totalPago.toFixed(2).replace('.', ',')} gastos</div>
          <div style="font-size:0.78rem; color:var(--text-secondary);">${pagas.length} compra${pagas.length > 1 ? 's' : ''} concluída${pagas.length > 1 ? 's' : ''} com você</div>
        </div>
      </div>
    ` : '';

    uiSalesArea.innerHTML = resumoHtml + sales.map(s => {
      const date = fmtDate(s.created_at);
      const statusColors = {
        pending: 'var(--warning-500)', aguardando_pagamento: 'var(--warning-500)', checkout_enviado: 'var(--warning-500)',
        rascunho: 'var(--gray-500)', paid: 'var(--success-500)', pago: 'var(--success-500)',
        rejected: 'var(--danger-500)', perdido: 'var(--danger-500)', cancelled: 'var(--gray-500)',
      };
      const statusLabels = {
        pending: 'Pendente', aguardando_pagamento: 'Aguardando pagamento', checkout_enviado: 'Checkout enviado',
        rascunho: 'Rascunho', paid: 'Pago', pago: 'Pago',
        rejected: 'Recusado', perdido: 'Perdido', cancelled: 'Cancelado',
      };
      const color = statusColors[s.status] || statusColors.pending;
      const label = statusLabels[s.status] || s.status;

      const itemsHtml = (s.items || []).map(i =>
        `<div style="font-size:0.875rem; color:var(--gray-700); margin-top:4px;">- ${i.quantity}x ${esc(i.title)} (R$ ${Number(i.unit_price).toFixed(2).replace('.',',')})</div>`
      ).join('');

      return `
        <div class="feature-card" style="padding:16px; margin-bottom:12px;">
          <div class="flex items-center justify-between mb-2">
            <span style="font-size:0.75rem; color:var(--text-secondary);">${date}</span>
            <span class="badge" style="background:${color}; color:#fff;">${label}</span>
          </div>
          <div style="font-weight:700; font-size:1.125rem; margin-bottom:8px;">R$ ${(Number(s.amount) || 0).toFixed(2).replace('.',',')}</div>
          <div>${itemsHtml}</div>
        </div>
      `;
    }).join('');
    
    if(window.lucide) window.lucide.createIcons({root: uiSalesArea});
  }

  function renderMediaBlock(mediaId, mime, filename) {
    const url = `/api/media/${mediaId}`;
    if ((mime || '').startsWith('image/')) {
      return `<a class="chat-bubble-media" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Imagem"></a>`;
    }
    if ((mime || '').startsWith('video/')) {
      return `<div class="chat-bubble-media"><video src="${url}" controls></video></div>`;
    }
    const name = esc(filename || 'arquivo');
    return `<a class="chat-bubble-media-doc" href="${url}" target="_blank" rel="noopener"><i data-lucide="file-text"></i><span>${name}</span></a>`;
  }

  window.toggleHandoffPhone = async (phone, needsHuman) => {
    await apiFetch(`/api/contacts/${encodeURIComponent(phone)}/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ needs_human: needsHuman }),
    });
    const c = contactsCache.find((x) => x.phone === phone);
    if (c) {
      c.needs_human = needsHuman;
      c.handoff_status = needsHuman ? 'waiting' : 'none';
    }
    applyFilter();
    if(phone === drawerPhone) updateHandoffUI(needsHuman);
  };

  // New handoff action handler using v2 endpoints
  window.handleHandoffAction = async (phone, currentStatus) => {
    const c = contactsCache.find((x) => x.phone === phone);
    if (!c) return;

    if (currentStatus === 'in_progress') {
      // Release (return to AI)
      const r = await apiFetch(`/api/contacts/${encodeURIComponent(phone)}/handoff/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (r.ok) {
        c.handoff_status = 'none';
        c.needs_human = false;
        applyFilter();
        if(phone === drawerPhone) updateHandoffUI(false, 'none');
        // Atualiza banner de handoff, central de prioridades e a lista
        // "Precisa da sua atenção" na hora — sem isso, o alerta "Aguardando
        // humano" ficava exibido até o próximo ciclo automático (até 30s).
        renderPriorityList();
        loadHandoffSummary().catch(() => {});
        loadInsights().catch(() => {});
      }
    } else {
      // Claim the handoff (start attending - works for both 'none' and 'waiting')
      const r = await apiFetch(`/api/contacts/${encodeURIComponent(phone)}/handoff/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (r.ok) {
        c.handoff_status = 'in_progress';
        c.needs_human = true;
        applyFilter();
        if(phone === drawerPhone) updateHandoffUI(true, 'in_progress');
        renderPriorityList();
        loadHandoffSummary().catch(() => {});
        loadInsights().catch(() => {});
      }
    }
  };

  // Arquivar direto da lista de Contatos, sem precisar abrir a conversa.
  window.quickArchiveContact = async (phone) => {
    const c = contactsCache.find((x) => x.phone === phone);
    const name = c?.name || phone;
    const confirmed = await window.ZapUI.confirm({
      title: 'Arquivar conversa',
      message: `Arquivar "${name}"? A conversa sairá da lista, mas nada será apagado e você poderá desarquivá-la depois.`,
      confirmText: 'Arquivar',
      cancelText: 'Manter na lista',
    });
    if (!confirmed) return;
    try {
      const res = await apiFetch(`/api/contacts/${encodeURIComponent(phone)}/archive`, { method: 'POST' });
      if (!res.ok) throw new Error();
      window.Toast?.show('Contato arquivado.', 'success');
      contactsCache = contactsCache.filter((x) => x.phone !== phone);
      applyFilter();
      renderPriorityList();
      if (phone === drawerPhone) closeChat();
    } catch {
      window.Toast?.show('Erro ao arquivar contato.', 'error');
    }
  };

  // Menu "..." nas linhas da lista de contatos. Abre um único menu por vez
  // (fecha os outros); clique fora fecha; Esc fecha.
  window.toggleContactMoreMenu = (event, phone) => {
    event.stopPropagation();
    const menu = document.querySelector(`[data-more-menu="${phone}"]`);
    if (!menu) return;
    document.querySelectorAll('.contact-more-menu').forEach((m) => { if (m !== menu) m.hidden = true; });
    menu.hidden = !menu.hidden;
    if (!menu.hidden && window.lucide) window.lucide.createIcons({ root: menu });
  };
  document.addEventListener('click', () => {
    document.querySelectorAll('.contact-more-menu').forEach((m) => { m.hidden = true; });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.contact-more-menu').forEach((m) => { m.hidden = true; });
  });

  // Excluir da lista de Contatos — exclusão real (cascata em contatos,
  // mensagens, notas, tags, vendas). Confirmação forte: exige digitar o
  // nome do contato (ou "EXCLUIR" quando o contato não tem nome cadastrado).
  window.confirmDeleteContact = (phone) => {
    document.querySelectorAll('.contact-more-menu').forEach((m) => { m.hidden = true; });
    const c = contactsCache.find((x) => x.phone === phone);
    const label = (c?.name || '').trim();
    const expected = label || 'EXCLUIR';
    const escLabel = label ? `"${label}"` : `este contato (${phone})`;

    // Modal reaproveitando o overlay padrão do painel (.modal-overlay).
    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:440px;">
        <div class="modal-header">
          <h3>Excluir ${escLabel}?</h3>
          <button class="btn btn-icon" data-close><i data-lucide="x"></i></button>
        </div>
        <div style="padding:16px 24px 8px;">
          <p style="color:var(--text-secondary); margin-bottom:12px;">Essa ação <strong>não pode ser desfeita</strong>. Apaga conversa, notas, tags e vendas associadas.</p>
          <label class="form-label" for="delConfirmInput">Para confirmar, digite <code>${expected}</code>:</label>
          <input id="delConfirmInput" class="form-input" autocomplete="off" placeholder="${expected}">
          <div class="form-hint" style="color:#b91c1c; display:none; margin-top:6px;" data-hint>O texto não confere. Digite exatamente <code>${expected}</code> para excluir.</div>
        </div>
        <div style="padding:12px 24px 20px; display:flex; justify-content:flex-end; gap:8px;">
          <button class="btn" data-close>Cancelar</button>
          <button class="btn btn-danger" data-confirm disabled>Excluir definitivamente</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    if (window.lucide) window.lucide.createIcons({ root: modal });
    const input = modal.querySelector('#delConfirmInput');
    const hint = modal.querySelector('[data-hint]');
    const btn = modal.querySelector('[data-confirm]');
    const close = () => modal.remove();
    modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });
    input.addEventListener('input', () => {
      const ok = input.value.trim() === expected;
      btn.disabled = !ok;
      hint.style.display = 'none';
    });
    input.focus();
    btn.addEventListener('click', async () => {
      if (input.value.trim() !== expected) { hint.style.display = 'block'; return; }
      btn.disabled = true;
      btn.textContent = 'Excluindo...';
      try {
        const res = await apiFetch(`/api/contacts/${encodeURIComponent(phone)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        window.Toast?.show('Contato excluído.', 'success');
        contactsCache = contactsCache.filter((x) => x.phone !== phone);
        applyFilter();
        renderPriorityList();
        if (phone === drawerPhone) closeChat();
        close();
      } catch {
        window.Toast?.show('Erro ao excluir contato.', 'error');
        btn.disabled = false;
        btn.textContent = 'Excluir definitivamente';
      }
    });
  };

  // Compat: código legado que ainda chamar quickDeleteContact cai no fluxo novo.
  window.quickDeleteContact = (phone) => window.confirmDeleteContact(phone);

  window.openOldestHandoff = () => {
    const first = handoffSummary.items?.[0];
    if (first?.phone) {
      ui.searchInput.value = '';
      ui.stageFilter.value = '';
      applyFilter();
      openChat(first.phone);
      return;
    }
    ui.searchInput.value = '';
    ui.stageFilter.value = '';
    applyFilter();
  };

  window.claimOldestHandoff = async () => {
    const first = handoffSummary.items?.[0];
    if (!first?.phone) return;
    await handleHandoffAction(first.phone, 'waiting');
    openChat(first.phone);
  };

  // Make applyFilter accessible globally for handoff banner button
  window.applyFilter = applyFilter;

  async function toggleHandoff() {
    if (!drawerPhone) return;
    const c = contactsCache.find((x) => x.phone === drawerPhone);
    if (!c) return;
    await handleHandoffAction(drawerPhone, c.handoff_status || 'none');
  }

  function updateHandoffUI(needsHuman, handoffStatus) {
    const status = handoffStatus || (needsHuman ? 'waiting' : 'none');
    if(status === 'in_progress') {
      ui.drawerHandoffBtn.textContent = 'Devolver à IA';
      ui.drawerHandoffBtn.className = 'btn btn-secondary';
      ui.drawerFooter.style.display = 'block';
      buildQuickReplies();
    } else if(status === 'waiting') {
      ui.drawerHandoffBtn.textContent = 'Assumir conversa';
      ui.drawerHandoffBtn.className = 'btn btn-primary';
      ui.drawerFooter.style.display = 'block';
      buildQuickReplies();
    } else {
      ui.drawerHandoffBtn.textContent = 'Assumir conversa';
      ui.drawerHandoffBtn.className = 'btn btn-primary';
      ui.drawerFooter.style.display = 'none';
    }
  }

  function buildQuickReplies() {
    const qrContainer = document.getElementById('quickReplies');
    if(!qrContainer) return;
    if(quickReplies.length > 0) {
      qrContainer.innerHTML = quickReplies.map(r => {
        const text = esc(r);
        const label = r.length > 30 ? esc(r.slice(0,28)) + '…' : text;
        return `<button class="quick-reply-btn" onclick="useQuickReply(this)" data-text="${text.replace(/"/g,'&quot;')}">${label}</button>`;
      }).join('');
      qrContainer.style.display = 'flex';
    } else {
      qrContainer.style.display = 'none';
    }
  }

  window.useQuickReply = (btn) => {
    if(!ui.drawerInput) return;
    ui.drawerInput.value = btn.dataset.text;
    ui.drawerInput.focus();
    ui.drawerInput.dispatchEvent(new Event('input'));
  };

  async function sendReply() {
    if (!ui.drawerInput || !drawerPhone) return;
    const text = ui.drawerInput.value.trim();
    if (pendingFile) return sendMediaReply(text);
    if (!text) return;

    ui.drawerSendBtn.disabled = true;
    ui.drawerInput.disabled = true;

    try {
      const res = await apiFetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || res.status);
      }

      const now = fmtDate(new Date().toISOString());
      const safe = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');

      ui.drawerMsgsArea.insertAdjacentHTML('beforeend',
        `<div class="chat-bubble-wrapper assistant">
          <div class="chat-bubble-sender">Você</div>
          <div class="chat-bubble">${safe}</div>
          <div class="chat-bubble-time">${now}</div>
        </div>`
      );

      const pane = ui.drawerMsgsArea.parentElement;
      pane.scrollTop = pane.scrollHeight;

      ui.drawerInput.value = '';
      ui.drawerInput.style.height = '44px';
    } catch (err) {
      const msgs = { whatsapp_not_configured: 'WhatsApp não configurado nesta conta.' };
      window.Toast?.show('Erro ao enviar: ' + (msgs[err.message] || 'verifique a conexão.'), 'error');
    } finally {
      ui.drawerSendBtn.disabled = false;
      ui.drawerInput.disabled = false;
      ui.drawerInput.focus();
    }
  }

  async function sendMediaReply(caption) {
    const file = pendingFile;
    if (!file || !drawerPhone) return;

    ui.drawerSendBtn.disabled = true;
    ui.drawerInput.disabled = true;
    if (ui.drawerAttachBtn) ui.drawerAttachBtn.disabled = true;

    try {
      const token = await getCsrfToken();
      const fd = new FormData();
      fd.append('file', file);
      if (caption) fd.append('caption', caption);

      const res = await fetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/send-media`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': token },
        body: fd,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || res.status);
      }
      const { mediaId } = await res.json();

      const now = fmtDate(new Date().toISOString());
      const safeCaption = caption.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      const mediaHtml = renderMediaBlock(mediaId, file.type, file.name);

      ui.drawerMsgsArea.insertAdjacentHTML('beforeend',
        `<div class="chat-bubble-wrapper assistant">
          <div class="chat-bubble-sender">Você</div>
          ${mediaHtml}${safeCaption ? `<div class="chat-bubble">${safeCaption}</div>` : ''}
          <div class="chat-bubble-time">${now}</div>
        </div>`
      );
      if(window.lucide) window.lucide.createIcons({root: ui.drawerMsgsArea});

      const pane = ui.drawerMsgsArea.parentElement;
      pane.scrollTop = pane.scrollHeight;

      ui.drawerInput.value = '';
      ui.drawerInput.style.height = '44px';
      pendingFile = null;
      if (ui.drawerFileInput) ui.drawerFileInput.value = '';
      if (ui.drawerFilePreview) ui.drawerFilePreview.style.display = 'none';
    } catch (err) {
      const msgs = { whatsapp_not_configured: 'WhatsApp não configurado nesta conta.' };
      window.Toast?.show('Erro ao enviar arquivo: ' + (msgs[err.message] || 'verifique a conexão.'), 'error');
    } finally {
      ui.drawerSendBtn.disabled = false;
      ui.drawerInput.disabled = false;
      if (ui.drawerAttachBtn) ui.drawerAttachBtn.disabled = false;
      ui.drawerInput.focus();
    }
  }

  async function clearHistory() {
    if (!drawerPhone) return;
    const confirmed = await window.ZapUI.confirm({
      title: 'Apagar histórico da conversa',
      message: 'A IA recomeçará do zero na próxima mensagem. Esta ação não pode ser desfeita.',
      confirmText: 'Apagar histórico',
      cancelText: 'Manter histórico',
      tone: 'danger',
    });
    if (!confirmed) return;
    
    ui.drawerClearBtn.disabled = true;
    try {
      await apiFetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/history`, { method: 'DELETE' });
      ui.drawerMsgsArea.innerHTML = '<div class="chat-bubble-wrapper system"><div class="chat-bubble">Histórico apagado. A IA vai recomeçar do zero.</div></div>';
    } catch(err) {
      window.Toast?.show('Erro ao apagar histórico', 'error');
    }
    ui.drawerClearBtn.disabled = false;
  }

  // Arquiva o contato — some da lista principal (Contatos, Painel de Vendas)
  // sem apagar nada; pode ser desarquivado a qualquer momento em "Arquivados".
  async function archiveContact() {
    if (!drawerPhone) return;
    const confirmed = await window.ZapUI.confirm({
      title: 'Arquivar conversa',
      message: 'A conversa sairá da lista de contatos, mas nada será apagado e você poderá desarquivá-la depois.',
      confirmText: 'Arquivar',
      cancelText: 'Manter na lista',
    });
    if (!confirmed) return;
    try {
      const res = await apiFetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/archive`, { method: 'POST' });
      if (!res.ok) throw new Error();
      window.Toast?.show('Contato arquivado.', 'success');
      contactsCache = contactsCache.filter((c) => c.phone !== drawerPhone);
      applyFilter();
      renderPriorityList();
      closeChat();
    } catch {
      window.Toast?.show('Erro ao arquivar contato.', 'error');
    }
  }

  // Exclui o contato de vez — apaga mensagens, notas, tags e cálculos de
  // frete junto (vendas ficam preservadas para o histórico financeiro).
  // Ação irreversível, por isso pede o nome do contato como confirmação.
  async function deleteContact() {
    if (!drawerPhone) return;
    const c = contactsCache.find((x) => x.phone === drawerPhone);
    const name = c?.name || drawerPhone;
    const confirmed = await window.ZapUI.confirm({
      title: 'Excluir contato definitivamente',
      message: `Excluir "${name}"? A conversa, as notas e as tags serão apagadas. Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir contato',
      cancelText: 'Manter contato',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const res = await apiFetch(`/api/contacts/${encodeURIComponent(drawerPhone)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      window.Toast?.show('Contato excluído.', 'success');
      contactsCache = contactsCache.filter((x) => x.phone !== drawerPhone);
      applyFilter();
      renderPriorityList();
      closeChat();
    } catch {
      window.Toast?.show('Erro ao excluir contato.', 'error');
    }
  }

  async function openArchivedModal() {
    if (!ui.archivedModal) return;
    ui.archivedModal.classList.add('open');
    ui.archivedListArea.innerHTML = '<div style="text-align:center;padding:24px;"><i data-lucide="loader-2" class="spin"></i></div>';
    if (window.lucide) window.lucide.createIcons({ root: ui.archivedListArea });
    try {
      const res = await fetch('/api/contacts/archived');
      const rows = res.ok ? await res.json() : [];
      if (!rows.length) {
        ui.archivedListArea.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:16px;">Nenhum contato arquivado.</div>';
        return;
      }
      ui.archivedListArea.innerHTML = rows.map((c) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0;border-bottom:1px solid var(--border);">
          <div>
            <div style="font-weight:600;font-size:0.875rem;">${esc(c.name) || esc(c.phone)}</div>
            <div style="font-size:0.75rem;color:var(--text-secondary);">${esc(c.phone)}</div>
          </div>
          <button type="button" class="btn btn-secondary" style="font-size:0.75rem;padding:6px 10px;" data-unarchive="${esc(c.phone)}">Desarquivar</button>
        </div>
      `).join('');
    } catch {
      ui.archivedListArea.innerHTML = '<div style="text-align:center;color:var(--danger-500);padding:16px;">Erro ao carregar arquivados.</div>';
    }
  }

  if (ui.archivedListArea) {
    ui.archivedListArea.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-unarchive]');
      if (!btn) return;
      const phone = btn.dataset.unarchive;
      btn.disabled = true;
      try {
        const res = await apiFetch(`/api/contacts/${encodeURIComponent(phone)}/unarchive`, { method: 'POST' });
        if (!res.ok) throw new Error();
        window.Toast?.show('Contato desarquivado.', 'success');
        refreshData().catch(() => {});
        openArchivedModal();
      } catch {
        window.Toast?.show('Erro ao desarquivar contato.', 'error');
        btn.disabled = false;
      }
    });
  }

  // Notes
  async function loadNotes() {
    if (!drawerPhone) return;
    ui.drawerNotesArea.innerHTML = '<div style="text-align:center; padding:24px;"><i data-lucide="loader-2" class="spin"></i></div>';
    if(window.lucide) window.lucide.createIcons({root: ui.drawerNotesArea});
    
    try {
      const notes = await (await fetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/notes`)).json();
      renderNotes(notes);
    } catch {
      ui.drawerNotesArea.innerHTML = '<div style="text-align:center; color:var(--danger-500); padding:24px;">Erro ao carregar notas.</div>';
    }
  }

  function renderNotes(notes) {
    if (!notes.length) {
      ui.drawerNotesArea.innerHTML = '<div style="text-align:center; color:var(--text-secondary); padding:24px;">Sem notas internas registradas.</div>';
      return;
    }
    ui.drawerNotesArea.innerHTML = notes.map((n) => {
      const safe = (n.content || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const time = fmtDate(n.created_at);
      return `
        <div class="note-item">
          <div class="note-content">${safe}</div>
          <div class="note-meta">
            <span>${time}</span>
            <button class="btn btn-icon note-delete" onclick="deleteNote(${n.id})" title="Apagar nota">
              <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
    if(window.lucide) window.lucide.createIcons({root: ui.drawerNotesArea});
  }

  async function addNote() {
    if (!drawerPhone) return;
    const content = (ui.noteInput.value || '').trim();
    if (!content) return;
    
    ui.noteSaveBtn.disabled = true;
    try {
      const res = await apiFetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        ui.noteInput.value = '';
        await loadNotes();
      }
    } catch(err) {
      window.Toast?.show('Erro ao salvar nota.', 'error');
    }
    ui.noteSaveBtn.disabled = false;
  }
  
  window.deleteNote = async (id) => {
    if (!drawerPhone) return;
    const confirmed = await window.ZapUI.confirm({
      title: 'Apagar nota',
      message: 'Esta nota será apagada permanentemente.',
      confirmText: 'Apagar nota',
      cancelText: 'Manter nota',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await apiFetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/notes/${id}`, { method: 'DELETE' });
      await loadNotes();
    } catch(err) {
      window.Toast?.show('Erro ao deletar nota.', 'error');
    }
  };

  // ── Cadastro (CRM leve: CPF/CNPJ, endereço, origem, responsável) ─────────
  function maskDocAsYouType(raw) {
    const digits = raw.replace(/\D/g, '').slice(0, 14);
    if (digits.length <= 11) {
      return digits
        .replace(/^(\d{3})(\d)/, '$1.$2')
        .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
    }
    return digits
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
      .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
  }

  if (ui.crmDocInput) {
    ui.crmDocInput.addEventListener('input', () => {
      ui.crmDocInput.value = maskDocAsYouType(ui.crmDocInput.value);
      const digits = ui.crmDocInput.value.replace(/\D/g, '');
      if (ui.crmCnpjLookupBtn) ui.crmCnpjLookupBtn.style.display = digits.length === 14 ? '' : 'none';
    });
  }

  function showPjFields(show) {
    if (ui.crmPjFields) ui.crmPjFields.style.display = show ? '' : 'none';
  }

  // ── Próxima melhor ação ───────────────────────────────────────────────────
  async function loadNextAction(phone) {
    if (!ui.nextActionCard) return;
    ui.nextActionCard.style.display = 'none';
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(phone)}/next-action`);
      if (!res.ok) return;
      const s = await res.json();
      ui.nextActionAcao.textContent = s.acao;
      ui.nextActionMotivo.textContent = s.motivo;
      if (s.mensagem) {
        ui.nextActionMensagem.textContent = s.mensagem;
        ui.nextActionMensagemRow.style.display = 'block';
      } else {
        ui.nextActionMensagemRow.style.display = 'none';
      }
      ui.nextActionCard.style.display = 'block';
      if (window.lucide) window.lucide.createIcons({ root: ui.nextActionCard });
    } catch (err) {
      console.error('[next-action] load', err);
    }
  }

  if (ui.nextActionCopyBtn) {
    ui.nextActionCopyBtn.addEventListener('click', async () => {
      const text = ui.nextActionMensagem.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        window.Toast?.show('Mensagem copiada!', 'success');
      } catch {
        window.Toast?.show('Não foi possível copiar automaticamente.', 'error');
      }
    });
  }

  if (ui.nextActionUseBtn) {
    ui.nextActionUseBtn.addEventListener('click', async () => {
      if (!ui.drawerInput || !drawerPhone) return;
      // O campo de resposta só fica visível quando um humano assumiu a conversa —
      // assume automaticamente se ainda estiver com a IA, para o botão funcionar de primeira.
      if (ui.drawerFooter.style.display === 'none') {
        const c = contactsCache.find((x) => x.phone === drawerPhone);
        await handleHandoffAction(drawerPhone, c?.handoff_status || 'none');
      }
      ui.drawerInput.value = ui.nextActionMensagem.textContent || '';
      document.querySelector('[data-target="paneMsg"]')?.click();
      ui.drawerInput.focus();
    });
  }

  async function loadCrm() {
    if (!drawerPhone) return;
    try {
      const data = await (await fetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/crm`)).json();
      ui.crmTipoCliente.value = data.tipo_cliente || '';
      ui.crmLeadSource.value = data.lead_source || 'whatsapp_direto';
      ui.crmRazaoSocial.value = data.razao_social || '';
      ui.crmNomeFantasia.value = data.nome_fantasia || '';
      ui.crmEmail.value = data.email || '';
      ui.crmCep.value = data.cep || '';
      ui.crmEndereco.value = data.endereco || '';
      ui.crmCidade.value = data.cidade || '';
      ui.crmUf.value = data.uf || '';
      ui.crmResponsavel.value = data.responsavel || '';
      ui.crmPrioridade.value = data.prioridade || 'media';
      ui.crmProximaTarefa.value = data.proxima_tarefa || '';
      ui.crmPrazoResposta.value = data.prazo_resposta ? data.prazo_resposta.slice(0, 16).replace(' ', 'T') : '';
      if (ui.crmAssignedUser) ui.crmAssignedUser.value = data.assigned_user_id || '';
      if (ui.crmAssignedTeam) ui.crmAssignedTeam.value = data.assigned_team_id || '';
      showPjFields(data.tipo_cliente === 'pj');

      if (data.cpf_cnpj_masked) {
        ui.crmDocSaved.style.display = 'flex';
        ui.crmDocEditRow.style.display = 'none';
        ui.crmDocMasked.textContent = data.cpf_cnpj_masked;
      } else {
        ui.crmDocSaved.style.display = 'none';
        ui.crmDocEditRow.style.display = 'flex';
        ui.crmDocInput.value = '';
      }
      if (ui.crmCnpjLookupBtn) ui.crmCnpjLookupBtn.style.display = 'none';

      renderCrmTags(data.tags || []);
      if (window.lucide) window.lucide.createIcons({ root: document.getElementById('paneCadastro') });
    } catch (err) {
      console.error('[crm] load', err);
    }
  }

  function renderCrmTags(tags) {
    if (!ui.crmTagsArea) return;
    ui.crmTagsArea.innerHTML = tags.length
      ? tags.map((t) => `
          <span class="badge badge-gray" style="font-size:0.7rem;display:inline-flex;align-items:center;gap:4px;">
            ${esc(t)}
            <button type="button" class="crm-tag-remove" data-tag="${esc(t)}" title="Remover tag" style="background:none;border:none;cursor:pointer;padding:0;display:flex;color:inherit;opacity:0.6;">
              <i data-lucide="x" style="width:11px;height:11px;"></i>
            </button>
          </span>
        `).join('')
      : '<span style="font-size:0.8rem;color:var(--text-secondary);">Sem tags ainda</span>';
    if (window.lucide) window.lucide.createIcons({ root: ui.crmTagsArea });
  }

  let tagVocabulary = { suggested: [], inUse: [] };

  async function loadTagOptions() {
    const res = await fetch('/api/tags');
    if (!res.ok) return;
    tagVocabulary = await res.json();

    if (ui.tagFilter) {
      const current = ui.tagFilter.value;
      ui.tagFilter.innerHTML = '<option value="">Todas as tags</option>' +
        (tagVocabulary.inUse || []).map((r) => `<option value="${esc(r.tag)}">${esc(r.tag)} (${r.n})</option>`).join('');
      ui.tagFilter.value = current;
    }

    const datalist = document.getElementById('crmTagSuggestions');
    if (datalist) {
      const all = new Set([...(tagVocabulary.suggested || []), ...(tagVocabulary.inUse || []).map((r) => r.tag)]);
      datalist.innerHTML = [...all].map((t) => `<option value="${esc(t)}"></option>`).join('');
    }
  }

  if (ui.crmTagsArea) {
    ui.crmTagsArea.addEventListener('click', async (e) => {
      const btn = e.target.closest('.crm-tag-remove');
      if (!btn || !drawerPhone) return;
      try {
        const res = await apiFetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/tags/${encodeURIComponent(btn.dataset.tag)}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
          renderCrmTags(data.tags || []);
          loadTagOptions().catch(() => {});
          refreshData().catch(() => {});
        }
      } catch (err) {
        window.Toast?.show('Erro ao remover tag.', 'error');
      }
    });
  }

  if (ui.crmTagAddBtn) {
    ui.crmTagAddBtn.addEventListener('click', async () => {
      const tag = (ui.crmTagInput.value || '').trim();
      if (!tag || !drawerPhone) return;
      try {
        const res = await apiFetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag }),
        });
        const data = await res.json();
        if (!res.ok) { window.Toast?.show(data.error || 'Erro ao adicionar tag.', 'error'); return; }
        renderCrmTags(data.tags || []);
        ui.crmTagInput.value = '';
        loadTagOptions().catch(() => {});
        refreshData().catch(() => {});
      } catch (err) {
        window.Toast?.show('Erro de conexão ao adicionar tag.', 'error');
      }
    });
  }

  if (ui.crmTipoCliente) {
    ui.crmTipoCliente.addEventListener('change', () => showPjFields(ui.crmTipoCliente.value === 'pj'));
  }

  if (ui.crmDocEditBtn) {
    ui.crmDocEditBtn.addEventListener('click', () => {
      ui.crmDocSaved.style.display = 'none';
      ui.crmDocEditRow.style.display = 'flex';
      ui.crmDocInput.value = '';
      ui.crmDocInput.focus();
    });
  }

  if (ui.crmDocRevealBtn) {
    ui.crmDocRevealBtn.addEventListener('click', async () => {
      if (!drawerPhone) return;
      try {
        const res = await apiFetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/crm/reveal-document`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) { window.Toast?.show(data.error || 'Erro ao revelar documento.', 'error'); return; }
        await window.ZapUI.alert({
          title: 'Documento completo',
          message: data.document,
          confirmText: 'Fechar',
        });
      } catch (err) {
        window.Toast?.show('Erro de conexão.', 'error');
      }
    });
  }

  if (ui.crmCnpjLookupBtn) {
    ui.crmCnpjLookupBtn.addEventListener('click', async () => {
      const cnpj = ui.crmDocInput.value;
      ui.crmCnpjLookupBtn.disabled = true;
      ui.crmCnpjLookupBtn.textContent = 'Buscando...';
      try {
        const res = await apiFetch('/api/cnpj-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cnpj }),
        });
        const data = await res.json();
        if (!res.ok) { window.Toast?.show(data.error || 'Consulta indisponível — preencha manualmente.', 'error'); return; }
        ui.crmRazaoSocial.value = data.razao_social || '';
        ui.crmNomeFantasia.value = data.nome_fantasia || '';
        ui.crmCidade.value = data.cidade || '';
        ui.crmUf.value = data.uf || '';
        if (data.endereco) ui.crmEndereco.value = data.endereco;
        window.Toast?.show('Dados encontrados!', 'success');
      } catch (err) {
        window.Toast?.show('Consulta indisponível — preencha manualmente.', 'error');
      } finally {
        ui.crmCnpjLookupBtn.disabled = false;
        ui.crmCnpjLookupBtn.textContent = 'Buscar dados';
      }
    });
  }

  if (ui.crmSaveBtn) {
    ui.crmSaveBtn.addEventListener('click', async () => {
      if (!drawerPhone) return;
      ui.crmSaveBtn.disabled = true;
      const payload = {
        tipo_cliente: ui.crmTipoCliente.value || null,
        lead_source: ui.crmLeadSource.value,
        razao_social: ui.crmRazaoSocial.value.trim(),
        nome_fantasia: ui.crmNomeFantasia.value.trim(),
        email: ui.crmEmail.value.trim(),
        cep: ui.crmCep.value.trim(),
        endereco: ui.crmEndereco.value.trim(),
        cidade: ui.crmCidade.value.trim(),
        uf: ui.crmUf.value.trim().toUpperCase(),
        responsavel: ui.crmResponsavel.value.trim(),
        prioridade: ui.crmPrioridade.value,
        proxima_tarefa: ui.crmProximaTarefa.value.trim(),
        prazo_resposta: ui.crmPrazoResposta.value ? ui.crmPrazoResposta.value.replace('T', ' ') : null,
      };
      // Só envia cpf_cnpj se o campo de edição estiver visível (evita reenviar/apagar sem querer).
      if (ui.crmDocEditRow.style.display !== 'none') {
        payload.cpf_cnpj = ui.crmDocInput.value;
      }
      try {
        const res = await apiFetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/crm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) { window.Toast?.show(data.error || 'Erro ao salvar cadastro.', 'error'); return; }
        window.Toast?.show('Cadastro salvo!', 'success');
        await loadCrm();
      } catch (err) {
        window.Toast?.show('Erro de conexão ao salvar cadastro.', 'error');
      } finally {
        ui.crmSaveBtn.disabled = false;
      }
    });
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

  // ── Saúde da operação ──────────────────────────────────────────────────
  function healthStorageKey(suffix) {
    return 'zapien_operation_health_' + (meData?.email || 'account') + '_' + suffix;
  }

  function readHealthList(suffix) {
    try {
      const value = JSON.parse(localStorage.getItem(healthStorageKey(suffix)) || '[]');
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }

  function writeHealthList(suffix, value) {
    localStorage.setItem(healthStorageKey(suffix), JSON.stringify(value));
  }

  async function hasPushSubscription() {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return null;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      return Boolean(await registration?.pushManager?.getSubscription());
    } catch { return false; }
  }

  async function loadOperationHealth() {
    if (!ui.operationHealth || meData?.is_admin || meData?.impersonatedBy) return;
    try {
      const [settingsRes, automationsRes, automationOptionsRes, metaRes, pushEnabled] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/automations').catch(() => null),
        fetch('/api/automations/options').catch(() => null),
        fetch('/api/meta/health').catch(() => null),
        hasPushSubscription(),
      ]);
      if (!settingsRes.ok) return;
      const settings = await settingsRes.json();
      const automationData = automationsRes?.ok ? await automationsRes.json() : { automations: [] };
      const automationOptions = automationOptionsRes?.ok ? await automationOptionsRes.json() : null;
      const metaHealth = metaRes?.ok ? await metaRes.json() : null;
      const business = settings.business || {};
      const automations = automationData.automations || [];
      const dismissed = readHealthList('dismissed');
      const collapsed = localStorage.getItem(healthStorageKey('collapsed')) === '1';
      const hasBusinessName = Boolean((settings.business_name || '').trim() && (settings.business_name || '').trim().toLowerCase() !== 'meu negócio');
      const failedAutomations = automations.filter(item => item.last_run_status === 'failed').length;
      const pausedAutomations = automations.filter(item => !item.enabled).length;
      const incompleteAutomations = automationOptions ? automations.filter(item => (item.actions || []).some(action =>
        (action.type === 'send_whatsapp_template' && (!action.template_nome || !(automationOptions.templates || []).some(template => template.nome === action.template_nome))) ||
        (action.type === 'dispatch_existing_webhook' && !automationOptions.webhook_configured)
      )).length : 0;
      const whatsappCritical = settings.wa_configured === false || metaHealth?.status === 'critical';
      const checks = [
        { id:'whatsapp',complete:!whatsappCritical,severity:'critical',label:'WhatsApp conectado',title:'Corrija a conexão do WhatsApp',impact:'Enquanto a conexão estiver com problema, novos clientes podem ficar sem resposta.',href:'/integrations.html#meta-health',cta:'Ver conexão',icon:'message-circle' },
        { id:'business',complete:hasBusinessName&&Boolean((business.descricao||'').trim()),severity:'recommended',label:'Negócio apresentado à IA',title:'Complete as informações do negócio',impact:'A atendente responde com mais precisão quando conhece sua empresa e o que você vende.',href:'/settings.html#business-section',cta:'Completar informações',icon:'store' },
        { id:'products',complete:Array.isArray(business.produtos)&&business.produtos.length>0,severity:'recommended',label:'Produto ou serviço cadastrado',title:'Adicione o primeiro produto ou serviço',impact:'Sem um item cadastrado, a IA não consegue apresentar opções completas ao cliente.',href:'/settings.html#products-section',cta:'Adicionar item',icon:'package-plus' },
        { id:'automation-failure',complete:failedAutomations===0,severity:'critical',label:'Automações sem falhas',title:failedAutomations+' automação(ões) precisa(m) de atenção',impact:'Uma regra falhou recentemente e pode não estar executando a ajuda esperada.',href:'/automations.html',cta:'Revisar automações',icon:'triangle-alert' },
        { id:'automation-setup',complete:incompleteAutomations===0,severity:'critical',label:'Automações com tudo configurado',title:incompleteAutomations+' automação(ões) precisa(m) de configuração',impact:'Falta um template aprovado ou uma integração necessária para a regra funcionar.',href:'/automations.html',cta:'Completar automações',icon:'wrench' },
        { id:'automations',complete:automations.some(item=>item.enabled),severity:'optional',label:'Primeira ajuda automática ativada',title:'Ative sua primeira ajuda automática',impact:'Escolha um objetivo pronto para o Zapien acompanhar sua rotina.',href:'/automations.html',cta:'Escolher uma ajuda',icon:'zap' },
        { id:'automation-paused',complete:pausedAutomations===0,severity:'optional',label:'Automações sem pausas',title:pausedAutomations+' automação(ões) pausada(s)',impact:'As regras pausadas continuam salvas, mas não executam nenhuma ação.',href:'/automations.html',cta:'Ver automações pausadas',icon:'pause-circle' },
        { id:'payment',complete:Boolean(settings.mp_token_set),severity:'optional',label:'Pagamento automático conectado',title:'Receba pagamentos durante a conversa',impact:'Com o Mercado Pago, a IA pode gerar Pix, cartão ou boleto no momento da compra.',href:'/integrations.html#mercado-pago',cta:'Conectar pagamento',icon:'credit-card' },
        { id:'notifications',complete:pushEnabled!==false,severity:'optional',label:'Avisos no aparelho ativados',title:'Ative os avisos no seu aparelho',impact:'Você será avisado mesmo fora do painel quando um cliente precisar de ajuda.',href:'/integrations.html',cta:'Ativar avisos',icon:'bell-ring' },
      ];
      const resolved = checks.filter(item => item.complete || dismissed.includes(item.id)).length;
      const activeIssues = checks.filter(item => !item.complete && !dismissed.includes(item.id));
      const critical = activeIssues.filter(item => item.severity === 'critical');
      const recommended = activeIssues.filter(item => item.severity === 'recommended');
      const next = critical[0] || recommended[0] || activeIssues[0] || null;
      const percent = Math.round((resolved / checks.length) * 100);
      const tone = critical.length ? 'critical' : (activeIssues.length ? 'attention' : 'healthy');
      const title = critical.length
        ? critical.length + (critical.length === 1 ? ' ponto pode impedir o funcionamento' : ' pontos podem impedir o funcionamento')
        : activeIssues.length ? 'Sua operação está funcionando' : 'Tudo pronto para atender';
      const subtitle = critical.length
        ? 'Resolva primeiro o item destacado abaixo.'
        : activeIssues.length ? 'Há melhorias opcionais que podem deixar a rotina mais completa.' : 'O Zapien não encontrou nenhuma pendência agora.';
      ui.operationHealth.hidden = false;
      if (collapsed) {
        ui.operationHealth.innerHTML = '<button type="button" class="operation-health-collapsed is-'+tone+'" data-health-expand><span><i data-lucide="activity"></i><strong>Saúde da operação</strong></span><span>'+esc(title)+' <i data-lucide="chevron-down"></i></span></button>';
      } else {
        const issueLabel = next?.severity === 'critical' ? 'Resolver agora' : next?.severity === 'recommended' ? 'Recomendado' : 'Pode esperar';
        const later = next && next.severity !== 'critical' ? '<button type="button" class="operation-health-later" data-health-dismiss="'+esc(next.id)+'">Agora não</button>' : '';
        const rows = checks.map(item => {
          const ignored = dismissed.includes(item.id) && !item.complete;
          const stateClass = item.complete ? 'is-complete' : ignored ? 'is-ignored' : 'is-'+item.severity;
          const statusText = item.complete ? 'Tudo certo' : ignored ? 'Adiado' : item.severity === 'critical' ? 'Resolver agora' : item.severity === 'recommended' ? 'Recomendado' : 'Opcional';
          return '<div class="operation-health-row '+stateClass+'"><i data-lucide="'+(item.complete?'check-circle-2':ignored?'clock-3':item.icon)+'"></i><span>'+esc(item.label)+'</span><small>'+statusText+'</small></div>';
        }).join('');
        const nextHtml = next
          ? '<div class="operation-health-next is-'+next.severity+'"><span class="operation-health-next-icon"><i data-lucide="'+next.icon+'"></i></span><div><span class="operation-health-priority">'+issueLabel+'</span><h3>'+esc(next.title)+'</h3><p>'+esc(next.impact)+'</p></div><div class="operation-health-actions"><a class="btn btn-primary" href="'+next.href+'">'+esc(next.cta)+' <i data-lucide="arrow-right"></i></a>'+later+'</div></div>'
          : '<div class="operation-health-ready"><i data-lucide="badge-check"></i><div><strong>Nenhuma ação necessária</strong><span>Continuaremos verificando suas conexões e configurações.</span></div></div>';
        ui.operationHealth.innerHTML = '<div class="operation-health is-'+tone+'"><div class="operation-health-head"><div class="operation-health-score" style="--health-progress:'+(percent*3.6)+'deg"><div><strong>'+percent+'%</strong><span>resolvido</span></div></div><div class="operation-health-title"><span>Saúde da operação</span><h2>'+esc(title)+'</h2><p>'+esc(subtitle)+'</p></div><button type="button" class="operation-health-collapse" data-health-collapse aria-label="Recolher"><i data-lucide="chevron-up"></i></button></div>'+nextHtml+'<div class="operation-health-testbar"><span><i data-lucide="flask-conical"></i><span><strong>Quer conferir o ciclo completo?</strong><small>Faça uma simulação privada antes de divulgar.</small></span></span><button type="button" class="btn btn-secondary" data-operation-test>Executar teste</button></div><details class="operation-health-details"><summary>Ver todos os itens <span>'+resolved+' de '+checks.length+' resolvidos</span></summary><div class="operation-health-grid">'+rows+'</div></details></div>';
      }
      ui.operationHealth.querySelector('[data-health-collapse]')?.addEventListener('click',()=>{localStorage.setItem(healthStorageKey('collapsed'),'1');loadOperationHealth();});
      ui.operationHealth.querySelector('[data-health-expand]')?.addEventListener('click',()=>{localStorage.removeItem(healthStorageKey('collapsed'));loadOperationHealth();});
      ui.operationHealth.querySelector('[data-health-dismiss]')?.addEventListener('click',event=>{const id=event.currentTarget.dataset.healthDismiss;if(!dismissed.includes(id))writeHealthList('dismissed',[...dismissed,id]);loadOperationHealth();});
      ui.operationHealth.querySelector('[data-operation-test]')?.addEventListener('click',openOperationTest);
      if(window.lucide)window.lucide.createIcons({root:ui.operationHealth});
    } catch { ui.operationHealth.hidden=true; }
  }

  const OPERATION_TEST_STEPS = [
    { id:'customer',label:'Entrada do cliente',icon:'user-plus' },
    { id:'ai',label:'Resposta da atendente IA',icon:'bot' },
    { id:'catalog',label:'Catálogo de produtos ou serviços',icon:'package-search' },
    { id:'payment',label:'Pagamento durante a conversa',icon:'credit-card' },
    { id:'handoff',label:'Transferência para atendimento humano',icon:'headphones' },
    { id:'automations',label:'Automações ativas',icon:'zap' },
    { id:'notifications',label:'Avisos no aparelho',icon:'bell-ring' },
    { id:'integrations',label:'Integrações essenciais',icon:'plug' },
  ];

  function resetOperationTest() {
    ui.operationTestSetup.hidden = false;
    ui.operationTestRunning.hidden = true;
    ui.operationTestAgain.hidden = true;
    ui.operationTestFinish.hidden = true;
    ui.operationTestAiPreview.hidden = true;
    ui.operationTestProgressBar.style.width = '0%';
    ui.operationTestSummary.textContent = 'Preparando ambiente seguro…';
    ui.operationTestStart.disabled = false;
    ui.operationTestSteps.innerHTML = OPERATION_TEST_STEPS.map(step => '<div class="operation-test-step" data-test-step="'+step.id+'"><span class="operation-test-step-icon"><i data-lucide="'+step.icon+'"></i></span><div><strong>'+esc(step.label)+'</strong><small>Aguardando teste</small></div><span class="operation-test-step-status">Aguardando</span></div>').join('');
    if(window.lucide)window.lucide.createIcons({root:ui.operationTestModal});
  }

  function openOperationTest() {
    resetOperationTest();
    ui.operationTestModal.classList.add('open');
    setTimeout(()=>ui.operationTestMessage?.focus(),80);
  }

  function closeOperationTest() {
    if (ui.operationTestStart.disabled) return;
    ui.operationTestModal.classList.remove('open');
  }

  function updateOperationTestStep(id,status,detail) {
    const row=ui.operationTestSteps.querySelector('[data-test-step="'+id+'"]');
    if(!row)return;
    row.classList.remove('is-running','is-success','is-warning','is-failed');
    row.classList.add('is-'+status);
    row.querySelector('small').textContent=detail;
    const statusEl=row.querySelector('.operation-test-step-status');
    const statusMap={running:'Testando…',success:'Tudo certo',warning:'Atenção',failed:'Falhou'};
    statusEl.textContent=statusMap[status]||status;
    if(window.lucide)window.lucide.createIcons({root:row});
  }

  function setOperationTestProgress(index,text) {
    ui.operationTestProgressBar.style.width=Math.round((index/OPERATION_TEST_STEPS.length)*100)+'%';
    ui.operationTestSummary.textContent=text;
  }

  async function runOperationTest() {
    const message=(ui.operationTestMessage.value||'').trim();
    if(message.length<2){window.Toast?.show('Digite uma pergunta para o cliente de teste.','error');return;}
    resetOperationTest();
    ui.operationTestSetup.hidden=true;
    ui.operationTestRunning.hidden=false;
    ui.operationTestStart.disabled=true;
    const results=[];
    const finishStep=(id,status,detail)=>{updateOperationTestStep(id,status,detail);results.push(status);};
    try{
      updateOperationTestStep('customer','running','Criando apenas um cenário temporário');
      await new Promise(resolve=>setTimeout(resolve,280));
      finishStep('customer','success','Cenário privado criado; nenhum contato foi salvo');
      setOperationTestProgress(1,'Testando a resposta da atendente…');

      updateOperationTestStep('ai','running','Usando as configurações atuais da IA');
      let aiAnswer='';
      try{
        const response=await apiFetch('/api/ai/simulate',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:message}]})});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(data.error||'Resposta indisponível');
        aiAnswer=data.mensagem||data.message||'';
        finishStep('ai','success','A atendente respondeu no ambiente privado');
        ui.operationTestAiText.textContent=aiAnswer||'A atendente respondeu sem conteúdo de prévia.';
        ui.operationTestAiPreview.hidden=false;
      }catch(error){finishStep('ai','failed',error.message||'Não foi possível gerar a resposta');}
      setOperationTestProgress(2,'Verificando catálogo e venda…');

      const [settingsRes,automationsRes,optionsRes,pushEnabled]=await Promise.all([
        fetch('/api/settings'),fetch('/api/automations').catch(()=>null),fetch('/api/automations/options').catch(()=>null),hasPushSubscription(),
      ]);
      if(!settingsRes.ok)throw new Error('Não foi possível carregar as configurações da conta.');
      const settings=await settingsRes.json();
      const business=settings.business||{};
      const products=Array.isArray(business.produtos)?business.produtos:[];
      finishStep('catalog',products.length?'success':'warning',products.length?products.length+' item(ns) disponível(is) para a IA':'Nenhum produto ou serviço cadastrado');
      setOperationTestProgress(3,'Verificando pagamento…');
      finishStep('payment',settings.mp_token_set?'success':'warning',settings.mp_token_set?'Mercado Pago pronto; nenhum pagamento foi criado':'Mercado Pago ainda não está conectado');
      setOperationTestProgress(4,'Simulando transferência humana…');
      finishStep('handoff','success','Transferência simulada; nenhum chamado foi criado');

      updateOperationTestStep('automations','running','Executando somente simulações secas');
      const automationData=automationsRes?.ok?await automationsRes.json():{automations:[]};
      const active=(automationData.automations||[]).filter(item=>item.enabled);
      if(!active.length){
        finishStep('automations','warning','Nenhuma automação ativa para testar');
      }else{
        let blocked=0;let failed=0;
        const samples=active.slice(0,5);
        for(const automation of samples){
          try{
            const response=await apiFetch('/api/automations/'+encodeURIComponent(automation.id)+'/test',{method:'POST',body:JSON.stringify({dry_run:true})});
            const data=await response.json().catch(()=>({}));
            if(!response.ok){failed++;continue;}
            blocked+=(data.actions||[]).filter(action=>Boolean(action.blocked_reason)).length;
          }catch{failed++;}
        }
        const status=failed?'failed':blocked?'warning':'success';
        const detail=failed?failed+' automação(ões) não puderam ser simuladas':blocked?blocked+' ação(ões) exigem configuração':samples.length+' automação(ões) simulada(s) sem envio';
        finishStep('automations',status,detail);
      }
      setOperationTestProgress(6,'Verificando avisos e integrações…');
      finishStep('notifications',pushEnabled===false?'warning':'success',pushEnabled===false?'Avisos no aparelho ainda não estão ativados':pushEnabled===null?'Este navegador não oferece avisos; teste ignorado':'Aparelho inscrito para receber avisos');
      const options=optionsRes?.ok?await optionsRes.json():null;
      const whatsappReady=settings.wa_configured!==false;
      const configured=[whatsappReady,Boolean(settings.mp_token_set),Boolean(options?.webhook_configured)].filter(Boolean).length;
      finishStep('integrations',whatsappReady?'success':'failed',whatsappReady?configured+' de 3 conexões verificadas; WhatsApp operacional':'WhatsApp precisa ser reconectado');
      setOperationTestProgress(8,'Teste completo finalizado');
    }catch(error){
      results.push('failed');
      ui.operationTestSummary.textContent=error.message||'O teste foi interrompido.';
    }finally{
      const failed=results.filter(status=>status==='failed').length;
      const warnings=results.filter(status=>status==='warning').length;
      ui.operationTestFinish.className='operation-test-finish '+(failed?'is-failed':warnings?'is-warning':'is-success');
      ui.operationTestFinish.innerHTML=failed?'<strong>Teste concluído com '+failed+' falha(s)</strong><span>Abra os itens acima para saber o que corrigir.</span>':warnings?'<strong>O ciclo principal está funcionando</strong><span>'+warnings+' melhoria(s) opcional(is) foram encontrada(s).</span>':'<strong>Tudo funcionou na simulação</strong><span>Nenhum dado real foi criado ou enviado.</span>';
      ui.operationTestFinish.hidden=false;
      ui.operationTestAgain.hidden=false;
      ui.operationTestStart.disabled=false;
      if(window.lucide)window.lucide.createIcons({root:ui.operationTestModal});
    }
  }

  ui.operationTestStart?.addEventListener('click',runOperationTest);
  ui.operationTestAgain?.addEventListener('click',resetOperationTest);
  ui.operationTestClose?.addEventListener('click',closeOperationTest);
  ui.operationTestDone?.addEventListener('click',closeOperationTest);
  ui.operationTestModal?.addEventListener('click',event=>{if(event.target===ui.operationTestModal)closeOperationTest();});

  async function saveAssignment() {
    if (!drawerPhone) return;
    const contact = contactsCache.find((x) => x.phone === drawerPhone);
    if (!contact) return;

    const userId = ui.crmAssignedUser?.value || null;
    const teamId = ui.crmAssignedTeam?.value || null;

    try {
      const res = await apiFetch(`/api/contacts/${contact.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, team_id: teamId }),
      });
      if (res.ok) {
        const data = await res.json();
        window.Toast?.show(data.message || 'Atribuição atualizada!', 'success');

        // Atualiza cache local
        contact.assigned_user_id = userId;
        contact.assigned_team_id = teamId;

        // Recarrega mensagens para exibir o aviso de sistema na conversa
        const msgs = await (await fetch(`/api/contacts/${encodeURIComponent(drawerPhone)}/messages`)).json();
        renderMsgs(msgs);

        // Aplica filtro atual
        applyFilter();
      } else {
        const errData = await res.json();
        window.Toast?.show(errData.error || 'Erro ao atribuir conversa.', 'error');
      }
    } catch (err) {
      window.Toast?.show('Erro de conexão.', 'error');
    }
  }

  if (ui.crmAssignedUser) ui.crmAssignedUser.addEventListener('change', saveAssignment);
  if (ui.crmAssignedTeam) ui.crmAssignedTeam.addEventListener('change', saveAssignment);

  // Initial load — refreshData() é chamado dentro de load(), mas se algo
  // explodir antes disso (ZapUI ausente, redirect, etc.) garante que o
  // skeleton some em vez de ficar eternamente visível.
  load().catch((err) => {
    console.error(err);
    refreshData().catch(() => {});
  });
});
