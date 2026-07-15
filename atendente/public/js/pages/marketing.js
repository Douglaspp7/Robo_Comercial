// Javascript file for Marketing Dashboard page
document.addEventListener('DOMContentLoaded', () => {
  let csrfToken = '';
  let linksList = [];
  const domainUrl = window.location.origin;

  // Cache DOM
  const tabLinksBtn = document.getElementById('tabLinksBtn');
  const tabConversionsBtn = document.getElementById('tabConversionsBtn');
  const tabLinksContent = document.getElementById('tabLinksContent');
  const tabConversionsContent = document.getElementById('tabConversionsContent');

  const statsPeriodSelect = document.getElementById('statsPeriodSelect');
  const attributionModelSelect = document.getElementById('attributionModelSelect');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const newLinkBtn = document.getElementById('newLinkBtn');

  // KPIs
  const kpiClicks = document.getElementById('kpiClicks');
  const kpiContacts = document.getElementById('kpiContacts');
  const kpiCheckouts = document.getElementById('kpiCheckouts');
  const kpiSales = document.getElementById('kpiSales');
  const kpiRevenue = document.getElementById('kpiRevenue');

  // Tables
  const linksTableBody = document.getElementById('linksTableBody');
  const conversionsTableBody = document.getElementById('conversionsTableBody');

  // Link Modal
  const linkModal = document.getElementById('linkModal');
  const linkModalClose = document.getElementById('linkModalClose');
  const linkForm = document.getElementById('linkForm');
  const modalTitle = document.getElementById('modalTitle');
  const linkId = document.getElementById('linkId');
  const linkName = document.getElementById('linkName');
  const linkSlug = document.getElementById('linkSlug');
  const linkUrlPreview = document.getElementById('linkUrlPreview');
  const linkSource = document.getElementById('linkSource');
  const linkMedium = document.getElementById('linkMedium');
  const linkCampaign = document.getElementById('linkCampaign');
  const linkContent = document.getElementById('linkContent');
  const linkTerm = document.getElementById('linkTerm');
  const metaCampaignId = document.getElementById('metaCampaignId');
  const metaAdsetId = document.getElementById('metaAdsetId');
  const metaAdId = document.getElementById('metaAdId');
  const linkNotes = document.getElementById('linkNotes');

  // Share Modal
  const shareModal = document.getElementById('shareModal');
  const shareModalClose = document.getElementById('shareModalClose');
  const shareQrCode = document.getElementById('shareQrCode');
  const shareUrl = document.getElementById('shareUrl');
  const copyUrlBtn = document.getElementById('copyUrlBtn');

  // Fetch CSRF Token
  fetch('/api/csrf-token')
    .then(r => r.json())
    .then(data => {
      csrfToken = data.token;
      init();
    })
    .catch(err => {
      console.error('Falha ao obter token CSRF:', err);
      init();
    });

  function init() {
    loadStats();
    loadConversions();

    // Event listeners
    tabLinksBtn.addEventListener('click', () => switchTab('links'));
    tabConversionsBtn.addEventListener('click', () => switchTab('conversions'));
    statsPeriodSelect.addEventListener('change', loadStats);
    attributionModelSelect.addEventListener('change', loadStats);

    newLinkBtn.addEventListener('click', () => openLinkModal());
    linkModalClose.addEventListener('click', closeLinkModal);
    shareModalClose.addEventListener('click', closeShareModal);

    linkSlug.addEventListener('input', () => {
      const slugVal = linkSlug.value.trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '');
      linkUrlPreview.textContent = `${domainUrl}/l/${slugVal}`;
    });

    linkForm.addEventListener('submit', handleFormSubmit);
    exportCsvBtn.addEventListener('click', exportCsv);
    copyUrlBtn.addEventListener('click', copyLinkToClipboard);
  }

  // Switch tabs
  function switchTab(tab) {
    if (tab === 'links') {
      tabLinksBtn.classList.add('active');
      tabConversionsBtn.classList.remove('active');
      tabLinksContent.classList.remove('hidden');
      tabConversionsContent.classList.add('hidden');
    } else {
      tabLinksBtn.classList.remove('active');
      tabConversionsBtn.classList.add('active');
      tabLinksContent.classList.add('hidden');
      tabConversionsContent.classList.remove('hidden');
      loadConversions();
    }
  }

  // Load stats and links
  function loadStats() {
    const period = statsPeriodSelect.value;
    const model = attributionModelSelect.value;

    window.ZapUI.renderAsyncState(linksTableBody, {
      state: 'loading',
      title: 'Carregando links…',
      message: 'Atualizando acessos, contatos e vendas.',
      colspan: 7,
      compact: true,
    });

    kpiClicks.textContent = '...';
    kpiContacts.textContent = '...';
    kpiCheckouts.textContent = '...';
    kpiSales.textContent = '...';
    kpiRevenue.textContent = '...';

    fetch(`/api/marketing/stats?days=${period}&attribution_model=${model}`)
      .then(res => res.json())
      .then(data => {
        linksList = data.stats || [];
        renderLinksTable(linksList);
        calculateKpis(linksList);
      })
      .catch(err => {
        console.error('Erro ao carregar estatísticas:', err);
        window.ZapUI.renderAsyncState(linksTableBody, {
          state: 'error',
          title: 'Não foi possível carregar os links',
          message: 'Os dados não foram alterados. Verifique a conexão e tente novamente.',
          actionLabel: 'Tentar novamente',
          onAction: loadStats,
          colspan: 7,
          compact: true,
        });
      });
  }

  function calculateKpis(stats) {
    let clicks = 0;
    let contacts = 0;
    let checkouts = 0;
    let sales = 0;
    let revenue = 0.0;

    stats.forEach(s => {
      clicks += s.clicks || 0;
      contacts += s.contacts || 0;
      checkouts += s.checkouts || 0;
      sales += s.sales || 0;
      revenue += Number(s.revenue || 0);
    });

    kpiClicks.textContent = clicks.toLocaleString();
    kpiContacts.textContent = contacts.toLocaleString();
    kpiCheckouts.textContent = checkouts.toLocaleString();
    kpiSales.textContent = sales.toLocaleString();
    kpiRevenue.textContent = `R$ ${revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function renderLinksTable(links) {
    if (!links.length) {
      window.ZapUI.renderAsyncState(linksTableBody, {
        state: 'empty',
        title: 'Nenhum link criado ainda',
        message: 'Crie um link para descobrir quais campanhas geram conversas e vendas.',
        colspan: 7,
        compact: true,
      });
      return;
    }

    linksTableBody.innerHTML = '';
    links.forEach(l => {
      const row = document.createElement('tr');
      const checked = l.active ? 'checked' : '';

      row.innerHTML = `
        <td data-label="Link">
          <div style="font-weight:600; color:var(--gray-900);">${escapeHtml(l.name)}</div>
          <div style="font-size:0.75rem; color:var(--gray-500);">${escapeHtml(l.source)} / ${escapeHtml(l.medium)}</div>
        </td>
        <td data-label="Endereço">
          <a href="/l/${l.slug}" target="_blank" class="text-primary" style="font-weight:500;">/l/${escapeHtml(l.slug)}</a>
        </td>
        <td data-label="Campanha">
          <div style="font-size:0.75rem; font-family:monospace; color:var(--gray-600);">
            utm_campaign=${escapeHtml(l.campaign)}<br>
            ${l.content ? `utm_content=${escapeHtml(l.content)}` : ''}
          </div>
        </td>
        <td data-label="Resultados">
          <div style="font-weight:600;">${l.clicks} <span style="font-size:0.8rem; font-weight:normal; color:var(--gray-400);">cliques</span></div>
          <div style="font-size:0.75rem; color:var(--gray-500);">${l.contacts} conversas</div>
        </td>
        <td data-label="Vendas">
          <div style="font-weight:600; color:var(--primary-color);">${l.sales} vendas</div>
          <div style="font-size:0.75rem; color:var(--gray-500);">R$ ${Number(l.revenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </td>
        <td data-label="Status">
          <label style="position:relative; display:inline-block; width:40px; height:20px;">
            <input type="checkbox" class="toggle-active" data-id="${l.id}" ${checked} style="opacity:0; width:0; height:0;">
            <span style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#ccc; transition:0.4s; border-radius:34px;" class="toggle-slider"></span>
          </label>
        </td>
        <td data-label="Ações">
          <div class="marketing-actions-cell">
            <button class="btn btn-icon share-link-btn" data-id="${l.id}" title="Compartilhar / QR Code">
              <i data-lucide="share-2"></i>
            </button>
            <button class="btn btn-icon edit-link-btn" data-id="${l.id}" title="Editar">
              <i data-lucide="edit"></i>
            </button>
            <button class="btn btn-icon duplicate-link-btn" data-id="${l.id}" title="Duplicar">
              <i data-lucide="copy"></i>
            </button>
            <button class="btn btn-icon delete-link-btn text-danger" data-id="${l.id}" title="Excluir">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </td>
      `;

      // Slider style
      const slider = row.querySelector('.toggle-slider');
      const input = row.querySelector('.toggle-active');
      const updateSliderColor = () => {
        if (input.checked) {
          slider.style.backgroundColor = 'var(--primary-color, #4f46e5)';
        } else {
          slider.style.backgroundColor = '#ccc';
        }
      };
      updateSliderColor();
      input.addEventListener('change', updateSliderColor);

      linksTableBody.appendChild(row);
    });

    lucide.createIcons();
    attachTableEvents();
  }

  function attachTableEvents() {
    // Toggle active
    document.querySelectorAll('.toggle-active').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-id');
        fetch(`/api/marketing/links/${id}/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        })
          .then(res => res.json())
          .then(() => loadStats())
          .catch(err => console.error('Erro ao alternar status do link:', err));
      });
    });

    // Share / QR
    document.querySelectorAll('.share-link-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        fetch(`/api/marketing/links/${id}/qr`)
          .then(res => res.json())
          .then(data => {
            shareQrCode.src = data.qrUrl;
            shareUrl.textContent = data.targetUrl;
            openShareModal();
          })
          .catch(err => console.error('Erro ao buscar QR code:', err));
      });
    });

    // Edit
    document.querySelectorAll('.edit-link-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const item = linksList.find(l => l.id === id);
        if (item) openLinkModal(item);
      });
    });

    // Duplicate
    document.querySelectorAll('.duplicate-link-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const confirmed = await window.ZapUI.confirm({
          title: 'Duplicar link de marketing',
          message: 'Uma cópia deste link será criada para você editar.',
          confirmText: 'Duplicar link',
          cancelText: 'Cancelar',
        });
        if (confirmed) {
          fetch(`/api/marketing/links/${id}/duplicate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken }
          })
            .then(res => {
              if (!res.ok) return res.json().then(d => { throw new Error(d.error) });
              return res.json();
            })
            .then(() => loadStats())
            .catch(err => window.Toast?.show(err.message || 'Erro ao duplicar link.', 'error'));
        }
      });
    });

    // Delete
    document.querySelectorAll('.delete-link-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const confirmed = await window.ZapUI.confirm({
          title: 'Excluir link de marketing',
          message: 'O link será excluído permanentemente. Esta ação não pode ser desfeita.',
          confirmText: 'Excluir link',
          cancelText: 'Manter link',
          tone: 'danger',
        });
        if (confirmed) {
          fetch(`/api/marketing/links/${id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken }
          })
            .then(res => res.json())
            .then(() => loadStats())
            .catch(err => console.error('Erro ao excluir link:', err));
        }
      });
    });
  }

  // Load conversions history
  function loadConversions() {
    window.ZapUI.renderAsyncState(conversionsTableBody, {
      state: 'loading',
      title: 'Carregando conversões…',
      message: 'Buscando o histórico mais recente.',
      colspan: 7,
      compact: true,
    });

    fetch('/api/marketing/conversions?limit=50')
      .then(res => res.json())
      .then(data => {
        renderConversionsTable(data.conversions || []);
      })
      .catch(err => {
        console.error('Erro ao carregar conversões:', err);
        window.ZapUI.renderAsyncState(conversionsTableBody, {
          state: 'error',
          title: 'Não foi possível carregar as conversões',
          message: 'Tente novamente para recuperar o histórico.',
          actionLabel: 'Tentar novamente',
          onAction: loadConversions,
          colspan: 7,
          compact: true,
        });
      });
  }

  function renderConversionsTable(conversions) {
    if (!conversions.length) {
      window.ZapUI.renderAsyncState(conversionsTableBody, {
        state: 'empty',
        title: 'Nenhuma conversão registrada ainda',
        message: 'Quando um link gerar uma venda ou contato, o resultado aparecerá aqui.',
        colspan: 7,
        compact: true,
      });
      return;
    }

    conversionsTableBody.innerHTML = '';
    conversions.forEach(c => {
      const row = document.createElement('tr');
      const date = new Date(c.event_time * 1000).toLocaleString('pt-BR');
      const val = c.value_cents != null ? `R$ ${(c.value_cents / 100).toFixed(2)}` : '—';
      
      let statusClass = 'badge-secondary';
      if (c.status === 'completed') statusClass = 'badge-success';
      if (c.status === 'failed') statusClass = 'badge-danger';
      if (c.status === 'pending') statusClass = 'badge-warning';

      row.innerHTML = `
        <td data-label="Data">${date}</td>
        <td data-label="Contato">
          <div style="font-weight:600; color:var(--gray-900);">${escapeHtml(c.contact_name || 'Desconhecido')}</div>
          <div style="font-size:0.75rem; color:var(--gray-500);">${escapeHtml(c.contact_phone)}</div>
        </td>
        <td data-label="Evento"><code style="font-weight:600; color:var(--primary-color);">${escapeHtml(c.event_name)}</code></td>
        <td data-label="Valor"><strong>${val}</strong></td>
        <td data-label="Venda">${c.sale_id ? `<code style="font-size:0.75rem;">${escapeHtml(c.sale_id)}</code>` : '—'}</td>
        <td data-label="Atribuição">${c.marketing_link_id ? `<span class="badge badge-primary">Atribuído</span>` : '<span class="badge">Orgânico / Direto</span>'}</td>
        <td data-label="Status"><span class="badge ${statusClass}">${escapeHtml(c.status)}</span></td>
      `;
      conversionsTableBody.appendChild(row);
    });
  }

  // Modals operations
  function openLinkModal(link = null) {
    linkForm.reset();
    if (link) {
      modalTitle.textContent = 'Editar link de marketing';
      linkId.value = link.id;
      linkName.value = link.name;
      linkSlug.value = link.slug;
      linkSource.value = link.source;
      linkMedium.value = link.medium;
      linkCampaign.value = link.campaign;
      linkContent.value = link.content || '';
      linkTerm.value = link.term || '';
      metaCampaignId.value = link.meta_campaign_id || '';
      metaAdsetId.value = link.meta_adset_id || '';
      metaAdId.value = link.meta_ad_id || '';
      linkNotes.value = link.notes || '';
      linkUrlPreview.textContent = `${domainUrl}/l/${link.slug}`;
    } else {
      modalTitle.textContent = 'Criar link de marketing';
      linkId.value = '';
      linkUrlPreview.textContent = `${domainUrl}/l/...`;
    }
    linkModal.classList.add('active');
  }

  function closeLinkModal() {
    linkModal.classList.remove('active');
  }

  function openShareModal() {
    shareModal.classList.add('active');
  }

  function closeShareModal() {
    shareModal.classList.remove('active');
  }

  function copyLinkToClipboard() {
    navigator.clipboard.writeText(shareUrl.textContent)
      .then(() => {
        const icon = copyUrlBtn.querySelector('i');
        copyUrlBtn.innerHTML = '<i data-lucide="check"></i> Copiado!';
        lucide.createIcons();
        setTimeout(() => {
          copyUrlBtn.innerHTML = '<i data-lucide="copy"></i> Copiar link';
          lucide.createIcons();
        }, 2000);
      })
      .catch(err => console.error('Erro ao copiar link:', err));
  }

  // Submit link creation/editing
  function handleFormSubmit(e) {
    e.preventDefault();
    const id = linkId.value;
    const method = id ? 'PUT' : 'POST';
    const endpoint = id ? `/api/marketing/links/${id}` : '/api/marketing/links';

    const payload = {
      name: linkName.value.trim(),
      slug: linkSlug.value.trim().toLowerCase(),
      source: linkSource.value.trim(),
      medium: linkMedium.value.trim(),
      campaign: linkCampaign.value.trim(),
      content: linkContent.value.trim() || null,
      term: linkTerm.value.trim() || null,
      meta_campaign_id: metaCampaignId.value.trim() || null,
      meta_adset_id: metaAdsetId.value.trim() || null,
      meta_ad_id: metaAdId.value.trim() || null,
      notes: linkNotes.value.trim() || null,
    };

    fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify(payload)
    })
      .then(res => {
        if (!res.ok) return res.json().then(d => { throw new Error(d.error) });
        return res.json();
      })
      .then(() => {
        closeLinkModal();
        loadStats();
      })
      .catch(err => window.Toast?.show(err.message || 'Erro ao salvar link.', 'error'));
  }

  function exportCsv() {
    const period = statsPeriodSelect.value;
    const model = attributionModelSelect.value;
    window.location.href = `/api/marketing/stats/export?days=${period}&attribution_model=${model}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
