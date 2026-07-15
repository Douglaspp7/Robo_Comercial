/**
 * Central de Avisos: calendario anual com historico de eventos por dia.
 */

document.addEventListener('DOMContentLoaded', () => {
  const ui = {
    logoutBtn: document.getElementById('logoutBtn'),
    adminLink: document.getElementById('adminLink'),
    avisosList: document.getElementById('avisosList'),
    avisosEmpty: document.getElementById('avisosEmpty'),
    markAllReadBtn: document.getElementById('markAllReadBtn'),
    archiveToggleBtn: document.getElementById('archiveToggleBtn'),
    navUnreadBadge: document.getElementById('navUnreadBadge'),
    calendar: document.getElementById('noticeCalendar'),
    calendarTitle: document.getElementById('calendarTitle'),
    calendarSubtitle: document.getElementById('calendarSubtitle'),
    calendarPrevBtn: document.getElementById('calendarPrevBtn'),
    calendarNextBtn: document.getElementById('calendarNextBtn'),
    selectedDayTitle: document.getElementById('selectedDayTitle'),
    selectedDayBadge: document.getElementById('selectedDayBadge'),
  };

  let _csrfToken = null;
  let notices = [];
  let showArchived = false;
  const today = new Date();
  const minMonth = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  const maxMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let selectedKey = dateKey(today);

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
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseDate(iso) {
    if (!iso) return null;
    const d = new Date(String(iso).replace(' ', 'T') + 'Z');
    return isNaN(d) ? null : d;
  }

  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function noticeKey(n) {
    const d = parseDate(n.created_at);
    return d ? dateKey(d) : '';
  }

  function formatDayTitle(key) {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  function fmtDateTime(iso) {
    const d = parseDate(iso);
    if (!d) return '';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const TYPE_ICON = {
    estoque_esgotado: 'package-x',
    aguardando_humano: 'user-round',
    limite_ia: 'gauge',
    recompra: 'rotate-ccw',
  };

  function noticeCategory(n) {
    const type = String(n.type || '').toLowerCase();
    const text = `${n.title || ''} ${n.message || ''}`.toLowerCase();
    if (['aguardando_humano', 'limite_ia', 'pagamento_erro', 'mp_desconectado'].includes(type) || /aguardando|limite|bloque|pagamento|mercado pago/.test(text)) return 'urgent';
    if (['estoque_esgotado', 'lista_espera', 'recompra', 'lead_quente'].includes(type) || /estoque|recompra|lista de espera|lead quente|checkout/.test(text)) return 'opportunity';
    return 'system';
  }

  function actionLabel(n) {
    const type = String(n.type || '').toLowerCase();
    if (n.contact_phone && type === 'aguardando_humano') return 'Assumir atendimento';
    if (n.contact_phone) return 'Abrir conversa';
    if (type === 'limite_ia') return 'Ver planos';
    if (/integra|mercado pago|pagamento/.test(`${n.title || ''} ${n.message || ''}`.toLowerCase())) return 'Conectar';
    return '';
  }

  function renderNoticeAction(n, label) {
    if (n.contact_phone) {
      return `<button class="btn btn-secondary notice-action" onclick="location.href='/dashboard.html?contact=${encodeURIComponent(n.contact_phone)}'">${label}</button>`;
    }
    if (label === 'Ver planos') {
      return `<button class="btn btn-secondary notice-action" onclick="location.href='/plans.html'">${label}</button>`;
    }
    return '';
  }

  function dayItems(key) {
    return notices.filter((n) => noticeKey(n) === key);
  }

  function dayStatus(items) {
    if (!items.length) return 'empty';
    return items.some((n) => !n.read_at) ? 'unread' : 'read';
  }

  function renderCalendar() {
    if (!ui.calendar) return;

    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const monthLabel = visibleMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    if (ui.calendarTitle) ui.calendarTitle.textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
    if (ui.calendarSubtitle) ui.calendarSubtitle.textContent = showArchived ? 'Mostrando avisos arquivados' : 'Histórico ativo dos últimos 12 meses';
    if (ui.calendarPrevBtn) ui.calendarPrevBtn.disabled = visibleMonth <= minMonth;
    if (ui.calendarNextBtn) ui.calendarNextBtn.disabled = visibleMonth >= maxMonth;

    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const key = dateKey(date);
      const items = dayItems(key);
      const status = dayStatus(items);
      const classes = [
        'calendar-day',
        date.getMonth() !== month ? 'is-outside' : '',
        key === selectedKey ? 'is-selected' : '',
        key === dateKey(today) ? 'is-today' : '',
        status === 'unread' ? 'has-unread' : '',
        status === 'read' ? 'has-read' : '',
      ].filter(Boolean).join(' ');

      cells.push(`<button type="button" class="${classes}" data-date="${key}">
        <span class="day-number">${date.getDate()}</span>
        ${items.length ? `<span class="day-count">${items.length}</span>` : ''}
      </button>`);
    }
    ui.calendar.innerHTML = cells.join('');
    if (window.lucide) window.lucide.createIcons({ root: ui.calendar });
  }

  function renderNoticeCard(n) {
    const icon = TYPE_ICON[n.type] || 'bell';
    const category = noticeCategory(n);
    const unread = !n.read_at;
    const label = actionLabel(n);
    const action = renderNoticeAction(n, label);
    const meta = `${fmtDateTime(n.created_at)}${n.contact_phone ? ` · ${esc(n.contact_name || n.contact_phone)}` : ''}`;

    return `
      <div class="notice-card notice-card--${category} ${unread ? 'is-unread' : 'is-read'}" data-id="${n.id}">
        <span class="notice-icon"><i data-lucide="${icon}"></i></span>
        <div class="notice-content">
          <div class="notice-title">${esc(n.title)}</div>
          <div class="notice-message">${esc(n.message)}</div>
          <div class="notice-meta">${meta}${n.archived_at ? ' · Arquivado' : ''}</div>
        </div>
        <div class="notice-actions">
          ${action}
          ${unread ? `<button class="btn btn-icon mark-read-btn" title="Marcar como lido" data-id="${n.id}"><i data-lucide="check"></i></button>` : ''}
          ${!showArchived ? `<button class="btn btn-icon archive-btn" title="Arquivar" data-id="${n.id}"><i data-lucide="archive"></i></button>` : ''}
          <button class="btn btn-icon delete-notice-btn" title="Apagar definitivamente" data-id="${n.id}"><i data-lucide="trash-2"></i></button>
        </div>
      </div>`;
  }

  function renderSelectedDay() {
    if (!ui.avisosList) return;
    const items = dayItems(selectedKey);
    const status = dayStatus(items);

    if (ui.selectedDayTitle) ui.selectedDayTitle.textContent = formatDayTitle(selectedKey);
    if (ui.selectedDayBadge) {
      ui.selectedDayBadge.className = `day-status-badge is-${status}`;
      ui.selectedDayBadge.textContent = status === 'unread'
        ? `${items.filter((n) => !n.read_at).length} pendente(s)`
        : status === 'read'
          ? 'Resolvido'
          : 'Sem avisos';
    }

    if (!items.length) {
      ui.avisosList.innerHTML = '';
      if (ui.avisosEmpty) {
        ui.avisosEmpty.style.display = 'flex';
        const p = ui.avisosEmpty.querySelector('p');
        if (p) p.textContent = 'Nenhum aviso neste dia.';
      }
      return;
    }

    if (ui.avisosEmpty) ui.avisosEmpty.style.display = 'none';
    ui.avisosList.innerHTML = items.map(renderNoticeCard).join('');
    if (window.lucide) window.lucide.createIcons({ root: ui.avisosList });
  }

  function renderAll() {
    renderCalendar();
    renderSelectedDay();
    if (ui.markAllReadBtn) ui.markAllReadBtn.style.display = showArchived ? 'none' : '';
    if (ui.archiveToggleBtn) {
      ui.archiveToggleBtn.innerHTML = showArchived
        ? '<i data-lucide="bell"></i> Ver ativos'
        : '<i data-lucide="archive"></i> Ver arquivados';
      if (window.lucide) window.lucide.createIcons({ root: ui.archiveToggleBtn });
    }
  }

  async function loadAvisos() {
    try {
      const res = await fetch(`/api/notifications${showArchived ? '?archived=1' : ''}`);
      if (!res.ok) return;
      notices = await res.json();
      renderAll();
    } catch {
      // Mantem a lista anterior em caso de falha de rede.
    }
  }

  async function loadUnreadBadge() {
    try {
      const res = await fetch('/api/notifications/unread-count');
      if (!res.ok) return;
      const { count } = await res.json();
      if (ui.navUnreadBadge) {
        ui.navUnreadBadge.textContent = count > 0 ? String(count) : '';
        ui.navUnreadBadge.classList.toggle('hidden', count <= 0);
      }
    } catch {
      // O badge e apenas um extra visual.
    }
  }

  if (ui.calendar) {
    ui.calendar.addEventListener('click', (e) => {
      const day = e.target.closest('.calendar-day');
      if (!day) return;
      selectedKey = day.dataset.date;
      renderAll();
    });
  }

  ui.calendarPrevBtn?.addEventListener('click', () => {
    if (visibleMonth <= minMonth) return;
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
    renderCalendar();
  });

  ui.calendarNextBtn?.addEventListener('click', () => {
    if (visibleMonth >= maxMonth) return;
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
    renderCalendar();
  });

  if (ui.avisosList) {
    ui.avisosList.addEventListener('click', async (e) => {
      const readBtn = e.target.closest('.mark-read-btn');
      const archiveBtn = e.target.closest('.archive-btn');
      const deleteBtn = e.target.closest('.delete-notice-btn');

      if (readBtn) {
        await apiFetch(`/api/notifications/${readBtn.dataset.id}/read`, { method: 'POST' });
      } else if (archiveBtn) {
        await apiFetch(`/api/notifications/${archiveBtn.dataset.id}/archive`, { method: 'POST' });
      } else if (deleteBtn) {
        const confirmed = await window.ZapUI.confirm({
          title: 'Excluir aviso',
          message: 'Apagar este aviso definitivamente? Esta ação não pode ser desfeita.',
          confirmText: 'Excluir aviso',
          cancelText: 'Manter aviso',
          tone: 'danger',
        });
        if (!confirmed) return;
        await apiFetch(`/api/notifications/${deleteBtn.dataset.id}`, { method: 'DELETE' });
      } else {
        return;
      }

      await loadAvisos();
      await loadUnreadBadge();
    });
  }

  ui.archiveToggleBtn?.addEventListener('click', async () => {
    showArchived = !showArchived;
    await loadAvisos();
  });

  if (ui.markAllReadBtn) {
    ui.markAllReadBtn.addEventListener('click', async () => {
      await apiFetch('/api/notifications/read-all', { method: 'POST' });
      await loadAvisos();
      await loadUnreadBadge();
    });
  }

  if (ui.logoutBtn) {
    ui.logoutBtn.addEventListener('click', async () => {
      await apiFetch('/api/logout', { method: 'POST' });
      location.href = '/';
    });
  }

  async function load() {
    try {
      const meRes = await fetch('/api/me');
      if (meRes.ok) {
        const me = await meRes.json();
        window.ZapUI.setupProfileDropdown(me, apiFetch);
        window.ZapUI.setupSupportLink(me.supportPhone);
        if (me.is_admin && ui.adminLink) ui.adminLink.classList.remove('hidden');
        if (!me.is_admin) {
          const supportBtn = document.getElementById('supportBtn');
          if (supportBtn) supportBtn.style.display = '';
        }
      }
    } catch {
      // Segue mesmo sem os dados de perfil.
    }

    await loadAvisos();
    await loadUnreadBadge();
    setInterval(() => {
      loadAvisos();
      loadUnreadBadge();
    }, 30000);
  }

  load();
});
