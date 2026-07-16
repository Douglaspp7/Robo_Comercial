/**
 * Integrations Page Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  let _csrfToken = null;
  let planFeatures = {};
  let features = {};

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
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
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

  function normalizeBusinessType(value) {
    const type=String(value||'').toLowerCase();
    if(['alimentacao','pizzaria','restaurante','delivery'].includes(type))return 'alimentacao';
    if(['servicos','serviço','serviço'].includes(type))return 'servicos';
    if(['digital','produto_digital','infoproduto'].includes(type))return 'digital';
    return 'loja';
  }

  function focusIntegration(id,bodyId) {
    const body=document.getElementById(bodyId);
    if(body){
      body.style.display=bodyId==='meta-health-body'?'flex':'block';
      const section=body.closest('.integration-section');
      section?.querySelector('.category-card')?.classList.add('expanded');
    }
    const card=document.getElementById(id);
    if(!card)return;
    card.scrollIntoView({behavior:'smooth',block:'center'});
    card.classList.remove('integration-focus');
    requestAnimationFrame(()=>card.classList.add('integration-focus'));
    setTimeout(()=>card.classList.remove('integration-focus'),1700);
  }

  function renderIntegrationGuide(settings) {
    const area=document.getElementById('integrationGuide');
    if(!area)return;
    const type=normalizeBusinessType(settings.business?.tipo_negocio);
    const typeLabels={loja:'Loja e produtos',servicos:'Serviços',alimentacao:'Alimentação e delivery',digital:'Produtos digitais'};
    const registry={
      whatsapp:{name:'WhatsApp',benefit:'Canal principal para a IA atender seus clientes.',connected:settings.wa_configured!==false,icon:'message-circle',target:'integration-whatsapp',body:'essenciais-body'},
      mp:{name:'Mercado Pago',benefit:'Gere Pix, cartão ou boleto durante a conversa.',connected:Boolean(settings.mp_token_set),icon:'credit-card',target:'mercado-pago',body:'essenciais-body'},
      shipping:{name:'Melhor Envio',benefit:'Calcule frete e gere etiquetas usando o CEP do cliente.',connected:Boolean(settings.melhor_envio_token_set||settings.cep_origem||features.mePlatformEnabled),icon:'truck',target:'integration-melhor-envio',body:'loja-body'},
      bling:{name:'Bling',benefit:'Sincronize produtos, estoque e pedidos da sua operação.',connected:Boolean(settings.bling_connected),icon:'boxes',target:'integration-bling',body:'loja-body'},
      sheets:{name:'Google Sheets',benefit:'Mantenha leads e vendas também em uma planilha.',connected:Boolean(settings.google_sheets?.connected),icon:'table-2',target:'integration-google-sheets',body:'crm-body'},
      calendar:{name:'Google Calendar',benefit:'Evite conflitos e crie eventos dos agendamentos automaticamente.',connected:Boolean(settings.google_calendar?.connected),icon:'calendar-days',target:'integration-google-calendar',body:'calendar-body'},
      hotmart:{name:'Hotmart',benefit:'Entregue automaticamente produtos digitais após a venda.',connected:Boolean(settings.hotmart_connected),icon:'flame',target:'integration-hotmart',body:'loja-body'},
      printnode:{name:'Impressão de comandas',benefit:'Imprima pedidos automaticamente na cozinha ou balcão.',connected:Boolean(settings.printnode_connected),icon:'printer',target:'integration-printnode',body:'loja-body'},
    };
    const essential=['whatsapp'];
    const recommendedByType={
      loja:['mp','shipping','bling'],
      servicos:['mp','sheets'],
      alimentacao:['mp','printnode'],
      digital:['mp','hotmart'],
    };
    const recommended=recommendedByType[type]||recommendedByType.loja;
    const optional=Object.keys(registry).filter(id=>!essential.includes(id)&&!recommended.includes(id));
    const ordered=[...essential,...recommended,...optional];
    const nextId=ordered.find(id=>!registry[id].connected);
    const next=nextId?registry[nextId]:null;
    const itemHtml=(id)=>{
      const item=registry[id];
      return '<button type="button" class="integration-path-item '+(item.connected?'is-connected':'')+'" data-focus-integration="'+item.target+'" data-focus-body="'+item.body+'"><i data-lucide="'+(item.connected?'check-circle-2':item.icon)+'"></i>'+esc(item.name)+'</button>';
    };
    const groupHtml=(title,icon,ids)=>'<div class="integration-path-group"><h3><i data-lucide="'+icon+'"></i>'+title+'</h3><div class="integration-path-items">'+ids.map(itemHtml).join('')+'</div></div>';
    const nextHtml=next?'<div class="integration-next"><div class="integration-next-main"><span class="integration-next-icon"><i data-lucide="'+next.icon+'"></i></span><div><span class="integration-next-label">Próxima conexão sugerida</span><h3>'+esc(next.name)+'</h3><p>'+esc(next.benefit)+'</p></div></div><button type="button" class="btn btn-primary" data-focus-integration="'+next.target+'" data-focus-body="'+next.body+'">Ver como conectar <i data-lucide="arrow-right"></i></button></div>':'<div class="integration-next"><div class="integration-next-main"><span class="integration-next-icon"><i data-lucide="badge-check"></i></span><div><span class="integration-next-label">Conexões recomendadas concluídas</span><h3>Seu conjunto principal está conectado</h3><p>As demais ferramentas abaixo são opcionais e podem ser ativadas quando fizerem sentido.</p></div></div></div>';
    area.innerHTML='<div class="integration-guide"><div class="integration-guide-head"><div><div class="integration-guide-eyebrow">Escolha guiada</div><h2>Conecte somente o que ajuda seu negócio</h2><p>Você não precisa configurar tudo. Organizamos as opções pela utilidade para sua operação.</p></div><span class="integration-guide-profile"><i data-lucide="sparkles"></i> Recomendações para '+esc(typeLabels[type])+'</span></div>'+nextHtml+'<div class="integration-path">'+groupHtml('Essencial para começar','shield-check',essential)+groupHtml('Recomendado para você','thumbs-up',recommended)+groupHtml('Opcional','sliders-horizontal',optional)+'</div><p class="integration-guide-note">“Opcional” não significa menos útil — apenas que pode ser configurado depois, quando surgir a necessidade.</p></div>';
    area.querySelectorAll('[data-focus-integration]').forEach(button=>button.addEventListener('click',()=>focusIntegration(button.dataset.focusIntegration,button.dataset.focusBody)));
    if(window.lucide)window.lucide.createIcons({root:area});
  }

  const CATEGORIA_LABEL = { marketing: 'Marketing', utility: 'Utilidade', authentication: 'Autenticação' };

  async function loadTemplates() {
    const list = document.getElementById('templates-list');
    if (!list) return;
    try {
      const res = await fetch('/api/whatsapp-templates');
      if (!res.ok) return;
      const templates = await res.json();
      if (!templates.length) {
        list.innerHTML = '<div class="form-hint" style="margin:0;">Nenhum template cadastrado ainda.</div>';
        return;
      }
      list.innerHTML = templates.map((t) => `
        <div class="flex items-center justify-between gap-2" style="padding:10px 12px; border:1px solid var(--border); border-radius:8px;">
          <div style="min-width:0;">
            <div style="font-weight:600; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              ${esc(t.nome)}
              <span class="badge badge-gray text-xs">${esc(CATEGORIA_LABEL[t.categoria] || t.categoria)}</span>
              <span class="badge badge-gray text-xs">${esc(t.idioma)}</span>
            </div>
            <div style="font-size:0.8rem; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(t.corpo)}</div>
          </div>
          <button type="button" class="btn btn-icon template-delete-btn" data-nome="${esc(t.nome)}" title="Remover"><i data-lucide="trash-2"></i></button>
        </div>
      `).join('');
      if (window.lucide) window.lucide.createIcons({ root: list });
    } catch (err) {
      console.error('[integrations] loadTemplates', err);
    }
  }

  document.getElementById('templates-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.template-delete-btn');
    if (!btn) return;
    const nome = btn.dataset.nome;
    const confirmed = await window.ZapUI.confirm({
      title: 'Remover template',
      message: `Remover o template "${nome}"? Campanhas que já o utilizaram continuarão no histórico.`,
      confirmText: 'Remover template',
      cancelText: 'Manter template',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const res = await apiFetch(`/api/whatsapp-templates/${encodeURIComponent(nome)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      await loadTemplates();
      window.Toast?.show('Template removido.', 'success');
    } catch {
      window.Toast?.show('Não foi possível remover o template.', 'error');
    }
  });

  document.getElementById('template-add-btn')?.addEventListener('click', async () => {
    const nomeInput = document.getElementById('template-nome');
    const idiomaInput = document.getElementById('template-idioma');
    const categoriaInput = document.getElementById('template-categoria');
    const corpoInput = document.getElementById('template-corpo');
    const nome = nomeInput?.value.trim();
    const idioma = idiomaInput?.value.trim();
    const categoria = categoriaInput?.value;
    const corpo = corpoInput?.value.trim();
    if (!nome || !idioma || !corpo) {
      window.Toast?.show('Preencha nome, idioma e corpo do template.', 'error');
      return;
    }
    try {
      const res = await apiFetch('/api/whatsapp-templates', {
        method: 'POST',
        body: JSON.stringify({ nome, idioma, categoria, corpo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Falha ao adicionar');
      if (nomeInput) nomeInput.value = '';
      if (corpoInput) corpoInput.value = '';
      await loadTemplates();
      window.Toast?.show('Template adicionado!', 'success');
    } catch (err) {
      window.Toast?.show(err.message === 'template_ja_existe' ? 'Já existe um template com esse nome.' : 'Não foi possível adicionar o template.', 'error');
    }
  });

  function buildWhatsappPreviewMessage(data) {
    if (data.attendance_preview_msg) return data.attendance_preview_msg;
    if (data.entry_handle && data.entry_code) {
      const [open, marker, close] = Array.from(data.entry_code);
      return `Olá${open} Conheci a @${data.entry_handle}${marker} e queria tirar uma dúvida${close}`;
    }
    if (data.route_code && data.display_handle) {
      return `Olá! Vim conhecer ${data.route_code} @${data.display_handle} e gostaria de ver os produtos 😊`;
    }
    if (data.slug) {
      return `Olá! Vim conhecer a loja @${data.slug} e gostaria de ver os produtos 😊`;
    }
    return '';
  }

  async function loadWhatsappLink() {
    const display = document.getElementById('integrations-wa-link-display');
    const notConfigured = document.getElementById('integrations-wa-link-not-configured');
    const input = document.getElementById('integrations-wa-link-input');
    const openBtn = document.getElementById('integrations-wa-link-open-btn');
    const codeEl = document.getElementById('integrations-wa-attendance-code');
    const previewEl = document.getElementById('integrations-wa-link-message-preview');
    const previewTextEl = document.getElementById('integrations-wa-link-preview-text');
    const copyBtn = document.getElementById('integrations-wa-link-copy-btn');

    if (!display || !notConfigured || !input || !openBtn) return;

    try {
      const res = await fetch('/api/whatsapp/link');
      if (!res.ok) throw new Error('Falha ao carregar link do WhatsApp.');
      const data = await res.json();

      if (data.link) {
        const url = data.attendance_url || data.link;
        display.style.display = 'flex';
        notConfigured.style.display = 'none';
        input.value = url;
        openBtn.href = url;
        if (codeEl) codeEl.textContent = data.attendance_code || '';

        const message = buildWhatsappPreviewMessage(data);
        if (previewEl && previewTextEl) {
          previewTextEl.textContent = message;
          previewEl.style.display = message ? 'block' : 'none';
        }
      } else {
        display.style.display = 'none';
        notConfigured.style.display = 'block';
        input.value = '';
        openBtn.href = '#';
        if (codeEl) codeEl.textContent = '';
        if (previewEl) previewEl.style.display = 'none';
      }
    } catch (err) {
      console.warn('[integrations] whatsapp link', err);
      display.style.display = 'none';
      notConfigured.style.display = 'block';
    }

    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.dataset.bound = 'true';
      copyBtn.addEventListener('click', async () => {
        const url = input.value;
        if (!url) return;
        try {
          await navigator.clipboard.writeText(url);
          window.Toast?.show('Link copiado!', 'success');
        } catch {
          input.select();
          document.execCommand('copy');
          window.Toast?.show('Link copiado!', 'success');
        }
      });
    }

    if (window.lucide) window.lucide.createIcons();
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    await apiFetch('/api/logout', { method: 'POST' });
    location.href = '/';
  });

  const stopImpersonateBtn = document.getElementById('stopImpersonateBtn');
  if (stopImpersonateBtn) stopImpersonateBtn.addEventListener('click', async () => {
    const r = await apiFetch('/api/admin/stop-impersonate', { method: 'POST' });
    const j = await r.json();
    location.href = j.redirect || '/admin.html';
  });

  // ── OAuth return URL params ────────────────────────────────────────────────
  (function handleOAuthReturn() {
    const params = new URLSearchParams(location.search);
    const clean = () => history.replaceState({}, '', location.pathname);

    const errMaps = {
      mp: {
        invalid_state: 'Erro de segurança na autenticação. Tente novamente.',
        oauth_failed: 'Falha ao conectar com Mercado Pago. Verifique suas credenciais e o Redirect URI no painel MP.',
        not_configured: 'OAuth do Mercado Pago não está configurado na plataforma.',
      },
      bling: {
        invalid_state: 'Erro de segurança na autenticação. Tente novamente.',
        oauth_failed: 'Falha ao conectar com Bling. Verifique as credenciais no painel de desenvolvedor.',
        not_configured: 'OAuth do Bling não está configurado na plataforma.',
      },
      nuvemshop: {
        invalid_state: 'Erro de segurança na autenticação. Tente novamente.',
        oauth_failed: 'Falha ao conectar com a Nuvemshop. Verifique as credenciais no painel de desenvolvedor.',
        not_configured: 'OAuth da Nuvemshop não está configurado na plataforma.',
      },
      gs: {
        oauth_failed: 'Falha ao conectar com Google Sheets. Verifique as credenciais no Google Cloud.',
        not_configured: 'Google Sheets ainda não está configurado na plataforma.',
        invalid_state: 'Sessão expirada. Tente conectar novamente.',
      },
      gcal: {
        oauth_failed: 'Falha ao conectar com Google Calendar. Confira a API e o Redirect URI no Google Cloud.',
        not_configured: 'Google Calendar ainda não está configurado na plataforma.',
        invalid_state: 'Sessão expirada. Tente conectar novamente.',
      },
    };

    if (params.has('mp_connected')) {
      setTimeout(() => window.Toast?.show('Mercado Pago conectado com sucesso! 🎉', 'success'), 400);
      clean();
    } else if (params.has('mp_error')) {
      const msg = errMaps.mp[params.get('mp_error')] || 'Erro ao conectar com Mercado Pago.';
      setTimeout(() => window.Toast?.show(msg, 'error'), 400);
      clean();
    } else if (params.has('bling_connected')) {
      setTimeout(() => window.Toast?.show('Bling conectado com sucesso! 🎉', 'success'), 400);
      clean();
    } else if (params.has('bling_error')) {
      const msg = errMaps.bling[params.get('bling_error')] || 'Erro ao conectar com Bling.';
      setTimeout(() => window.Toast?.show(msg, 'error'), 400);
      clean();
    } else if (params.has('nuvemshop_connected')) {
      setTimeout(() => window.Toast?.show('Nuvemshop conectada com sucesso! 🎉', 'success'), 400);
      clean();
    } else if (params.has('nuvemshop_error')) {
      const msg = errMaps.nuvemshop[params.get('nuvemshop_error')] || 'Erro ao conectar com a Nuvemshop.';
      setTimeout(() => window.Toast?.show(msg, 'error'), 400);
      clean();
    } else if (params.has('gs_connected')) {
      setTimeout(() => window.Toast?.show('Google Sheets conectado com sucesso! 🎉', 'success'), 400);
      clean();
    } else if (params.has('gs_error')) {
      const msg = errMaps.gs[params.get('gs_error')] || 'Erro ao conectar com Google Sheets.';
      setTimeout(() => window.Toast?.show(msg, 'error'), 400);
      clean();
    } else if (params.has('gcal_connected')) {
      setTimeout(() => window.Toast?.show('Google Calendar conectado com sucesso! 🎉', 'success'), 400); clean();
    } else if (params.has('gcal_error')) {
      const msg = errMaps.gcal[params.get('gcal_error')] || 'Erro ao conectar com Google Calendar.';
      setTimeout(() => window.Toast?.show(msg, 'error'), 400); clean();
    }
  })();

  // ── Google Sheets: status, sync, desconexão ───────────────────────────────
  function applyGoogleSheetsStatus(status = {}) {
    const badge = document.getElementById('badge-google-sheets');
    const disconnected = document.getElementById('google-sheets-disconnected');
    const connected = document.getElementById('google-sheets-connected');
    const openBtn = document.getElementById('google-sheets-open-btn');
    const nameEl = document.getElementById('google-sheets-name');
    const syncEl = document.getElementById('google-sheets-last-sync');
    if (badge) {
      badge.textContent = status.connected ? 'Conectado' : 'Não conectado';
      badge.className = status.connected ? 'badge badge-success text-xs' : 'badge badge-gray text-xs';
    }
    if (disconnected) disconnected.style.display = status.connected ? 'none' : 'flex';
    if (connected) connected.style.display = status.connected ? 'block' : 'none';
    if (openBtn) {
      openBtn.href = status.spreadsheet_url || '#';
      openBtn.style.display = status.spreadsheet_url ? 'inline-flex' : 'none';
    }
    if (nameEl) nameEl.textContent = status.spreadsheet_name || 'Planilha do Zapien';
    if (syncEl) syncEl.textContent = status.last_sync_at
      ? `Última sincronização: ${new Date(status.last_sync_at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')}`
      : 'Ainda não sincronizado';
  }

  document.getElementById('google-sheets-sync-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('google-sheets-sync-btn');
    if (!btn) return;
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = 'Sincronizando...';
    try {
      const res = await apiFetch('/api/google-sheets/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível sincronizar a planilha. Tente novamente.');
      applyGoogleSheetsStatus(data);
      window.Toast?.show('Planilha sincronizada com sucesso.', 'success');
    } catch (err) {
      window.Toast?.show(err.message || 'Não foi possível sincronizar a planilha. Tente novamente.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  });

  document.getElementById('google-sheets-disconnect-btn')?.addEventListener('click', async () => {
    const confirmed = await window.ZapUI.confirm({
      title: 'Desconectar Google Sheets',
      message: 'A planilha não será apagada, mas deixará de sincronizar.',
      confirmText: 'Desconectar',
      cancelText: 'Manter conectado',
      tone: 'danger',
    });
    if (!confirmed) return;
    const res = await apiFetch('/api/google-sheets/disconnect', { method: 'POST' });
    if (res.ok) {
      applyGoogleSheetsStatus({ connected: false });
      window.Toast?.show('Google Sheets desconectado.', 'success');
    } else {
      window.Toast?.show('Não foi possível desconectar. Tente novamente.', 'error');
    }
  });

  function applyGoogleCalendarStatus(status = {}) {
    const connected = Boolean(status.connected);
    const enabled = status.enabled !== false;
    const badge = document.getElementById('badge-google-calendar');
    if (badge) { badge.textContent = connected ? 'Conectado' : enabled ? 'Não conectado' : 'Configuração pendente'; badge.className = connected ? 'badge badge-success text-xs' : enabled ? 'badge badge-gray text-xs' : 'badge badge-warning text-xs'; }
    const off = document.getElementById('google-calendar-disconnected'); if (off) off.style.display = connected ? 'none' : 'block';
    const on = document.getElementById('google-calendar-connected'); if (on) on.style.display = connected ? 'block' : 'none';
    const name = document.getElementById('google-calendar-name'); if (name) name.textContent = status.calendar_name || 'Agenda principal';
    const hint = document.getElementById('google-calendar-config-hint'); if (hint) hint.style.display = !connected && !enabled ? 'block' : 'none';
  }
  document.getElementById('google-calendar-sync-btn')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget; btn.disabled = true;
    try { const res = await apiFetch('/api/google-calendar/sync', { method:'POST' }); const data = await res.json(); if (!res.ok) throw new Error(data.error); applyGoogleCalendarStatus(data); window.Toast?.show('Google Calendar sincronizado.', 'success'); }
    catch (err) { window.Toast?.show(err.message || 'Falha ao sincronizar.', 'error'); } finally { btn.disabled = false; }
  });
  document.getElementById('google-calendar-disconnect-btn')?.addEventListener('click', async () => {
    const confirmed = await window.ZapUI.confirm({ title:'Desconectar Google Calendar', message:'Os eventos existentes não serão apagados, mas novos horários deixarão de sincronizar.', confirmText:'Desconectar', cancelText:'Manter conectado', tone:'danger' });
    if (!confirmed) return;
    const res = await apiFetch('/api/google-calendar/disconnect', { method:'POST' });
    if (res.ok) { applyGoogleCalendarStatus({ connected:false }); window.Toast?.show('Google Calendar desconectado.', 'success'); }
  });

  // ── Mercado Pago: desconectar ─────────────────────────────────────────────
  document.getElementById('mp-disconnect-btn')?.addEventListener('click', async () => {
    const confirmed = await window.ZapUI.confirm({
      title: 'Desconectar Mercado Pago',
      message: 'A IA deixará de gerar Pix, cartão e boleto automaticamente.',
      confirmText: 'Desconectar',
      cancelText: 'Manter conectado',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const res = await apiFetch('/api/mp/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error('Falha ao desconectar Mercado Pago.');
      const mp_access_token = document.getElementById('mp_access_token');
      if (mp_access_token) mp_access_token.value = '';
      const bMP = document.getElementById('badge-mp');
      if (bMP) { bMP.textContent = 'Não configurado'; bMP.className = 'badge badge-gray text-xs'; }
      const mpConnectedBox = document.getElementById('mp-connected-box');
      if (mpConnectedBox) mpConnectedBox.style.display = 'none';
      const mpDisconnectBtn = document.getElementById('mp-disconnect-btn');
      if (mpDisconnectBtn) mpDisconnectBtn.style.display = 'none';
      const mpOAuthBtn = document.getElementById('mp-oauth-btn');
      if (mpOAuthBtn) {
        mpOAuthBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 48 48" fill="none" style="flex-shrink:0;"><circle cx="24" cy="24" r="24" fill="#009EE3"/><path d="M33.5 16.5H14.5C13.1 16.5 12 17.6 12 19v10c0 1.4 1.1 2.5 2.5 2.5h19c1.4 0 2.5-1.1 2.5-2.5V19c0-1.4-1.1-2.5-2.5-2.5zM24 27c-1.7 0-3-1.3-3-3s1.3-3 3-3 3 1.3 3 3-1.3 3-3 3z" fill="white"/></svg> Conectar com Mercado Pago';
        mpOAuthBtn.style.display = 'inline-flex';
      }
      window.Toast?.show('Mercado Pago desconectado.', 'success');
    } catch (err) {
      window.Toast?.show(err.message || 'Não foi possível desconectar Mercado Pago.', 'error');
    }
  });

  // ── Bling: desconectar ────────────────────────────────────────────────────
  document.getElementById('bling-disconnect-btn')?.addEventListener('click', async () => {
    const confirmed = await window.ZapUI.confirm({
      title: 'Desconectar Bling',
      message: 'A sincronização de produtos e estoque deixará de funcionar.',
      confirmText: 'Desconectar',
      cancelText: 'Manter conectado',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const res = await apiFetch('/api/bling/disconnect', { method: 'POST' });
      if (res.ok) {
        window.Toast?.show('Bling desconectado.', 'success');
        setTimeout(() => location.reload(), 800);
      } else {
        window.Toast?.show('Erro ao desconectar o Bling.', 'error');
      }
    } catch {
      window.Toast?.show('Erro de conexão.', 'error');
    }
  });

  document.getElementById('bling-import-products-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('bling-import-products-btn');
    if (!btn) return;
    const oldHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Importando...';
    if (window.lucide) window.lucide.createIcons({ root: btn });
    try {
      const res = await apiFetch('/api/bling/import-products', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível importar produtos do Bling.');
      window.Toast?.show(`Produtos importados: ${data.imported || 0} novos, ${data.updated || 0} atualizados.`, 'success');
      setTimeout(() => { location.href = '/settings.html#produtos'; }, 900);
    } catch (err) {
      window.Toast?.show(err.message || 'Erro ao importar produtos do Bling.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
      if (window.lucide) window.lucide.createIcons({ root: btn });
    }
  });

  // ── Nuvemshop: desconectar ────────────────────────────────────────────────
  document.getElementById('nuvemshop-disconnect-btn')?.addEventListener('click', async () => {
    const confirmed = await window.ZapUI.confirm({
      title: 'Desconectar Nuvemshop',
      message: 'A sincronização de produtos e estoque deixará de funcionar.',
      confirmText: 'Desconectar',
      cancelText: 'Manter conectado',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const res = await apiFetch('/api/nuvemshop/disconnect', { method: 'POST' });
      if (res.ok) {
        window.Toast?.show('Nuvemshop desconectada.', 'success');
        setTimeout(() => location.reload(), 800);
      } else {
        window.Toast?.show('Erro ao desconectar a Nuvemshop.', 'error');
      }
    } catch {
      window.Toast?.show('Erro de conexão.', 'error');
    }
  });

  // ── Hotmart: salvar Hottok ────────────────────────────────────────────────
  document.getElementById('hotmart-save-btn')?.addEventListener('click', async () => {
    const hottokInput = document.getElementById('hotmart-hottok');
    const hottok = hottokInput?.value.trim();
    if (!hottok) { window.Toast?.show('Cole o Hottok do Hotmart primeiro.', 'error'); return; }
    try {
      const res = await apiFetch('/api/hotmart/config', {
        method: 'POST',
        body: JSON.stringify({ hottok }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        window.Toast?.show('Hotmart conectado com sucesso! 🎉', 'success');
        if (hottokInput) hottokInput.value = '';
        setTimeout(() => location.reload(), 800);
      } else {
        window.Toast?.show(data.error || 'Erro ao salvar o Hottok.', 'error');
      }
    } catch {
      window.Toast?.show('Erro de conexão.', 'error');
    }
  });

  // ── Hotmart: desconectar ──────────────────────────────────────────────────
  document.getElementById('hotmart-disconnect-btn')?.addEventListener('click', async () => {
    const confirmed = await window.ZapUI.confirm({
      title: 'Desconectar Hotmart',
      message: 'Novas compras aprovadas não serão mais confirmadas automaticamente.',
      confirmText: 'Desconectar',
      cancelText: 'Manter conectado',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const res = await apiFetch('/api/hotmart/disconnect', { method: 'POST' });
      if (res.ok) {
        window.Toast?.show('Hotmart desconectado.', 'success');
        setTimeout(() => location.reload(), 800);
      } else {
        window.Toast?.show('Erro ao desconectar o Hotmart.', 'error');
      }
    } catch {
      window.Toast?.show('Erro de conexão.', 'error');
    }
  });

  // ── PrintNode: carregar impressoras ──────────────────────────────────────
  document.getElementById('printnode-load-printers-btn')?.addEventListener('click', async () => {
    const apiKeyInput = document.getElementById('printnode-api-key');
    const select = document.getElementById('printnode-printer-id');
    if (!apiKeyInput || !select) return;

    const btn = document.getElementById('printnode-load-printers-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Carregando...'; }
    try {
      const res = await apiFetch('/api/printnode/printers');
      const printers = await res.json();
      if (!res.ok) {
        window.Toast?.show(printers.error || 'Erro ao buscar impressoras. Verifique a chave de API.', 'error');
        return;
      }
      const savedId = select.dataset.savedId || '';
      select.innerHTML = '<option value="">Selecione uma impressora...</option>';
      for (const p of printers) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.computer || p.state})`;
        if (String(p.id) === savedId) opt.selected = true;
        select.appendChild(opt);
      }
      if (printers.length === 0) {
        window.Toast?.show('Nenhuma impressora encontrada. Verifique se o cliente PrintNode está rodando.', 'error');
      } else {
        window.Toast?.show(`${printers.length} impressora(s) encontrada(s)!`, 'success');
      }
    } catch {
      window.Toast?.show('Erro de conexão ao PrintNode.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="refresh-cw" style="width:16px;height:16px;"></i> Carregar'; window.lucide?.createIcons(); }
    }
  });

  // ── PrintNode: salvar configurações ──────────────────────────────────────
  document.getElementById('printnode-save-btn')?.addEventListener('click', async () => {
    const apiKey = document.getElementById('printnode-api-key')?.value.trim();
    const printerId = document.getElementById('printnode-printer-id')?.value;
    try {
      const res = await apiFetch('/api/settings/printnode', {
        method: 'POST',
        body: JSON.stringify({ printnode_api_key: apiKey || undefined, printnode_printer_id: printerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        window.Toast?.show('PrintNode salvo com sucesso!', 'success');
        document.getElementById('printnode-api-key').value = '';
        setTimeout(() => location.reload(), 800);
      } else {
        window.Toast?.show(data.error || 'Erro ao salvar PrintNode.', 'error');
      }
    } catch {
      window.Toast?.show('Erro de conexão.', 'error');
    }
  });

  // ── PrintNode: desconectar ────────────────────────────────────────────────
  document.getElementById('printnode-disconnect-btn')?.addEventListener('click', async () => {
    const confirmed = await window.ZapUI.confirm({
      title: 'Desconectar PrintNode',
      message: 'A impressão automática de comandas será desativada.',
      confirmText: 'Desconectar',
      cancelText: 'Manter conectado',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const res = await apiFetch('/api/settings/printnode', { method: 'DELETE' });
      if (res.ok) {
        window.Toast?.show('PrintNode desconectado.', 'success');
        setTimeout(() => location.reload(), 800);
      } else {
        window.Toast?.show('Erro ao desconectar o PrintNode.', 'error');
      }
    } catch {
      window.Toast?.show('Erro de conexão.', 'error');
    }
  });

  // ── Webhook: gerar/regenerar segredo ──────────────────────────────────────
  document.getElementById('webhook-regenerate-btn')?.addEventListener('click', async () => {
    const confirmed = await window.ZapUI.confirm({
      title: 'Gerar novo segredo',
      message: 'O segredo atual deixará de ser válido nas suas automações.',
      confirmText: 'Gerar novo segredo',
      cancelText: 'Manter segredo atual',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const res = await apiFetch('/api/webhooks/regenerate-secret', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.secret) {
        const display = document.getElementById('webhook_secret_display');
        if (display) {
          display.value = data.secret;
          display.dataset.justGenerated = '1';
        }
        window.Toast?.show('Novo segredo gerado — copie agora, ele não será mostrado de novo.', 'success');
      } else {
        window.Toast?.show(data.error || 'Erro ao gerar segredo.', 'error');
      }
    } catch {
      window.Toast?.show('Erro de conexão.', 'error');
    }
  });

  // ── Webhook: enviar evento de teste ───────────────────────────────────────
  document.getElementById('webhook-test-btn')?.addEventListener('click', async () => {
    const resultEl = document.getElementById('webhook-test-result');
    if (resultEl) resultEl.textContent = 'Enviando...';
    try {
      const res = await apiFetch('/api/webhooks/test', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (resultEl) resultEl.textContent = data.error || 'Erro ao enviar.';
        return;
      }
      const d = data.delivery;
      if (resultEl) {
        resultEl.textContent = d?.status === 'sucesso'
          ? `✓ Entregue (HTTP ${d.http_status})`
          : `✗ Falhou: ${d?.error || 'sem resposta'}`;
      }
    } catch {
      if (resultEl) resultEl.textContent = 'Erro de conexão.';
    }
  });

  // ── Salvar configurações de integração ────────────────────────────────────
  document.getElementById('integrationsSaveBtn')?.addEventListener('click', async () => {
    const saveBtn = document.getElementById('integrationsSaveBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Salvando...';
    if (window.lucide) window.lucide.createIcons({ root: saveBtn });

    try {
      const payload = {};

      const mptk = document.getElementById('mp_access_token')?.value.trim();
      if (mptk && !mptk.startsWith('***')) payload.mp_access_token = mptk;

      const cep = document.getElementById('cep_origem')?.value.trim().replace(/\D/g, '');
      if (cep) payload.cep_origem = cep;

      const peso = parseFloat(document.getElementById('peso_padrao_kg')?.value);
      if (peso > 0) {
        if (!payload.business) payload.business = {};
        payload.business.peso_padrao_kg = peso;
      }

      const metk = document.getElementById('melhor_envio_token')?.value.trim();
      if (metk && !metk.startsWith('***')) payload.melhor_envio_token = metk;

      const settingsRes = await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const webhookUrl = document.getElementById('webhook_url')?.value.trim();
      const webhookEnabled = document.getElementById('webhook_enabled')?.checked !== false;
      await apiFetch('/api/webhooks/settings', {
        method: 'POST',
        body: JSON.stringify({ webhook_url: webhookUrl, webhook_enabled: webhookEnabled }),
      }).catch(() => {});

      if (document.getElementById('meta-capi-fields')?.style.display === 'block') {
        const capiEnabled = document.getElementById('capi_enabled').checked;
        const capiPixelId = document.getElementById('capi_pixel_id').value.trim();
        const capiAccessToken = document.getElementById('capi_access_token').value.trim();
        const capiTestCode = document.getElementById('capi_test_code').value.trim();
        const capiGraphVersion = document.getElementById('capi_graph_version').value.trim();

        const body = {
          capi_enabled: capiEnabled,
          capi_pixel_id: capiPixelId || null,
          capi_test_code: capiTestCode || null,
          capi_graph_version: capiGraphVersion || 'v21.0',
        };
        if (capiAccessToken && !capiAccessToken.startsWith('•••')) {
          body.capi_access_token = capiAccessToken;
        }

        await apiFetch('/api/meta-capi/config', {
          method: 'PUT',
          body: JSON.stringify(body),
        }).catch(() => {});
      }

      if (settingsRes.ok) {
        window.Toast?.show('Configurações de integração salvas!', 'success');
        setTimeout(() => location.reload(), 900);
      } else {
        const data = await settingsRes.json().catch(() => ({}));
        window.Toast?.show(data.error || 'Erro ao salvar.', 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i data-lucide="save"></i> Salvar configurações';
        if (window.lucide) window.lucide.createIcons({ root: saveBtn });
      }
    } catch {
      window.Toast?.show('Erro de conexão.', 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i data-lucide="save"></i> Salvar configurações';
      if (window.lucide) window.lucide.createIcons({ root: saveBtn });
    }
  });

  // ── Load integrations data ─────────────────────────────────────────────────
  async function loadIntegrations() {
    try {
      const meRes = await fetch('/api/me');
      const me = await meRes.json();
      planFeatures = me.planFeatures || {};
      features = me.features || {};
      applyGoogleCalendarStatus(me.google_calendar || {});

      window.ZapUI.setupProfileDropdown(me, apiFetch);
      window.ZapUI.setupSupportLink(me.supportPhone);

      const adminLink = document.getElementById('adminLink');
      if (me.is_admin && adminLink) adminLink.classList.remove('hidden');
      if (!me.is_admin) {
        const s = document.getElementById('supportBtn');
        if (s) s.style.display = '';
      }
      if (me.impersonatedBy) {
        const bar = document.getElementById('impersonateBar');
        const emailEl = document.getElementById('impersonateEmail');
        if (bar) bar.style.display = 'flex';
        if (emailEl) emailEl.textContent = me.email;
      }

      const navBadge = document.getElementById('navUnreadBadge');
      if (navBadge && me.unread_count > 0) {
        navBadge.textContent = me.unread_count;
        navBadge.classList.remove('hidden');
      }

      const sRes = await fetch('/api/settings');
      const s = await sRes.json();
      renderIntegrationGuide(s);

      // WhatsApp
      const bWA = document.getElementById('badge-wa');
      if (bWA) {
        const waAtivo = s.wa_configured !== false;
        bWA.textContent = waAtivo ? 'Ativo' : 'Não conectado';
        bWA.className = waAtivo ? 'badge badge-success' : 'badge badge-gray';
      }
      await loadWhatsappLink();

      // Mercado Pago
      const bMP = document.getElementById('badge-mp');
      if (bMP) {
        if (s.mp_token_set) { bMP.textContent = 'Configurado'; bMP.className = 'badge badge-success text-xs'; }
        else { bMP.textContent = 'Não configurado'; bMP.className = 'badge badge-gray text-xs'; }
      }

      // MP OAuth UI
      const mpOAuthSection = document.getElementById('mp-oauth-section');
      const mpManualSection = document.getElementById('mp-manual-section');
      if (features.mpOAuthEnabled) {
        if (mpOAuthSection) mpOAuthSection.style.display = 'block';
        if (mpManualSection) mpManualSection.style.display = 'none';
        const mpConnectedBox = document.getElementById('mp-connected-box');
        if (mpConnectedBox) mpConnectedBox.style.display = s.mp_token_set ? 'flex' : 'none';
        const mpOAuthBtn = document.getElementById('mp-oauth-btn');
        const mpDisconnectBtn = document.getElementById('mp-disconnect-btn');
        if (s.mp_token_set) {
          if (mpOAuthBtn) mpOAuthBtn.style.display = 'none';
          if (mpDisconnectBtn) mpDisconnectBtn.style.display = 'inline-flex';
        } else {
          if (mpOAuthBtn) mpOAuthBtn.style.display = 'inline-flex';
          if (mpDisconnectBtn) mpDisconnectBtn.style.display = 'none';
        }
      }

      // MP manual token placeholder
      const mpTokenInput = document.getElementById('mp_access_token');
      if (mpTokenInput) mpTokenInput.value = s.mp_token_set ? '*** (configurado)' : '';

      // Melhor Envio
      const cepInput = document.getElementById('cep_origem');
      const pesoInput = document.getElementById('peso_padrao_kg');
      const meTokenInput = document.getElementById('melhor_envio_token');
      if (cepInput) cepInput.value = s.cep_origem || '';
      if (pesoInput) pesoInput.value = s.business?.peso_padrao_kg || '';
      if (meTokenInput) meTokenInput.value = s.melhor_envio_token_set ? '*** (configurado)' : '';
      const bME = document.getElementById('badge-frete');
      if (bME) {
        const meAtivo = s.melhor_envio_token_set || s.cep_origem || features.mePlatformEnabled;
        if (meAtivo) { bME.textContent = features.mePlatformEnabled ? 'Ativo (plataforma)' : 'Configurado'; bME.className = 'badge badge-success text-xs'; }
        else { bME.textContent = 'Não configurado'; bME.className = 'badge badge-gray text-xs'; }
      }
      if (features.mePlatformEnabled) {
        const mePlatformInfo = document.getElementById('me-platform-info');
        const meTokenSection = document.getElementById('me-token-section');
        if (mePlatformInfo) mePlatformInfo.style.display = 'flex';
        if (meTokenSection) meTokenSection.style.display = 'none';
      }
      // Toggle "Enviar rastreio automaticamente" — persistido em
      // business.me_auto_send_tracking. Carregado do endpoint de status
      // para evitar depender de outros campos que talvez não venham em /api/settings.
      const autoTrackChk = document.getElementById('me_auto_send_tracking');
      if (autoTrackChk && !autoTrackChk.dataset.wired) {
        try {
          const stRes = await apiFetch('/api/settings/melhor-envio/status');
          if (stRes.ok) {
            const st = await stRes.json();
            autoTrackChk.checked = !!st.auto_send_tracking;
          }
        } catch { /* estado default: unchecked */ }
        autoTrackChk.addEventListener('change', async () => {
          try {
            const r = await apiFetch('/api/settings/melhor-envio/auto-tracking', {
              method: 'POST',
              body: JSON.stringify({ enabled: autoTrackChk.checked }),
            });
            if (!r.ok) throw new Error('Falha');
            window.Toast?.show(autoTrackChk.checked ? 'Envio automático ativado.' : 'Envio automático desativado.', 'success');
          } catch (err) {
            autoTrackChk.checked = !autoTrackChk.checked; // reverte
            window.Toast?.show('Não foi possível salvar. Tente de novo.', 'error');
          }
        });
        autoTrackChk.dataset.wired = '1';
      }

      // Bling
      const bBling = document.getElementById('badge-bling');
      const blingOAuthSection = document.getElementById('bling-oauth-section');
      const blingNotAvailable = document.getElementById('bling-not-available');
      if (planFeatures.blingEnabled && features.blingOAuthEnabled) {
        if (blingOAuthSection) blingOAuthSection.style.display = 'block';
        if (blingNotAvailable) blingNotAvailable.style.display = 'none';
        const blingConnectedBox = document.getElementById('bling-connected-box');
        const blingOAuthBtn = document.getElementById('bling-oauth-btn');
        const blingImportProductsBtn = document.getElementById('bling-import-products-btn');
        const blingDisconnectBtn = document.getElementById('bling-disconnect-btn');
        if (blingConnectedBox) blingConnectedBox.style.display = s.bling_connected ? 'flex' : 'none';
        if (blingOAuthBtn) blingOAuthBtn.style.display = s.bling_connected ? 'none' : 'inline-flex';
        if (blingImportProductsBtn) blingImportProductsBtn.style.display = s.bling_connected ? 'inline-flex' : 'none';
        if (blingDisconnectBtn) blingDisconnectBtn.style.display = s.bling_connected ? 'inline-flex' : 'none';
        if (bBling) {
          bBling.textContent = s.bling_connected ? 'Conectado' : 'Não conectado';
          bBling.className = s.bling_connected ? 'badge badge-success text-xs' : 'badge badge-gray text-xs';
        }
      } else {
        if (blingOAuthSection) blingOAuthSection.style.display = 'none';
        if (blingNotAvailable) {
          blingNotAvailable.style.display = 'block';
          blingNotAvailable.textContent = planFeatures.blingEnabled
            ? 'Disponível no seu plano. A conexão Bling ainda precisa ser ativada na plataforma Zapien.'
            : 'Disponível nos planos Elite e Especial — faça upgrade para conectar.';
        }
        if (bBling) {
          bBling.textContent = planFeatures.blingEnabled ? 'Disponível' : 'Não conectado';
          bBling.className = planFeatures.blingEnabled ? 'badge badge-warning text-xs' : 'badge badge-gray text-xs';
        }
      }

      // Nuvemshop
      const bNuvemshop = document.getElementById('badge-nuvemshop');
      const nuvemshopOAuthSection = document.getElementById('nuvemshop-oauth-section');
      const nuvemshopNotAvailable = document.getElementById('nuvemshop-not-available');
      if (planFeatures.nuvemshopEnabled && features.nuvemshopOAuthEnabled) {
        if (nuvemshopOAuthSection) nuvemshopOAuthSection.style.display = 'block';
        if (nuvemshopNotAvailable) nuvemshopNotAvailable.style.display = 'none';
        const nuvemshopConnectedBox = document.getElementById('nuvemshop-connected-box');
        const nuvemshopOAuthBtn = document.getElementById('nuvemshop-oauth-btn');
        const nuvemshopDisconnectBtn = document.getElementById('nuvemshop-disconnect-btn');
        if (nuvemshopConnectedBox) nuvemshopConnectedBox.style.display = s.nuvemshop_connected ? 'flex' : 'none';
        if (nuvemshopOAuthBtn) nuvemshopOAuthBtn.style.display = s.nuvemshop_connected ? 'none' : 'inline-flex';
        if (nuvemshopDisconnectBtn) nuvemshopDisconnectBtn.style.display = s.nuvemshop_connected ? 'inline-flex' : 'none';
        if (bNuvemshop) {
          bNuvemshop.textContent = s.nuvemshop_connected ? 'Conectado' : 'Não conectado';
          bNuvemshop.className = s.nuvemshop_connected ? 'badge badge-success text-xs' : 'badge badge-gray text-xs';
        }
      } else {
        if (nuvemshopOAuthSection) nuvemshopOAuthSection.style.display = 'none';
        if (nuvemshopNotAvailable) {
          nuvemshopNotAvailable.style.display = 'block';
          nuvemshopNotAvailable.textContent = planFeatures.nuvemshopEnabled
            ? 'Disponível no seu plano. A conexão Nuvemshop ainda precisa ser ativada na plataforma Zapien.'
            : 'Disponível nos planos Elite e Especial — faça upgrade para conectar.';
        }
        if (bNuvemshop) {
          bNuvemshop.textContent = planFeatures.nuvemshopEnabled ? 'Disponível' : 'Não conectado';
          bNuvemshop.className = planFeatures.nuvemshopEnabled ? 'badge badge-warning text-xs' : 'badge badge-gray text-xs';
        }
      }

      // Hotmart
      const bHotmart = document.getElementById('badge-hotmart');
      const hotmartSection = document.getElementById('hotmart-section');
      const hotmartNotAvailable = document.getElementById('hotmart-not-available');
      if (planFeatures.hotmartEnabled) {
        if (hotmartSection) hotmartSection.style.display = 'block';
        if (hotmartNotAvailable) hotmartNotAvailable.style.display = 'none';
        const hotmartConnectedBox = document.getElementById('hotmart-connected-box');
        const hotmartDisconnectBtn = document.getElementById('hotmart-disconnect-btn');
        const hotmartUrlInput = document.getElementById('hotmart-webhook-url');
        if (hotmartConnectedBox) hotmartConnectedBox.style.display = s.hotmart_connected ? 'flex' : 'none';
        if (hotmartDisconnectBtn) hotmartDisconnectBtn.style.display = s.hotmart_connected ? 'inline-flex' : 'none';
        if (hotmartUrlInput) hotmartUrlInput.value = s.hotmart_webhook_url || '';
        if (bHotmart) {
          bHotmart.textContent = s.hotmart_connected ? 'Conectado' : 'Não conectado';
          bHotmart.className = s.hotmart_connected ? 'badge badge-success text-xs' : 'badge badge-gray text-xs';
        }
      } else {
        if (hotmartSection) hotmartSection.style.display = 'none';
        if (hotmartNotAvailable) hotmartNotAvailable.style.display = 'block';
      }

      // Templates de Mensagem (WhatsApp Business API) — usados nas campanhas segmentadas
      const templatesSection = document.getElementById('templates-section');
      const templatesNotAvailable = document.getElementById('templates-not-available');
      if (planFeatures.campaignsEnabled) {
        if (templatesSection) templatesSection.style.display = 'block';
        if (templatesNotAvailable) templatesNotAvailable.style.display = 'none';
        loadTemplates();
      } else {
        if (templatesSection) templatesSection.style.display = 'none';
        if (templatesNotAvailable) templatesNotAvailable.style.display = 'block';
      }

      // Google Sheets
      applyGoogleSheetsStatus(s.google_sheets || { connected: false });

      // Webhook genérico
      const webhookUrlInput = document.getElementById('webhook_url');
      const webhookEnabledInput = document.getElementById('webhook_enabled');
      if (webhookUrlInput) webhookUrlInput.value = s.outbound_webhook_url || '';
      if (webhookEnabledInput) webhookEnabledInput.checked = s.outbound_webhook_enabled !== false;
      const bWebhook = document.getElementById('badge-webhook');
      if (bWebhook) {
        bWebhook.textContent = s.outbound_webhook_url ? 'Configurado' : 'Não configurado';
        bWebhook.className = s.outbound_webhook_url ? 'badge badge-success text-xs' : 'badge badge-gray text-xs';
      }
      const webhookSecretDisplay = document.getElementById('webhook_secret_display');
      if (webhookSecretDisplay && !webhookSecretDisplay.dataset.justGenerated) {
        webhookSecretDisplay.value = s.outbound_webhook_secret_set ? '(já gerada — gere novamente para ver o valor)' : '';
      }

      // PrintNode
      const bPrintnode = document.getElementById('badge-printnode');
      if (bPrintnode) {
        bPrintnode.textContent = s.printnode_connected ? 'Configurado' : 'Não configurado';
        bPrintnode.className = s.printnode_connected ? 'badge badge-success text-xs' : 'badge badge-gray text-xs';
      }
      const printConnectedBox = document.getElementById('printnode-connected-box');
      if (printConnectedBox) printConnectedBox.style.display = s.printnode_connected ? 'flex' : 'none';
      const printDisconnectBtn = document.getElementById('printnode-disconnect-btn');
      if (printDisconnectBtn) printDisconnectBtn.style.display = s.printnode_connected ? 'inline-flex' : 'none';
      const printerSelect = document.getElementById('printnode-printer-id');
      if (printerSelect && s.printnode_printer_id) {
        printerSelect.dataset.savedId = s.printnode_printer_id;
        // Pré-preenche opção salva para mostrar ao usuário que já há impressora configurada
        const existingOpt = printerSelect.querySelector(`option[value="${s.printnode_printer_id}"]`);
        if (!existingOpt) {
          const opt = document.createElement('option');
          opt.value = s.printnode_printer_id;
          opt.textContent = `Impressora configurada (ID: ${s.printnode_printer_id})`;
          opt.selected = true;
          printerSelect.appendChild(opt);
        }
      }

      // Meta Conversions API (CAPI) Load
      const badgeCapi = document.getElementById('badge-meta-capi');
      const capiFields = document.getElementById('meta-capi-fields');
      const capiNotAvailable = document.getElementById('meta-capi-not-available');
      
      const capiConfigRes = await apiFetch('/api/meta-capi/config');
      if (capiConfigRes.ok) {
        const capiConfig = await capiConfigRes.json();
        if (capiFields) capiFields.style.display = 'block';
        if (capiNotAvailable) capiNotAvailable.style.display = 'none';

        document.getElementById('capi_enabled').checked = capiConfig.capi_enabled;
        document.getElementById('capi_pixel_id').value = capiConfig.capi_pixel_id || '';
        document.getElementById('capi_test_code').value = capiConfig.capi_test_code || '';
        document.getElementById('capi_graph_version').value = capiConfig.capi_graph_version || 'v21.0';

        const tokenHint = document.getElementById('capi_token_hint');
        if (capiConfig.has_access_token) {
          document.getElementById('capi_access_token').placeholder = '••••••••••••••••••••••••';
          if (tokenHint) tokenHint.style.display = 'block';
        } else {
          document.getElementById('capi_access_token').placeholder = 'ex: EAABw...';
          if (tokenHint) tokenHint.style.display = 'none';
        }

        if (badgeCapi) {
          badgeCapi.textContent = capiConfig.capi_enabled ? 'Ativo' : 'Inativo';
          badgeCapi.className = capiConfig.capi_enabled ? 'badge badge-success text-xs' : 'badge badge-gray text-xs';
        }

        // CAPI Status
        const statusBox = document.getElementById('meta-capi-status-box');
        const statusRes = await apiFetch('/api/meta-capi/status');
        if (statusRes.ok && statusBox) {
          const stats = await statusRes.json();
          statusBox.style.display = 'block';
          document.getElementById('capi-status-success-24h').textContent = stats.success_24h || '0';
          document.getElementById('capi-status-pending').textContent = stats.pending_jobs || '0';

          const lastCompletedEl = document.getElementById('capi-status-last-completed');
          if (stats.last_completed) {
            lastCompletedEl.textContent = fmtDateTime(stats.last_completed.completed_at);
          } else {
            lastCompletedEl.textContent = 'Nenhum envio recente';
          }

          const lastErrorEl = document.getElementById('capi-status-last-error');
          const lastErrorRow = document.getElementById('capi-status-last-error-row');
          if (stats.last_error && lastErrorRow && lastErrorEl) {
            lastErrorRow.style.display = 'block';
            lastErrorEl.textContent = `${fmtDateTime(stats.last_error.created_at)}: ${stats.last_error.code} - ${stats.last_error.summary}`;
          } else if (lastErrorRow) {
            lastErrorRow.style.display = 'none';
          }
        }
      } else {
        if (capiFields) capiFields.style.display = 'none';
        if (capiNotAvailable) {
          capiNotAvailable.style.display = 'block';
          capiNotAvailable.textContent = 'Não disponível no seu plano atual. Faça upgrade para o plano Elite ou Especial.';
        }
        if (badgeCapi) {
          badgeCapi.textContent = 'Indisponível';
          badgeCapi.className = 'badge badge-gray text-xs';
        }
      }

    } catch (err) {
      console.error('[integrations] load', err);
      window.Toast?.show('Erro ao carregar integrações', 'error');
    }
  }

  loadIntegrations();

  // ── Saúde do WhatsApp (Central da Meta) ────────────────────────────────────
  const HEALTH_STATUS_LABEL = {
    healthy: ['Saudável', 'badge-success'],
    warning: ['Atenção', 'badge-warning'],
    critical: ['Com problema', 'badge-danger'],
    unknown: ['Não foi possível verificar', 'badge-gray'],
    not_configured: ['Não configurado', 'badge-gray'],
  };
  const HEALTH_STATUS_SUBTITLE = {
    healthy: 'Tudo certo — o WhatsApp está respondendo normalmente.',
    warning: 'A conexão funciona, mas há algo pedindo atenção.',
    critical: 'Há um problema que pode afetar o atendimento.',
    unknown: 'Ainda não conseguimos confirmar o estado da conexão.',
    not_configured: 'O WhatsApp ainda não foi configurado para esta conta.',
  };
  const ISSUE_HELP = {
    token_invalid: 'Toque em "Reconectar WhatsApp" ou fale com o suporte para renovar o acesso.',
    quality_red: 'Evite envios em massa por alguns dias e responda rápido aos clientes — a qualidade se recupera com boas conversas.',
    quality_yellow: 'Reduza mensagens não solicitadas e priorize responder quem chamou primeiro.',
    rate_limited: 'Nenhuma ação necessária — aguarde alguns minutos antes de verificar de novo.',
    meta_unavailable: 'Nenhuma ação necessária — o problema é na Meta, não na sua conta.',
    api_error: 'Se persistir, toque em "Reconectar WhatsApp" ou fale com o suporte.',
    recent_send_error: 'Verifique se o número do cliente é válido. Envios são retentados automaticamente.',
    not_configured: 'Use o link de atendimento da plataforma ou conecte um número próprio.',
    timeout: 'Nenhuma ação necessária — tentaremos de novo automaticamente.',
    network: 'Nenhuma ação necessária — tentaremos de novo automaticamente.',
  };

  function fmtDateTime(iso) {
    if (!iso) return 'Nunca';
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
  }

  function renderMetaHealth(h) {
    const badge = document.getElementById('meta-health-badge');
    const subtitle = document.getElementById('meta-health-subtitle');
    const skeleton = document.getElementById('meta-health-skeleton');
    const issuesEl = document.getElementById('meta-health-issues');
    const grid = document.getElementById('meta-health-grid');
    const checkedAt = document.getElementById('meta-health-checked-at');
    const reconnectBtn = document.getElementById('meta-health-reconnect-btn');
    if (!badge) return;

    const [lbl, cls] = HEALTH_STATUS_LABEL[h.status] || HEALTH_STATUS_LABEL.unknown;
    badge.textContent = lbl;
    badge.className = `badge ${cls}`;
    if (subtitle) subtitle.textContent = HEALTH_STATUS_SUBTITLE[h.status] || '';
    if (skeleton) skeleton.style.display = 'none';

    if (issuesEl) {
      const issues = h.issues || [];
      issuesEl.style.display = issues.length ? 'flex' : 'none';
      issuesEl.innerHTML = issues.map((issue) => `
        <div style="padding:10px 12px; background:var(--warning-50, #fffbeb); border:1px solid var(--warning-200, #fde68a); border-radius:8px; font-size:0.85rem;">
          <div style="font-weight:600;">${esc(issue.message)}</div>
          ${ISSUE_HELP[issue.code] ? `<div style="color:var(--text-secondary); margin-top:2px;">${esc(ISSUE_HELP[issue.code])}</div>` : ''}
        </div>
      `).join('');
    }

    if (grid) {
      const tpl = h.templates || {};
      const tplStr = tpl.approved == null
        ? 'Sem informação da Meta'
        : `${tpl.approved} aprovado(s) · ${tpl.pending ?? 0} pendente(s) · ${tpl.rejected ?? 0} rejeitado(s)`;
      const rows = [
        ['Número conectado', h.phone?.display_phone_number || '—'],
        ['Nome verificado', h.phone?.verified_name || '—'],
        ['Identificador do número', h.phone?.phone_number_id_masked || '—'],
        ['Qualidade do número', h.phone?.quality_rating || 'Sem informação da Meta'],
        ['Limite de mensagens', h.phone?.messaging_limit || 'Sem informação da Meta'],
        ['Acesso (token)', h.token?.valid === true ? 'Válido' : h.token?.valid === false ? 'Expirado/revogado' : 'Ainda não verificado'],
        ['Última mensagem recebida', fmtDateTime(h.webhook?.last_inbound_at)],
        ['Último envio com sucesso', fmtDateTime(h.outbound?.last_success_at)],
        ['Último erro de envio', h.outbound?.last_error_at ? `${fmtDateTime(h.outbound.last_error_at)} (código ${esc(h.outbound.last_error_code || '—')})` : 'Nenhum'],
        ['Templates', tplStr],
      ];
      grid.style.display = 'grid';
      grid.innerHTML = rows.map(([k, v]) => `
        <div style="padding:8px 0; border-bottom:1px solid var(--border);">
          <div style="font-size:0.75rem; color:var(--text-secondary);">${esc(k)}</div>
          <div style="font-size:0.875rem; font-weight:500;">${esc(v)}</div>
        </div>
      `).join('');
    }

    if (checkedAt) {
      checkedAt.textContent = h.checked_at
        ? `Última verificação: ${fmtDateTime(h.checked_at)}`
        : 'Ainda não verificado — toque em "Verificar conexão agora".';
    }
    // Reconectar só faz sentido para credencial própria com token com problema.
    if (reconnectBtn) {
      const showReconnect = h.source === 'tenant' && h.token?.valid === false;
      reconnectBtn.style.display = showReconnect ? 'inline-flex' : 'none';
      reconnectBtn.href = '/settings.html#whatsapp';
    }
  }

  async function loadMetaHealth() {
    const skeleton = document.getElementById('meta-health-skeleton');
    if (skeleton) {
      skeleton.style.display = 'block';
      window.ZapUI.renderAsyncState(skeleton, {
        state: 'loading',
        title: 'Verificando a conexão…',
        message: 'Consultando número, acesso e entregas recentes.',
        compact: true,
      });
    }
    try {
      const r = await fetch('/api/meta/health');
      if (!r.ok) throw new Error();
      renderMetaHealth(await r.json());
    } catch {
      if (skeleton) {
        window.ZapUI.renderAsyncState(skeleton, {
          state: 'error',
          title: 'Não foi possível verificar a conexão',
          message: 'Isso não altera o funcionamento do WhatsApp. Tente novamente em instantes.',
          actionLabel: 'Tentar novamente',
          onAction: loadMetaHealth,
          compact: true,
        });
      }
    }
  }

  document.getElementById('meta-health-refresh-btn')?.addEventListener('click', loadMetaHealth);
  document.getElementById('meta-health-check-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await apiFetch('/api/meta/health/check', { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        window.Toast?.show(data.error || 'Não foi possível verificar agora.', 'error');
        return;
      }
      renderMetaHealth(data);
      window.Toast?.show('Verificação concluída.', 'success');
    } catch {
      window.Toast?.show('Não foi possível verificar agora.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  loadMetaHealth();

  // ── Notificações no aparelho (Web Push) ────────────────────────────────────
  const PUSH_PREF_IDS = {
    vendas: 'push-pref-vendas',
    atendimento: 'push-pref-atendimento',
    meta: 'push-pref-meta',
    campanhas: 'push-pref-campanhas',
    documentos: 'push-pref-documentos',
    automacoes: 'push-pref-automacoes',
  };

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function getPushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
    ]).catch(() => null);
    if (!reg) return null;
    return reg.pushManager.getSubscription();
  }

  function setPushUiState({ enabled, subscribed }) {
    const badge = document.getElementById('push-status-badge');
    const unavailable = document.getElementById('push-unavailable');
    const controls = document.getElementById('push-controls');
    const enableBtn = document.getElementById('push-enable-btn');
    const disableBtn = document.getElementById('push-disable-btn');
    const prefsEl = document.getElementById('push-preferences');
    if (!badge) return;
    if (!enabled) {
      badge.textContent = 'Indisponível';
      badge.className = 'badge badge-gray text-xs';
      if (unavailable) unavailable.style.display = 'block';
      if (controls) controls.style.display = 'none';
      return;
    }
    if (unavailable) unavailable.style.display = 'none';
    if (controls) controls.style.display = 'block';
    badge.textContent = subscribed ? 'Ativas neste aparelho' : 'Desativadas';
    badge.className = subscribed ? 'badge badge-success text-xs' : 'badge badge-gray text-xs';
    if (enableBtn) enableBtn.style.display = subscribed ? 'none' : 'inline-flex';
    if (disableBtn) disableBtn.style.display = subscribed ? 'inline-flex' : 'none';
    if (prefsEl) prefsEl.style.display = subscribed ? 'flex' : 'none';
  }

  async function loadPushState() {
    try {
      const r = await fetch('/api/push/config');
      if (!r.ok) throw new Error();
      const cfg = await r.json();
      if (!cfg.enabled) {
        setPushUiState({ enabled: false, subscribed: false });
        return;
      }
      const sub = await getPushSubscription().catch(() => null);
      setPushUiState({ enabled: true, subscribed: Boolean(sub) });
      if (sub) {
        const pr = await fetch('/api/push/preferences');
        if (pr.ok) {
          const prefs = await pr.json();
          for (const [key, id] of Object.entries(PUSH_PREF_IDS)) {
            const el = document.getElementById(id);
            if (el) el.checked = Boolean(prefs[key]);
          }
        }
      }
    } catch {
      setPushUiState({ enabled: false, subscribed: false });
    }
  }

  async function loadAlertPreferences() {
    try {
      const response = await fetch('/api/alert-preferences');
      if (!response.ok) return;
      const data = await response.json();
      const phone = document.getElementById('alert-whatsapp-phone');
      if (phone) phone.value = data.whatsapp_phone || '';
      for (const [key, id] of Object.entries(PUSH_PREF_IDS)) {
        const input = document.getElementById(id);
        if (input && typeof data.categories?.[key] === 'boolean') input.checked = data.categories[key];
      }
    } catch { /* a central continua utilizável mesmo se este resumo falhar */ }
  }

  document.getElementById('alert-preferences-save')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const categories = {};
    for (const [key, id] of Object.entries(PUSH_PREF_IDS)) {
      const input = document.getElementById(id);
      if (input) categories[key] = input.checked;
    }
    button.disabled = true;
    try {
      const response = await apiFetch('/api/alert-preferences', {
        method: 'PUT',
        body: JSON.stringify({
          whatsapp_phone: document.getElementById('alert-whatsapp-phone')?.value || '',
          categories,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível salvar.');
      const phone = document.getElementById('alert-whatsapp-phone');
      if (phone) phone.value = data.whatsapp_phone || '';
      window.Toast?.show('Alertas atualizados.', 'success');
    } catch (error) {
      window.Toast?.show(error.message || 'Não foi possível salvar os alertas.', 'error');
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('push-enable-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        window.Toast?.show('Este navegador não suporta notificações.', 'error');
        return;
      }
      const cfgRes = await fetch('/api/push/config');
      const cfg = await cfgRes.json();
      if (!cfg.enabled || !cfg.public_key) {
        window.Toast?.show('Notificações não estão habilitadas nesta instalação.', 'error');
        return;
      }
      // Permissão SÓ aqui, após o clique do usuário.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        window.Toast?.show('Permissão de notificação não concedida.', 'error');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.public_key),
      });
      const r = await apiFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
      if (!r.ok) throw new Error();
      window.Toast?.show('Notificações ativadas neste aparelho! 🎉', 'success');
      await loadPushState();
    } catch {
      window.Toast?.show('Não foi possível ativar as notificações.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('push-disable-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const sub = await getPushSubscription();
      if (sub) {
        await apiFetch('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe().catch(() => {});
      }
      window.Toast?.show('Notificações desativadas neste aparelho.', 'success');
      await loadPushState();
    } catch {
      window.Toast?.show('Não foi possível desativar.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  for (const [key, id] of Object.entries(PUSH_PREF_IDS)) {
    document.getElementById(id)?.addEventListener('change', async () => {
      const prefs = {};
      for (const [k, i] of Object.entries(PUSH_PREF_IDS)) {
        const el = document.getElementById(i);
        if (el) prefs[k] = el.checked;
      }
      try {
        const r = await apiFetch('/api/push/preferences', { method: 'PUT', body: JSON.stringify(prefs) });
        if (!r.ok) throw new Error();
        window.Toast?.show('Preferências salvas.', 'success');
      } catch {
        window.Toast?.show('Não foi possível salvar as preferências.', 'error');
      }
    });
  }

  loadPushState();
  loadAlertPreferences();

  // CAPI: enviar evento de teste
  document.getElementById('meta-capi-test-btn')?.addEventListener('click', async () => {
    const resultEl = document.getElementById('meta-capi-test-result');
    const testCode = document.getElementById('capi_test_code').value.trim();
    if (!testCode) {
      window.Toast?.show('Informe o Código de Evento de Teste da Meta antes de enviar.', 'error');
      document.getElementById('capi_test_code')?.focus();
      return;
    }
    resultEl.textContent = 'Enviando...';
    resultEl.className = 'form-hint text-warning';

    try {
      const res = await apiFetch('/api/meta-capi/test', {
        method: 'POST',
        body: JSON.stringify({ test_code: testCode }),
      });
      const data = await res.json();
      if (res.ok) {
        resultEl.textContent = 'Sucesso! O evento de teste Lead foi disparado.';
        resultEl.className = 'form-hint text-success';
      } else {
        resultEl.textContent = `Erro: ${data.error || 'Falha ao enviar.'}`;
        resultEl.className = 'form-hint text-danger';
      }
    } catch (err) {
      resultEl.textContent = 'Erro de conexão.';
      resultEl.className = 'form-hint text-danger';
    }
  });

  // --- Collapsible Sections Toggle ---
  document.querySelectorAll('.category-card').forEach((card) => {
    card.addEventListener('click', () => {
      const targetId = card.dataset.target;
      const targetEl = document.getElementById(targetId);
      if (!targetEl) return;

      const isHidden = targetEl.style.display === 'none';
      if (isHidden) {
        targetEl.style.display = targetId === 'meta-health-body' ? 'flex' : 'block';
        card.classList.add('expanded');
      } else {
        targetEl.style.display = 'none';
        card.classList.remove('expanded');
      }
    });
  });

  // Essenciais e Agenda ficam abertas por padrão: Calendar não deve ficar
  // escondido atrás de uma categoria recolhida.
  const essCard = document.querySelector('.category-card[data-target="essenciais-body"]');
  const essBody = document.getElementById('essenciais-body');
  if (essCard && essBody) {
    essBody.style.display = 'block';
    essCard.classList.add('expanded');
  }
  const calendarCard = document.querySelector('.category-card[data-target="calendar-body"]');
  const calendarBody = document.getElementById('calendar-body');
  if (calendarCard && calendarBody) {
    calendarBody.style.display = 'block';
    calendarCard.classList.add('expanded');
  }

  // Links vindos da Agenda abrem e destacam diretamente o cartão correto.
  if (location.hash === '#integration-google-calendar') {
    calendarBody?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
