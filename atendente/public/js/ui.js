/**
 * ui.js - Centralized UI logic for Zapien
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // Shared accessibility baseline: keeps semantics and keyboard behavior
  // consistent even on legacy pages while their markup is migrated.
  initAccessibilityBaseline();

  // PWA: registra o service worker do painel (shell estático + Web Push).
  // Nunca pede permissão de notificação aqui — isso só acontece quando o
  // usuário clica em "Ativar notificações" (ver pages/integrations.js).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Navegação por modo de negócio: evita mostrar recursos de loja para
  // profissionais de serviço e vice-versa. A escolha vem do onboarding.
  fetch('/api/settings')
    .then((response) => response.ok ? response.json() : null)
    .then((settings) => {
      if (!settings?.business) return;
      const serviceMode = settings.business.tipo_negocio === 'servicos';
      document.body.dataset.businessMode = serviceMode ? 'services' : 'products';
      document.querySelectorAll('[data-service-only]').forEach((el) => { el.hidden = !serviceMode; });
      document.querySelectorAll('[data-product-only]').forEach((el) => { el.hidden = serviceMode; });
      if (!serviceMode || location.pathname === '/agenda.html') return;

      const agendaLink = (className) => {
        const link = document.createElement('a');
        link.href = '/agenda.html';
        link.className = className;
        link.dataset.dynamicAgenda = '1';
        link.innerHTML = '<i data-lucide="calendar-days"></i><span>Agenda</span>';
        return link;
      };
      const sidebar = document.querySelector('.app-sidebar-nav');
      if (sidebar && !sidebar.querySelector('[data-dynamic-agenda]')) {
        const link = agendaLink('nav-item');
        const plans = [...sidebar.querySelectorAll('a')].find((item) => item.getAttribute('href') === '/plans.html');
        sidebar.insertBefore(link, plans || null);
      }
      const more = document.querySelector('.more-sheet-nav');
      if (more && !more.querySelector('[data-dynamic-agenda]')) {
        const link = agendaLink('more-sheet-item');
        const plans = [...more.querySelectorAll('a')].find((item) => item.getAttribute('href') === '/plans.html');
        more.insertBefore(link, plans || null);
      }
      if (window.lucide) window.lucide.createIcons();
    })
    .catch(() => {});

  // Sidebar toggle for mobile
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('app-sidebar');
  const sidebarClose = document.getElementById('sidebar-close');
  
  const setSidebarOpen = (open) => {
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    document.body.classList.toggle('sidebar-open', open);
  };

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => setSidebarOpen(true));
  }

  if (sidebarClose && sidebar) {
    sidebarClose.addEventListener('click', () => setSidebarOpen(false));
  }

  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 1024 && sidebar && sidebar.classList.contains('open')) {
      if (!sidebar.contains(e.target) && !sidebarToggle.contains(e.target)) {
        setSidebarOpen(false);
      }
    }
  });

  // Badge de não lidos da Central de Avisos — atualiza tanto o sidebar quanto
  // o badge do bottom nav de Avisos.
  const navUnreadBadge    = document.getElementById('navUnreadBadge');
  const bottomNavUnread   = document.getElementById('bottomNavUnread');
  if (navUnreadBadge || bottomNavUnread) {
    fetch('/api/notifications/unread-count')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        const count = data.count > 0 ? String(data.count) : '';
        if (navUnreadBadge) {
          navUnreadBadge.textContent = count;
          navUnreadBadge.classList.toggle('hidden', data.count <= 0);
        }
        if (bottomNavUnread) {
          bottomNavUnread.textContent = count;
          bottomNavUnread.classList.toggle('hidden', data.count <= 0);
        }
      })
      .catch(() => {});
  }

  // ── More Bottom Sheet ──────────────────────────────────────────────────────
  initMoreSheet();

  // --- PR 2: Gestão de Agente, Menus Dinâmicos e Restrições ---
  fetch('/api/agent/me')
    .then((r) => r.ok ? r.json() : null)
    .then((me) => {
      if (!me) return;

      // Dono ou admin: Injeta menu de Usuários & Equipes na Sidebar + mostra Admin no "Mais"
      if (me.role === 'admin') {
        const nav = document.querySelector('.app-sidebar-nav');
        if (nav && !document.getElementById('usersTeamsLink')) {
          const a = document.createElement('a');
          a.id = 'usersTeamsLink';
          a.href = '/users-teams.html';
          a.className = 'nav-item';
          if (location.pathname.includes('users-teams.html')) {
            a.className += ' active';
          }
          a.innerHTML = `
            <i data-lucide="users"></i>
            <span>Equipes & Usuários</span>
          `;
          const configLink = nav.querySelector('a[href*="settings.html"]');
          const refLink = configLink ? configLink.nextElementSibling : (nav.querySelector('a[href*="plans.html"]') || nav.lastElementChild);
          nav.insertBefore(a, refLink);
          if (window.lucide) window.lucide.createIcons({ root: a });
        }
        // Mostra link de Administração no "Mais" sheet
        const moreAdmin = document.getElementById('moreSheetAdmin');
        if (moreAdmin) moreAdmin.style.display = '';
      }

      // Atendente: Esconde links de páginas restritas na Sidebar, Bottom Nav e "Mais" sheet
      if (me.role === 'agent') {
        document.querySelectorAll('.app-sidebar-nav a, .mobile-bottom-nav a, .more-sheet-nav a').forEach((a) => {
          const href = a.getAttribute('href') || '';
          if (
            href.includes('settings.html') ||
            href.includes('integrations.html') ||
            href.includes('plans.html') ||
            href.includes('users-teams.html') ||
            href.includes('automations.html')
          ) {
            a.classList.add('hidden');
          }
        });
      }

      // Se não for dono (ou seja, se for sub-usuário admin ou agent), injeta status toggle no topbar
      if (!me.is_owner) {
        const profileWrapper = document.getElementById('profileBtn')?.parentElement?.parentElement;
        if (profileWrapper) {
          const statusContainer = document.createElement('div');
          statusContainer.id = 'agentStatusToggleContainer';
          statusContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-right: 12px;';
          statusContainer.innerHTML = `
            <span id="agentStatusDot" style="width: 8px; height: 8px; border-radius: 50%; background-color: ${me.available ? '#10b981' : '#9ca3af'}; transition: background-color 0.2s;"></span>
            <span id="agentStatusLabel" style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary);">${me.available ? 'Disponível' : 'Indisponível'}</span>
            <button class="btn btn-secondary" id="toggleAgentStatusBtn" style="padding: 4px 8px; font-size: 0.7rem; min-height: unset; height: 26px;">
              ${me.available ? 'Ficar Offline' : 'Ficar Online'}
            </button>
          `;
          profileWrapper.insertBefore(statusContainer, profileWrapper.firstChild);

          const dot = statusContainer.querySelector('#agentStatusDot');
          const label = statusContainer.querySelector('#agentStatusLabel');
          const btn = statusContainer.querySelector('#toggleAgentStatusBtn');

          let isAvailable = !!me.available;

          btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
              const nextVal = !isAvailable;
              const r = await fetch('/api/agent/status', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-csrf-token': window.csrfToken || ''
                },
                body: JSON.stringify({ available: nextVal }),
              });
              if (r.ok) {
                isAvailable = nextVal;
                dot.style.backgroundColor = isAvailable ? '#10b981' : '#9ca3af';
                label.textContent = isAvailable ? 'Disponível' : 'Indisponível';
                btn.textContent = isAvailable ? 'Ficar Offline' : 'Ficar Online';
                window.Toast?.show(`Status alterado para ${isAvailable ? 'Disponível' : 'Indisponível'}`, 'success');
              } else {
                window.Toast?.show('Erro ao alterar status', 'error');
              }
            } catch (err) {
              window.Toast?.show('Erro de conexão.', 'error');
            } finally {
              btn.disabled = false;
            }
          });
        }
      }
    })
    .catch(() => {});
});


function initAccessibilityBaseline() {
  const iconLabels = {
    x: 'Fechar',
    menu: 'Abrir menu',
    'panel-left': 'Abrir menu',
    send: 'Enviar',
    search: 'Pesquisar',
    trash: 'Excluir',
    'trash-2': 'Excluir',
    edit: 'Editar',
    pencil: 'Editar',
    copy: 'Copiar',
    download: 'Baixar',
    refresh: 'Atualizar',
    'refresh-cw': 'Atualizar',
    'more-horizontal': 'Mais opções',
    'more-vertical': 'Mais opções',
    eye: 'Visualizar',
    'eye-off': 'Ocultar',
    settings: 'Configurar',
    history: 'Ver histórico',
    archive: 'Arquivar',
    'chevron-left': 'Voltar',
    'arrow-left': 'Voltar',
  };

  const knownButtonLabels = {
    'sidebar-close': 'Fechar menu',
    'sidebar-toggle': 'Abrir menu',
    changePwClose: 'Fechar alteração de senha',
    deleteAccountClose: 'Fechar exclusão de conta',
    catalogReviewClose: 'Fechar revisão do catálogo',
  };

  const normalizeButtons = (root = document) => {
    root.querySelectorAll('button').forEach((button) => {
      if (!button.hasAttribute('type') && !button.closest('form')) button.type = 'button';
      if (button.hasAttribute('aria-label') || button.textContent.trim()) return;

      const icon = button.querySelector('[data-lucide]')?.getAttribute('data-lucide');
      const label = knownButtonLabels[button.id] || iconLabels[icon];
      if (label) {
        button.setAttribute('aria-label', label);
        if (!button.hasAttribute('title')) button.title = label;
      }
    });
  };

  const associateLabels = (root = document) => {
    root.querySelectorAll('label:not([for])').forEach((label) => {
      const field = label.parentElement?.querySelector('input, select, textarea');
      if (!field) return;
      if (!field.id) field.id = `field-${Math.random().toString(36).slice(2, 9)}`;
      label.htmlFor = field.id;
    });
  };

  const describeDialogs = (root = document) => {
    root.querySelectorAll('.modal-overlay').forEach((overlay, index) => {
      const dialog = overlay.querySelector('.modal-content') || overlay.firstElementChild;
      if (!dialog) return;

      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      const title = dialog.querySelector('.modal-title, h1, h2, h3');
      if (title) {
        if (!title.id) title.id = `dialog-title-${index + 1}`;
        dialog.setAttribute('aria-labelledby', title.id);
      } else if (!dialog.hasAttribute('aria-label')) {
        dialog.setAttribute('aria-label', 'Janela de diálogo');
      }
    });
  };

  const enhance = (root = document) => {
    normalizeButtons(root);
    associateLabels(root);
    describeDialogs(root);
  };

  enhance();

  const liveRegion = document.createElement('div');
  liveRegion.id = 'app-live-region';
  liveRegion.className = 'sr-only';
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  document.body.appendChild(liveRegion);
  window.ZapAnnounce = (message) => {
    liveRegion.textContent = '';
    requestAnimationFrame(() => { liveRegion.textContent = String(message || ''); });
  };

  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('app-sidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.setAttribute('aria-controls', sidebar.id);
    sidebarToggle.setAttribute('aria-expanded', sidebar.classList.contains('open') ? 'true' : 'false');
  }

  let activeDialog = null;
  let returnFocus = null;
  const isVisible = (element) => {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      (element.classList.contains('open') || style.display === 'flex' || style.display === 'grid');
  };
  const focusable = (dialog) => [...dialog.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => element.offsetParent !== null);

  const syncDialog = () => {
    const visible = [...document.querySelectorAll('.modal-overlay')].filter(isVisible).at(-1);
    if (visible === activeDialog) return;

    if (!visible && activeDialog) {
      activeDialog = null;
      if (returnFocus?.isConnected) returnFocus.focus();
      returnFocus = null;
      document.body.classList.remove('has-accessible-dialog');
      return;
    }

    if (visible) {
      returnFocus = document.activeElement;
      activeDialog = visible;
      document.body.classList.add('has-accessible-dialog');
      const dialog = visible.querySelector('[role="dialog"]') || visible;
      requestAnimationFrame(() => focusable(dialog)[0]?.focus());
    }
  };

  const observer = new MutationObserver((mutations) => {
    mutations.forEach(({ addedNodes }) => addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) enhance(node.matches?.('button, .modal-overlay') ? node.parentElement : node);
    }));
    syncDialog();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });

  document.addEventListener('keydown', (event) => {
    if (!activeDialog) return;
    const dialog = activeDialog.querySelector('[role="dialog"]') || activeDialog;

    if (event.key === 'Escape') {
      const closeButton = dialog.querySelector(
        '[aria-label^="Fechar"], [id$="Close"], [id$="CloseBtn"], .modal-close'
      );
      if (closeButton) {
        event.preventDefault();
        closeButton.click();
      }
      return;
    }

    if (event.key !== 'Tab') return;
    const items = focusable(dialog);
    if (!items.length) {
      event.preventDefault();
      dialog.tabIndex = -1;
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

// Toast Notification System
const Toast = {
  show(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', 'Notificações');
      container.setAttribute('aria-live', 'polite');
      container.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
      `;
      document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'var(--brand-50)' : type === 'error' ? 'var(--danger-50)' : 'var(--surface)';
    const textColor = type === 'success' ? 'var(--brand-700)' : type === 'error' ? 'var(--danger-700)' : 'var(--text-primary)';
    const borderColor = type === 'success' ? 'var(--brand-200)' : type === 'error' ? 'var(--danger-200)' : 'var(--border)';
    
    toast.style.cssText = `
      background-color: ${bgColor};
      color: ${textColor};
      border: 1px solid ${borderColor};
      padding: 12px 16px;
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-md);
      font-size: 0.875rem;
      font-weight: 500;
      opacity: 0;
      transform: translateY(20px);
      transition: all var(--transition-normal);
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    
    const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info';
    toast.innerHTML = `
      <i data-lucide="${icon}" style="width: 18px; height: 18px;"></i>
      <span>${message}</span>
    `;
    
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    container.appendChild(toast);
    window.ZapAnnounce?.(message);
    if (typeof lucide !== 'undefined') lucide.createIcons({ root: toast });
    
    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    
    // Remove after 3 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => {
        toast.remove();
        if (container.children.length === 0) container.remove();
      }, 250); // match transition
    }, 3000);
  }
};
window.Toast = Toast;

// ── Shared Profile Dropdown ────────────────────────────────────────────────
function openZapDialog(options = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';

    const dialog = document.createElement('div');
    dialog.className = 'modal-content zap-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const header = document.createElement('div');
    header.className = 'modal-header';

    const title = document.createElement('h3');
    title.className = 'modal-title';
    title.id = `zap-dialog-title-${Date.now()}`;
    title.textContent = options.title || 'Confirmar ação';
    dialog.setAttribute('aria-labelledby', title.id);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-icon';
    closeBtn.setAttribute('aria-label', 'Fechar');
    closeBtn.innerHTML = '<i data-lucide="x"></i>';

    header.append(title, closeBtn);

    const body = document.createElement('div');
    body.className = 'zap-dialog-body';

    if (options.message) {
      const msg = document.createElement('p');
      msg.className = 'zap-dialog-message';
      msg.textContent = options.message;
      body.appendChild(msg);
    }

    let input = null;
    const error = document.createElement('div');
    error.className = 'zap-dialog-error';

    if (options.input) {
      const field = document.createElement('div');
      field.className = 'form-group zap-dialog-field';

      const label = document.createElement('label');
      label.className = 'form-label';
      label.textContent = options.input.label || 'Valor';

      input = document.createElement('input');
      input.className = 'form-input';
      input.type = options.input.type || 'text';
      input.value = options.input.value || '';
      input.placeholder = options.input.placeholder || '';
      if (options.input.inputMode) input.inputMode = options.input.inputMode;

      field.append(label, input, error);
      body.appendChild(field);
    } else {
      body.appendChild(error);
    }

    const actions = document.createElement('div');
    actions.className = 'zap-dialog-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = options.cancelText || 'Cancelar';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = options.tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary';
    confirmBtn.textContent = options.confirmText || 'Confirmar';

    if (!options.hideCancel) actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.append(header, body, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = (value) => {
      document.removeEventListener('keydown', onKeydown);
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 160);
      resolve(value);
    };

    const showError = (message) => {
      error.textContent = message;
      error.classList.add('is-visible');
    };

    const submit = () => {
      if (!input) {
        close(true);
        return;
      }

      const value = input.value.trim();
      if (options.input.required && !value) {
        showError(options.input.requiredMessage || 'Preencha este campo.');
        input.focus();
        return;
      }
      if (options.input.validate) {
        const validation = options.input.validate(value);
        if (validation !== true) {
          showError(validation || 'Valor inválido.');
          input.focus();
          return;
        }
      }
      close(value);
    };

    function onKeydown(e) {
      if (e.key === 'Escape') close(input ? null : false);
      if (e.key === 'Enter' && input && document.activeElement === input) submit();
    }

    closeBtn.addEventListener('click', () => close(input ? null : false));
    cancelBtn.addEventListener('click', () => close(input ? null : false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(input ? null : false);
    });
    confirmBtn.addEventListener('click', submit);
    document.addEventListener('keydown', onKeydown);

    if (typeof lucide !== 'undefined') lucide.createIcons({ root: dialog });
    requestAnimationFrame(() => (input || confirmBtn).focus());
  });
}

// ── More Bottom Sheet ─────────────────────────────────────────────────────
function initMoreSheet() {
  const moreBtn = document.getElementById('bottom-nav-more');
  const overlay = document.getElementById('more-sheet-overlay');
  if (!moreBtn || !overlay) return;

  // Mark "Mais" button active when current page lives inside the "Mais" section
  const morePaths = ['/automations.html', '/marketing.html', '/integrations.html', '/plans.html', '/admin.html', '/users-teams.html'];
  if (morePaths.some(p => location.pathname.endsWith(p) || location.pathname.includes(p.replace(/^\//, '')))) {
    moreBtn.classList.add('active');
  }

  // Mark the active item inside the sheet
  overlay.querySelectorAll('.more-sheet-item').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href && href !== '#' && (location.pathname.endsWith(href) || location.pathname.includes(href.replace(/^\//, '')))) {
      a.classList.add('active');
    }
  });

  const openSheet = () => {
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('open'));
    overlay.removeAttribute('aria-hidden');
    moreBtn.setAttribute('aria-expanded', 'true');
    const firstItem = overlay.querySelector('.more-sheet-item:not([style*="display: none"]):not(.hidden)');
    if (firstItem) firstItem.focus();
  };

  const closeSheet = () => {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.focus();
    // Hide after transition ends so it doesn't block clicks
    overlay.addEventListener('transitionend', () => {
      if (!overlay.classList.contains('open')) overlay.style.display = 'none';
    }, { once: true });
  };

  moreBtn.addEventListener('click', openSheet);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSheet(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) { e.preventDefault(); closeSheet(); }
  });
  overlay.querySelectorAll('.more-sheet-item').forEach(a => {
    if (a.getAttribute('href')) {
      // Navigation items: close then follow href naturally
      a.addEventListener('click', () => closeSheet());
    }
  });
}

window.ZapUI = {

  renderAsyncState(target, {
    state = 'loading',
    title = '',
    message = '',
    actionLabel = 'Tentar novamente',
    onAction = null,
    colspan = 1,
    compact = false,
  } = {}) {
    if (!target) return null;

    const defaults = {
      loading: { icon: 'loader-circle', title: 'Carregando…', message: 'Só um momento.' },
      empty: { icon: 'inbox', title: 'Nada por aqui ainda', message: '' },
      error: { icon: 'alert-circle', title: 'Não foi possível carregar', message: 'Tente novamente em instantes.' },
    };
    const preset = defaults[state] || defaults.loading;
    const wrapper = document.createElement('div');
    wrapper.className = `async-state async-state--${state}${compact ? ' async-state--compact' : ''}`;
    wrapper.setAttribute('role', state === 'error' ? 'alert' : 'status');
    wrapper.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite');

    const icon = document.createElement('span');
    icon.className = 'async-state-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `<i data-lucide="${preset.icon}"></i>`;

    const copy = document.createElement('div');
    copy.className = 'async-state-copy';
    const heading = document.createElement('strong');
    heading.className = 'async-state-title';
    heading.textContent = title || preset.title;
    copy.appendChild(heading);

    const description = message || preset.message;
    if (description) {
      const paragraph = document.createElement('p');
      paragraph.className = 'async-state-message';
      paragraph.textContent = description;
      copy.appendChild(paragraph);
    }

    wrapper.append(icon, copy);

    if (state === 'error' && typeof onAction === 'function') {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'btn btn-secondary btn-sm async-state-action';
      action.textContent = actionLabel;
      action.addEventListener('click', onAction);
      wrapper.appendChild(action);
    }

    target.replaceChildren();
    if (target.tagName === 'TBODY') {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = colspan;
      cell.appendChild(wrapper);
      row.appendChild(cell);
      target.appendChild(row);
    } else {
      target.appendChild(wrapper);
    }

    target.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    if (window.lucide) window.lucide.createIcons({ root: wrapper });
    return wrapper;
  },

  createRefreshScheduler({ task, interval = 30000, onError = () => {} } = {}) {
    if (typeof task !== 'function') throw new TypeError('A refresh task is required.');

    let timer = null;
    let running = false;
    let pending = false;
    let stopped = true;
    let lastRunAt = 0;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = (delay = interval) => {
      clearTimer();
      if (stopped || document.hidden) return;
      timer = setTimeout(run, Math.max(250, delay));
    };

    const run = async () => {
      clearTimer();
      if (stopped || document.hidden) return;
      if (running) {
        pending = true;
        return;
      }

      running = true;
      pending = false;
      try {
        await task();
        lastRunAt = Date.now();
      } catch (error) {
        onError(error);
      } finally {
        running = false;
        if (stopped || document.hidden) return;
        if (pending) {
          pending = false;
          schedule(250);
        } else {
          schedule(interval);
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
        return;
      }
      const elapsed = Date.now() - lastRunAt;
      if (!lastRunAt || elapsed >= interval) run();
      else schedule(interval - elapsed);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return {
      start({ immediate = false } = {}) {
        if (!stopped) return;
        stopped = false;
        if (immediate && !document.hidden) run();
        else schedule(interval);
      },
      refresh() {
        if (stopped) return Promise.resolve();
        if (running) {
          pending = true;
          return Promise.resolve();
        }
        return run();
      },
      stop() {
        stopped = true;
        pending = false;
        clearTimer();
        document.removeEventListener('visibilitychange', onVisibilityChange);
      },
      get isRunning() {
        return running;
      },
    };
  },

  confirm(options = {}) {
    return openZapDialog(options);
  },

  prompt(options = {}) {
    return openZapDialog({ ...options, input: options.input || {} });
  },

  alert(options = {}) {
    return openZapDialog({
      ...options,
      hideCancel: true,
      confirmText: options.confirmText || 'Entendi',
    });
  },

  setupSupportLink(phone) {
    if (!phone) return;
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return;
    const url = `https://wa.me/${digits}?text=${encodeURIComponent('Olá, preciso de suporte com o Zapien')}`;
    const sidebar = document.getElementById('supportBtn');
    if (sidebar) { sidebar.href = url; sidebar.style.display = ''; }
    const sheet = document.getElementById('moreSheetSupport');
    if (sheet) { sheet.href = url; sheet.style.display = ''; }
  },

  setupProfileDropdown(me, apiFetchFn) {
    const btn      = document.getElementById('profileBtn');
    const dropdown = document.getElementById('profileDropdown');
    const emailEl  = document.getElementById('profileEmail');
    const planEl   = document.getElementById('profilePlanBadge');
    const initial  = document.getElementById('profileInitial');
    const changePwBtn  = document.getElementById('changePwBtn');
    const logoutBtn    = document.getElementById('profileLogoutBtn');
    if (!btn || !dropdown) return;

    if (emailEl) emailEl.textContent = me.email || '—';

    if (initial && me.email) {
      initial.textContent = me.email[0].toUpperCase();
    }

    if (planEl) {
      const sub = me.subscription?.status || '';
      const planLabel = { essencial: 'Essencial', pro: 'Pro', elite: 'Elite' }[me.plan] || me.plan || '';
      const subLabel  = { trial: 'Teste grátis', ativo: 'Ativo', trial_expirado: 'Teste encerrado', inativo: 'Inativo', canceled: 'Cancelado', past_due: 'Em atraso' }[sub] || sub;
      const cls = sub === 'trial' ? 'badge-warning' : sub === 'ativo' ? 'badge-success' : 'badge-danger';
      if (planLabel) {
        planEl.innerHTML = `<span class="badge ${cls}" style="font-size:0.7rem;">${planLabel}${subLabel && subLabel !== 'Ativo' ? ' · ' + subLabel : ''}</span>`;
        if (window.lucide) window.lucide.createIcons({ root: planEl });
      }
    }

    btn.addEventListener('click', (e) => { e.stopPropagation(); dropdown.classList.toggle('hidden'); });
    document.addEventListener('click', () => dropdown.classList.add('hidden'));
    dropdown.addEventListener('click', (e) => e.stopPropagation());

    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
      const fn = apiFetchFn || fetch;
      await fn('/api/logout', { method: 'POST' });
      location.href = '/';
    });
    if (changePwBtn) changePwBtn.addEventListener('click', () => {
      dropdown.classList.add('hidden');
      window.ZapUI.openChangePwModal(apiFetchFn);
    });
  },

  openChangePwModal(apiFetchFn) {
    const modal    = document.getElementById('changePwModal');
    const closeBtn = document.getElementById('changePwClose');
    const saveBtn  = document.getElementById('cpwSaveBtn');
    if (!modal) return;
    modal.classList.add('open');
    ['cpwCurrent','cpwNew','cpwConfirm'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });

    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('open'); };
    if (saveBtn) saveBtn.onclick = async () => {
      const cur  = document.getElementById('cpwCurrent')?.value || '';
      const nw   = document.getElementById('cpwNew')?.value || '';
      const conf = document.getElementById('cpwConfirm')?.value || '';
      if (nw !== conf) { window.Toast?.show('As senhas não coincidem.', 'error'); return; }
      saveBtn.disabled = true;
      try {
        const fn = apiFetchFn || fetch;
        const r = await fn('/api/change-password', {
          method: 'POST',
          body: JSON.stringify({ current_password: cur, new_password: nw }),
        });
        const j = await r.json();
        if (r.ok) { window.Toast?.show('Senha alterada com sucesso!', 'success'); modal.classList.remove('open'); }
        else       { window.Toast?.show(j.error || 'Erro ao alterar senha.', 'error'); }
      } catch { window.Toast?.show('Erro de conexão.', 'error'); }
      finally  { saveBtn.disabled = false; }
    };
  },
};
