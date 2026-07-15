/**
 * Admin Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const ui = {
    logoutBtn: document.getElementById('logoutBtn'),
    kpis: document.getElementById('kpis'),
    searchInput: document.getElementById('searchInput'),
    planFilter: document.getElementById('planFilter'),
    statusFilter: document.getElementById('statusFilter'),
    tableArea: document.getElementById('tableArea'),
    auditLogArea: document.getElementById('auditLogArea'),
  };

  let _csrfToken = null;
  let allTenants = [];
  let quickFilter = "";

  const subLabel = {
    ativo: ['Ativo', 'badge-success'],
    trial: ['Trial', 'badge-warning'],
    trialing: ['Trial', 'badge-warning'],
    trial_expirado: ['Trial expirado', 'badge-danger'],
    inativo: ['Inativo', 'badge-danger'],
    canceled: ['Cancelado', 'badge-danger'],
    past_due: ['Em atraso', 'badge-danger'],
  };

  const PLAN_LABELS = { essencial: 'Essencial', pro: 'Pro', elite: 'Elite', especial: 'Especial' };
  const PLAN_BADGE_CLASS = { essencial: 'badge-gray', pro: 'badge-ai', elite: 'badge-warning', especial: 'badge-success' };
  const PLAN_SELECT_OPTIONS = (current) => Object.keys(PLAN_LABELS).map((id) =>
    `<option value="${id}" ${current === id ? 'selected' : ''}>${PLAN_LABELS[id]}</option>`
  ).join('');

  // Uso do plano — pior status entre AI/armazenamento/áudio/documentos extras.
  const USAGE_STATUS_LABEL = { ok: ['Normal', 'badge-success'], warning: ['Próximo do limite', 'badge-warning'], critical: ['Próximo do limite', 'badge-warning'], blocked: ['Bloqueado', 'badge-danger'] };
  function worstUsageStatus(t) {
    if (!t.usage) return 'ok';
    const order = { blocked: 3, critical: 2, warning: 1, ok: 0 };
    return [t.usage.ai?.status, t.usage.storage?.status, t.usage.audio?.status, t.usage.extraDocs?.status]
      .filter(Boolean)
      .reduce((a, b) => (order[b] > order[a] ? b : a), 'ok');
  }

  // Badge de assinatura com a data de término anexada quando em trial (inclui
  // acesso temporário liberado pelo admin, que também usa status "trial").
  function subscriptionLabel(t) {
    const [lbl, cls] = subLabel[t.subscription.status] || [t.subscription.status, 'badge-danger'];
    if (['trial', 'trialing'].includes(t.subscription.status) && t.trial_ends_at) {
      return [`${lbl} · até ${fmtDate(t.trial_ends_at)}`, cls];
    }
    return [lbl, cls];
  }

  function usageBadge(t) {
    if (!t.usage) return '—';
    const worst = worstUsageStatus(t);
    const [lbl, cls] = USAGE_STATUS_LABEL[worst] || USAGE_STATUS_LABEL.ok;
    return `<span class="badge ${cls}" title="IA: ${t.usage.ai.used}/${t.usage.ai.limit} · Armazenamento: ${t.usage.storage.usedMb}/${t.usage.storage.limitMb}MB">${lbl}</span>`;
  }

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

  function fmtDate(iso) {
    if (!iso) return '—';
    // Datas do SQLite vêm sem 'T' e sem 'Z'; ISO do JS já trazem 'Z' — não duplicar
    const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
    const d = new Date(normalized);
    return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' });
  }

  async function load() {
    const [tenantsRes, meRes] = await Promise.all([
      fetch('/api/admin/tenants'),
      fetch('/api/me').catch(() => null),
    ]);
    if (tenantsRes.status === 403) { location.href = '/dashboard.html'; return; }
    allTenants = await tenantsRes.json();
    if (meRes?.ok) {
      const me = await meRes.json();
      window.ZapUI.setupProfileDropdown(me, apiFetch);
    }
    renderKpis();
    applyFilter();
    loadAuditLog();
  }

  const AUDIT_ACTION_LABEL = {
    impersonate_start: 'Assumiu a conta (impersonation)',
    impersonate_stop: 'Devolveu a conta (fim da impersonation)',
    plan_change: 'Trocou o plano',
    backup_download: 'Baixou backup',
    backup_restore: 'Restaurou backup',
    tenant_activate: 'Reativou a conta',
    tenant_deactivate: 'Desativou a conta',
    temporary_access_grant: 'Liberou acesso temporário',
    account_delete_self: 'Excluiu a própria conta',
    tenant_delete_admin: 'Excluiu conta definitivamente',
  };

  async function loadAuditLog() {
    if (!ui.auditLogArea) return;
    try {
      const r = await fetch('/api/admin/audit-log');
      if (!r.ok) { ui.auditLogArea.innerHTML = ''; return; }
      const rows = await r.json();
      if (!rows.length) {
        ui.auditLogArea.innerHTML = '<p style="padding:16px;color:var(--text-secondary);">Nenhuma ação registrada ainda.</p>';
        return;
      }
      ui.auditLogArea.innerHTML = `
        <div class="table-container">
          <table class="table">
            <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Conta afetada</th><th>Detalhe</th></tr></thead>
            <tbody>
              ${rows.map((r) => `
                <tr>
                  <td>${esc(new Date(r.created_at + 'Z').toLocaleString('pt-BR'))}</td>
                  <td>${esc(r.actor_email || '—')}</td>
                  <td>${esc(AUDIT_ACTION_LABEL[r.action] || r.action)}</td>
                  <td>${esc(r.target_email || '—')}</td>
                  <td>${esc(r.detail || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch {
      ui.auditLogArea.innerHTML = '<p style="padding:16px;color:var(--danger-500);">Erro ao carregar log de auditoria.</p>';
    }
  }

  function renderKpis() {
    if(!ui.kpis) return;
    const ativos = allTenants.filter((t) => t.active).length;
    const assinantes = allTenants.filter((t) => t.subscription.status === 'ativo').length;
    const trials = allTenants.filter((t) => ['trial', 'trialing'].includes(t.subscription.status)).length;
    const semWhatsapp = allTenants.filter((t) => !t.whatsapp_conectado).length;
    const proximosLimite = allTenants.filter((t) => ['warning', 'critical'].includes(worstUsageStatus(t))).length;
    const bloqueados = allTenants.filter((t) => worstUsageStatus(t) === 'blocked').length;

    ui.kpis.innerHTML = [
      { num: ativos, lbl: 'Clientes ativos', icon: 'check-circle', filter: 'ativos', tone: 'success' },
      { num: assinantes, lbl: 'Assinantes pagos', icon: 'credit-card', filter: 'assinantes', tone: 'info' },
      { num: trials, lbl: 'Trials', icon: 'timer', filter: 'trials', tone: 'ai' },
      { num: semWhatsapp, lbl: 'Sem WhatsApp', icon: 'smartphone', filter: 'sem_whatsapp', tone: 'warning' },
      { num: proximosLimite, lbl: 'Próximos do limite', icon: 'gauge', filter: 'limite', tone: 'warning' },
      { num: bloqueados, lbl: 'Bloqueados', icon: 'ban', filter: 'bloqueados', tone: 'danger' },
    ].map((i) => `
      <button class="metric-card metric-card--${i.tone} admin-health-card ${quickFilter === i.filter ? 'is-active' : ''}" data-admin-filter="${i.filter}" type="button">
        <div class="metric-card-top">
          <span class="metric-label">${i.lbl}</span>
          <span class="metric-icon"><i data-lucide="${i.icon}"></i></span>
        </div>
        <div class="metric-value">${i.num}</div>
        <div class="metric-helper">Clique para filtrar</div>
      </button>
    `).join('');

    ui.kpis.querySelectorAll('[data-admin-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        quickFilter = quickFilter === btn.dataset.adminFilter ? '' : btn.dataset.adminFilter;
        renderKpis();
        applyFilter();
      });
    });

    if(window.lucide) window.lucide.createIcons({root: ui.kpis});
  }

  function applyFilter() {
    const q = ui.searchInput?.value.toLowerCase() || '';
    const pf = ui.planFilter?.value || '';
    const sf = ui.statusFilter?.value || '';
    
    const filtered = allTenants.filter((t) => {
      if (q && !t.email.toLowerCase().includes(q) && !(t.business_name || '').toLowerCase().includes(q)) return false;
      if (pf && t.plan !== pf) return false;
      if (sf) {
        const st = t.subscription.status;
        if (sf === 'ativo' && st !== 'ativo') return false;
        if (sf === 'trial' && !['trial','trialing'].includes(st)) return false;
        if (sf === 'inativo' && ['ativo','trial','trialing'].includes(st)) return false;
      }
      if (quickFilter === 'ativos' && !t.active) return false;
      if (quickFilter === 'assinantes' && t.subscription.status !== 'ativo') return false;
      if (quickFilter === 'trials' && !['trial','trialing'].includes(t.subscription.status)) return false;
      if (quickFilter === 'sem_whatsapp' && t.whatsapp_conectado) return false;
      if (quickFilter === 'limite' && !['warning', 'critical'].includes(worstUsageStatus(t))) return false;
      if (quickFilter === 'bloqueados' && worstUsageStatus(t) !== 'blocked') return false;
      return true;
    });
    renderTable(filtered);
  }

  if(ui.searchInput) ui.searchInput.addEventListener('input', applyFilter);
  if(ui.planFilter) ui.planFilter.addEventListener('change', applyFilter);
  if(ui.statusFilter) ui.statusFilter.addEventListener('change', applyFilter);

  function demoMenu(t) {
    return `<details class="admin-nested-actions">
      <summary>Aplicar demo</summary>
      <button class="btn btn-primary" onclick="seedDemo('${t.id}','zapien')">Zapien vende Zapien 🤖</button>
      <button class="btn btn-secondary" onclick="seedDemo('${t.id}','amazonia')">Amazônia Aromas</button>
      <button class="btn btn-secondary" onclick="seedDemo('${t.id}','brinquedo')">Turma do Brinquedo</button>
      <button class="btn btn-secondary" onclick="seedDemo('${t.id}','cafe')">Café & Lar Essencial</button>
      <button class="btn btn-secondary" onclick="seedDemo('${t.id}','pizzaria')">Bella Napoli 🍕</button>
    </details>`;
  }

  function secondaryActions(t) {
    return `
      <select class="plan-select" onchange="changePlan('${t.id}', this.value)" title="Alterar plano">
        <option value="">Alterar plano…</option>
        ${PLAN_SELECT_OPTIONS(t.plan)}
      </select>
      <button class="btn btn-secondary" onclick="grantAccess('${t.id}', '${t.plan}')">Liberar acesso</button>
      <button class="btn btn-secondary" onclick="toggleActive('${t.id}', ${t.active ? 0 : 1})">${t.active ? 'Desativar' : 'Ativar'}</button>
      <a class="btn btn-secondary" href="/api/admin/tenants/${t.id}/backup">Baixar backup</a>
      <button class="btn btn-secondary" onclick="restoreBackup('${t.id}')">Restaurar backup</button>
      ${!t.is_admin ? `<button class="btn btn-secondary admin-delete-account" style="color:var(--danger-600,#dc2626);border-color:var(--danger-300,#fca5a5);" onclick="deleteTenantPermanently('${t.id}', '${esc(t.email)}')">Excluir conta definitivamente</button>` : ''}
      ${demoMenu(t)}
    `;
  }

  function actionsBtns(t) {
    return `
      <button class="btn btn-primary" style="padding: 6px 12px; font-size: 0.75rem;" onclick="impersonate('${t.id}')">Entrar como</button>
      <details class="admin-more-actions">
        <summary>Mais ações</summary>
        <div class="admin-more-actions-menu">${secondaryActions(t)}</div>
      </details>
    `;
  }

  function renderTable(tenants) {
    if(!ui.tableArea) return;
    
    if (!tenants.length) {
      ui.tableArea.innerHTML = `
        <div class="flex flex-col items-center" style="padding: 64px 24px; text-align: center;">
          <i data-lucide="users" style="width: 48px; height: 48px; color: var(--gray-300); margin-bottom: 16px;"></i>
          <h3 style="font-weight: 600; margin-bottom: 8px;">Nenhum cliente encontrado</h3>
        </div>
      `;
      if(window.lucide) window.lucide.createIcons({root: ui.tableArea});
      return;
    }

    // Desktop table rows
    const rows = tenants.map((t) => {
      const [lbl, cls] = subscriptionLabel(t);
      const planLabel = PLAN_LABELS[t.plan] || t.plan;
      const planCls = PLAN_BADGE_CLASS[t.plan] || 'badge-gray';

      return `<tr>
        <td class="cell-email" title="${esc(t.email)}">
          ${esc(t.email)}
          ${t.is_admin ? '<i data-lucide="crown" style="width:14px;height:14px;color:var(--warning-500);"></i>' : ''}
        </td>
        <td class="cell-biz" title="${esc(t.business_name || '')}">${esc(t.business_name) || '—'}</td>
        <td><span class="badge ${planCls}">${planLabel}</span></td>
        <td><span class="badge ${cls}">${lbl}</span></td>
        <td>${usageBadge(t)}</td>
        <td style="text-align:center;">${t.whatsapp_conectado ? '<i data-lucide="check-circle" style="color:var(--brand-500);width:16px;height:16px;display:inline-block;"></i>' : '—'}</td>
        <td style="text-align:center;">${t.contatos}</td>
        <td style="color:var(--text-secondary);">${fmtDate(t.created_at)}</td>
        <td style="color:var(--text-secondary);">${fmtDate(t.last_activity)}</td>
        <td><div class="actions-group">${actionsBtns(t)}</div></td>
      </tr>`;
    }).join('');

    // Mobile cards (compact list)
    const cards = tenants.map((t) => {
      const [lbl, cls] = subscriptionLabel(t);
      const planLabel = PLAN_LABELS[t.plan] || t.plan;
      const planCls = PLAN_BADGE_CLASS[t.plan] || 'badge-gray';

      return `<div class="tenant-card">
        <div class="tenant-card-row">
          <div class="tenant-card-info">
            <div class="tenant-card-email">
              ${esc(t.email)}
              ${t.is_admin ? '<i data-lucide="crown" style="width:11px;height:11px;color:var(--warning-500);"></i>' : ''}
            </div>
            <div class="tenant-card-sub">
              <span>${esc(t.business_name) || '—'}</span>
              <span class="badge ${planCls}">${planLabel}</span>
              <span class="badge ${cls}">${lbl}</span>
              ${usageBadge(t)}
            </div>
          </div>
          <button class="btn btn-primary" style="padding:5px 10px;font-size:0.75rem;white-space:nowrap;" onclick="impersonate('${t.id}')">Entrar</button>
        </div>
        <details class="tenant-card-more">
          <summary>Mais ações</summary>
          <div class="tenant-card-detail">
            <div class="tenant-card-stats">
              <span>📱 ${t.whatsapp_conectado ? '✅' : '—'}</span>
              <span>👥 ${t.contatos}</span>
              <span>📅 ${fmtDate(t.created_at)}</span>
              <span>💬 ${fmtDate(t.last_activity) || '—'}</span>
            </div>
            <div class="tenant-card-secondary">${secondaryActions(t)}</div>
          </div>
        </details>
      </div>`;
    }).join('');

    ui.tableArea.innerHTML = `
      <div class="admin-table-container">
        <table class="admin-table">
          <thead>
            <tr>
              <th>E-mail</th>
              <th>Negócio</th>
              <th>Plano</th>
              <th>Assinatura</th>
              <th>Uso</th>
              <th style="text-align:center;">WA</th>
              <th style="text-align:center;">Contatos</th>
              <th>Cadastro</th>
              <th>Última msg</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="tenant-cards">${cards}</div>
    `;
    
    if(window.lucide) window.lucide.createIcons({root: ui.tableArea});
  }

  window.impersonate = async (id) => {
    const r = await apiFetch(`/api/admin/tenants/${id}/impersonate`, { method: 'POST' });
    const j = await r.json();
    if (!r.ok) { window.Toast?.show(j.error || 'Erro', 'error'); return; }
    location.href = j.redirect || '/settings.html';
  };

  window.deleteTenantPermanently = async (id, email) => {
    const confirmation = await window.ZapUI.prompt({
      title: 'Excluir conta definitivamente',
      message: `Esta ação apaga todos os dados de ${email}, encerra as sessões e não pode ser desfeita. Se a pessoa entrar novamente, começará como uma conta nova. Digite o e-mail completo para confirmar.`,
      confirmText: 'Excluir definitivamente',
      danger: true,
      input: {
        label: 'E-mail da conta',
        placeholder: email,
        required: true,
        validate: (value) => value.trim().toLowerCase() === email.trim().toLowerCase()
          ? true
          : 'Digite exatamente o e-mail exibido.',
      },
    });
    if (!confirmation) return;

    const r = await apiFetch(`/api/admin/tenants/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      window.Toast?.show(data.error || 'Erro ao excluir conta.', 'error');
      return;
    }
    window.Toast?.show(`Conta ${email} excluída definitivamente.`, 'success');
    await load();
  };

  window.changePlan = async (id, plan) => {
    if (!plan) return;
    const r = await apiFetch(`/api/admin/tenants/${id}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    const j = await r.json();
    if (!r.ok) { window.Toast?.show(j.error || 'Erro', 'error'); return; }
    window.Toast?.show('Plano atualizado!', 'success');
    await load();
  };

  window.grantAccess = async (id, currentPlan = 'elite') => {
    const planInput = await window.ZapUI.prompt({
      title: 'Liberar acesso',
      message: 'Escolha o plano que esta conta poderá usar temporariamente.',
      confirmText: 'Continuar',
      input: {
        label: 'Plano',
        value: currentPlan || 'elite',
        placeholder: 'essencial, pro, elite ou especial',
        required: true,
        validate: (value) => PLAN_LABELS[value.toLowerCase()] ? true : 'Use: essencial, pro, elite ou especial.',
      },
    });
    if (!planInput) return;
    const plan = planInput.toLowerCase();
    if (!PLAN_LABELS[plan]) {
      window.Toast?.show('Plano inválido.', 'error');
      return;
    }

    const rawDays = await window.ZapUI.prompt({
      title: 'Tempo de acesso',
      message: `Plano selecionado: ${PLAN_LABELS[plan]}. Defina por quantos dias o acesso ficará liberado.`,
      confirmText: 'Liberar acesso',
      input: {
        label: 'Dias',
        value: '7',
        placeholder: 'Ex: 7',
        type: 'number',
        inputMode: 'numeric',
        required: true,
        validate: (value) => {
          const days = Number(value);
          return Number.isInteger(days) && days >= 1 && days <= 3650
            ? true
            : 'Informe um número de dias entre 1 e 3650.';
        },
      },
    });
    if (!rawDays) return;
    const days = Number(rawDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      window.Toast?.show('Informe um número de dias entre 1 e 3650.', 'error');
      return;
    }

    const r = await apiFetch(`/api/admin/tenants/${id}/grant-access`, {
      method: 'POST',
      body: JSON.stringify({ plan, days }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      window.Toast?.show(j.error || 'Não foi possível liberar acesso.', 'error');
      return;
    }
    const until = j.trial_ends_at ? new Date(j.trial_ends_at.includes('T') ? j.trial_ends_at : j.trial_ends_at.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR') : `${days} dias`;
    window.Toast?.show(`Acesso liberado até ${until}.`, 'success');
    await load();
  };

  window.toggleActive = async (id, active) => {
    if (!active) {
      const ok = await window.ZapUI.confirm({
        title: 'Desativar conta',
        message: 'O cliente perderá o acesso até a conta ser reativada.',
        confirmText: 'Desativar conta',
        cancelText: 'Manter ativa',
        tone: 'danger',
      });
      if (!ok) return;
    }
    await apiFetch(`/api/admin/tenants/${id}/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    window.Toast?.show(active ? 'Conta ativada.' : 'Conta desativada.', 'success');
    await load();
  };

  window.restoreBackup = async (id) => {
    const statusRes = await apiFetch(`/api/admin/tenants/${id}/backup/status`);
    const status = await statusRes.json();
    if (!status.available) {
      window.Toast?.show('Nenhum backup salvo encontrado para este cliente. (O backup é criado automaticamente quando o cliente salva as configurações.)', 'error');
      return;
    }
    const savedAt = status.saved_at ? new Date(status.saved_at).toLocaleString('pt-BR') : '—';
    const bizName = status.business_name || '—';
    const ok = await window.ZapUI.confirm({
      title: 'Restaurar backup',
      message: `Restaurar backup de "${bizName}" salvo em ${savedAt}?\n\nIsso sobrescreve nome, atendente e catálogo atual. Tokens não são alterados.`,
      confirmText: 'Restaurar backup',
      cancelText: 'Cancelar',
      tone: 'danger',
    });
    if (!ok) return;
    const r = await apiFetch(`/api/admin/tenants/${id}/restore`, { method: 'POST' });
    const j = await r.json();
    window.Toast?.show(j.error || 'Backup restaurado com sucesso!', j.error ? 'error' : 'success');
    if (!j.error) await load();
  };

  const seedNames = { zapien: 'Zapien vende Zapien 🤖', amazonia: 'Amazônia Aromas 🌿', brinquedo: 'Turma do Brinquedo 🧸', cafe: 'Café & Lar Essencial ☕', pizzaria: 'Bella Napoli Pizzaria 🍕' };
  window.seedDemo = async (id, seed = 'amazonia') => {
    const label = seedNames[seed] || seed;
    const ok = await window.ZapUI.confirm({
      title: 'Aplicar dados demo',
      message: `Popular esta conta com os dados demo de "${label}"?\n\nIsso sobrescreve nome, atendente e catálogo. Tokens não são alterados.`,
      confirmText: 'Aplicar demo',
      cancelText: 'Cancelar',
      tone: 'danger',
    });
    if (!ok) return;
    const r = await apiFetch(`/api/admin/tenants/${id}/seed-demo`, { method: 'POST', body: JSON.stringify({ seed }) });
    const j = await r.json();
    window.Toast?.show(j.message || j.error || 'Feito!', j.error ? 'error' : 'success');
    await load();
  };

  if(ui.logoutBtn) {
    ui.logoutBtn.addEventListener('click', async () => {
      await apiFetch('/api/logout', { method: 'POST' });
      location.href = '/';
    });
  }

  load();
});
