/**
 * Settings Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const ui = {
    logoutBtn: document.getElementById('logoutBtn'),
    adminLink: document.getElementById('adminLink'),
    impersonateBar: document.getElementById('impersonateBar'),
    impersonateEmail: document.getElementById('impersonateEmail'),
    stopImpersonateBtn: document.getElementById('stopImpersonateBtn'),
    
    // Core buttons
    saveBtn: document.getElementById('saveBtn'),
    
    // Business
    business_name: document.getElementById('business_name'),
    atendente_name: document.getElementById('atendente_name'),
    descricao: document.getElementById('descricao'),
    tomDeVoz: document.getElementById('tomDeVoz'),
    frete: document.getElementById('frete'),
    notify_phone: document.getElementById('notify_phone'),
    
    // Catalog
    catalog_pdf_url: document.getElementById('catalog_pdf_url'),
    catalogPdfInput: document.getElementById('catalog-pdf-input'),
    catalogUploadLabel: document.getElementById('catalog-upload-label'),
    catalogUploadText: document.getElementById('catalog-upload-text'),
    catalogFileStatus: document.getElementById('catalog-file-status'),
    catalogFileName: document.getElementById('catalog-file-name'),
    catalogFileDate: document.getElementById('catalog-file-date'),
    catalogDeleteBtn: document.getElementById('catalog-delete-btn'),

    // Extra documents
    documentInput: document.getElementById('document-input'),
    documentUploadLabel: document.getElementById('document-upload-label'),
    documentUploadText: document.getElementById('document-upload-text'),
    documentsList: document.getElementById('documents-list'),

    // Lists containers
    produtosList: document.getElementById('produtos'),
    faqsList: document.getElementById('faqs'),
    objecoesList: document.getElementById('objecoes'),
    regrasInput: document.getElementById('regras'),
    respostasList: document.getElementById('respostas_rapidas_list'),
    
    // Adds
    addProdutoBtn: document.getElementById('addProdutoBtn'),
    addFaqBtn: document.getElementById('addFaqBtn'),
    addObjecaoBtn: document.getElementById('addObjecaoBtn'),
    
    // Horario
    horario_ativo: document.getElementById('horario_ativo'),
    horarioFields: document.getElementById('horarioFields'),
    horario_inicio: document.getElementById('horario_inicio'),
    horario_fim: document.getElementById('horario_fim'),
    horario_msg_fora: document.getElementById('horario_msg_fora'),
    
    // Follow up
    followup_ativo: document.getElementById('followup_ativo'),
    followupFields: document.getElementById('followupFields'),
    followup_horas: document.getElementById('followup_horas'),
    followup_mensagem: document.getElementById('followup_mensagem'),
    alerta_sem_resposta_horas: document.getElementById('alerta_sem_resposta_horas'),

    // Resumo diário
    resumo_diario_ativo: document.getElementById('resumo_diario_ativo'),
    resumoDiarioFields: document.getElementById('resumoDiarioFields'),
    resumo_diario_hora: document.getElementById('resumo_diario_hora'),

    // Delivery / restaurante
    delivery_ativo: document.getElementById('delivery_ativo'),
    deliveryFields: document.getElementById('deliveryFields'),
    delivery_taxa_fixa: document.getElementById('delivery_taxa_fixa'),
    delivery_eta_minutos: document.getElementById('delivery_eta_minutos'),
    delivery_raio_km: document.getElementById('delivery_raio_km'),
    delivery_aceita_retirada: document.getElementById('delivery_aceita_retirada'),
    delivery_aceita_mesa: document.getElementById('delivery_aceita_mesa'),

    
    // Respostas
    novaResposta: document.getElementById('novaResposta'),
    addRespostaBtn: document.getElementById('addRespostaBtn'),

    // Nicho
    nicheSelect: document.getElementById('nicheSelect'),
    nicheApplyBtn: document.getElementById('nicheApplyBtn'),
  };

  let _csrfToken = null;
  // Depois da primeira análise profunda, esta nota passa a ser a referência
  // oficial do progresso até que uma nova análise confirme as correções.
  let _officialAnalysis = null;
  let planFeatures = {};
  let features = {};
  let _respostasRapidas = [];
  let metaInfo = {};
  let _hasCatalogFile = false;
  let _catalogPollTimer = null;
  let _catalogProductDocToPrompt = null;
  const _catalogProductPrompted = new Set();
  // Estado do Bling — usado nos cards de produto para mostrar alerta suave
  // quando o Bling está conectado mas o SKU do produto está vazio (sem SKU
  // o Bling não sincroniza estoque nem recebe o pedido pago automaticamente).
  let _blingConnected = false;

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

  // Bind accordions
  document.querySelectorAll('.accordion-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const acc = hdr.parentElement;
      acc.classList.toggle('open');
    });
  });

  const businessSection = document.getElementById('business-section');
  const businessInlinePanel = document.getElementById('business-inline-panel');
  if (businessSection && businessInlinePanel) {
    businessSection.classList.add('embedded-in-step');
    businessSection.classList.remove('open');
    businessInlinePanel.appendChild(businessSection);
  }
  const productsSection = document.getElementById('products-section');
  const productsInlinePanel = document.getElementById('products-inline-panel');
  if (productsSection && productsInlinePanel) {
    productsSection.classList.add('embedded-in-step');
    productsSection.classList.remove('open');
    productsInlinePanel.appendChild(productsSection);
  }
  const iaConfigSection = document.getElementById('ia-config-section');
  const iaConfigInlinePanel = document.getElementById('ia-config-inline-panel');
  if (iaConfigSection && iaConfigInlinePanel) {
    iaConfigSection.classList.add('embedded-in-step');
    iaConfigSection.classList.remove('open');
    iaConfigInlinePanel.appendChild(iaConfigSection);
  }

  document.querySelectorAll('.setup-toggle-section').forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = document.getElementById(btn.dataset.targetSection);
      if (!section) return;
      const isOpen = section.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  document.querySelectorAll('[data-settings-target]').forEach((control) => {
    control.addEventListener('click', () => {
      const target = document.getElementById(control.dataset.settingsTarget);
      if (!target) return;

      if (target.tagName === 'DETAILS') target.open = true;
      if (target.classList.contains('accordion')) target.classList.add('open');

      const stepCard = target.closest('.setup-step-card');
      const stepToggle = stepCard?.querySelector('.setup-toggle-section');
      if (stepToggle) stepToggle.setAttribute('aria-expanded', 'true');

      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });


  document.querySelectorAll('.step-jump').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      const accordion = target.closest('.accordion');
      if (accordion) accordion.classList.add('open');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (typeof target.focus === 'function') setTimeout(() => target.focus(), 350);
    });
  });


  function getIaConfigState() {
    const nomeOk = (ui.atendente_name?.value || '').trim().length > 0;
    const tomOk  = (ui.tomDeVoz?.value || '').trim().length > 0;
    return { nomeOk, tomOk, iaConfigOk: nomeOk && tomOk };
  }

  document.getElementById('setup-copy-wa')?.addEventListener('click', () => {
    document.getElementById('wa-link-copy-btn')?.click();
  });

  function updateConnectionBlock(blockId, status, badgeText) {
    const block = document.getElementById(blockId);
    if (!block) return;
    block.classList.toggle('is-ready', status === 'ready');
    block.classList.toggle('is-pending', status === 'pending');
    block.classList.toggle('is-manual', status === 'manual');
    const badge = block.querySelector('.connection-status');
    if (badge) badge.innerHTML = '<span class="connection-status-dot"></span>' + badgeText;
  }


  // Items factory
  function makeItem(container, fields, values = {}, title = null) {
    const div = document.createElement('div');
    div.className = 'dynamic-item';

    const header = document.createElement('div');
    header.className = 'dynamic-item-header';
    header.innerHTML = `
      <div class="dynamic-item-title">${title || fields[0].label}</div>
      <button class="btn-remove-item" title="Remover"><i data-lucide="trash-2"></i></button>
    `;
    
    const removeBtn = header.querySelector('.btn-remove-item');
    removeBtn.addEventListener('click', () => {
      div.remove();
      refreshBadges();
    });
    
    div.appendChild(header);
    
    fields.forEach(f => {
      const formGroup = document.createElement('div');
      formGroup.className = 'form-group mb-2';
      
      const lbl = document.createElement('label');
      lbl.className = 'form-label';
      lbl.textContent = f.label;
      formGroup.appendChild(lbl);
      
      const v = (values[f.key] ?? '').toString().replace(/"/g, '&quot;');
      let el;
      if(f.textarea) {
        el = document.createElement('textarea');
        el.className = 'form-textarea';
        el.dataset.key = f.key;
        el.placeholder = f.ph;
        el.value = (values[f.key] ?? '');
      } else {
        el = document.createElement('input');
        el.className = 'form-input';
        el.dataset.key = f.key;
        el.placeholder = f.ph;
        el.value = v;
      }
      formGroup.appendChild(el);
      div.appendChild(formGroup);
    });
    
    container.appendChild(div);
    if(window.lucide) window.lucide.createIcons({root: div});
    return div;
  }

  // Re-avalia o alerta de SKU/Bling em todos os cards de produto renderizados.
  // Chamada quando _blingConnected muda (backend retornou nova config Bling).
  function refreshProductBlingAlerts() {
    if (!ui.produtosList) return;
    ui.produtosList.querySelectorAll('.dynamic-item').forEach((item) => {
      if (typeof item.__syncBlingAlert === 'function') item.__syncBlingAlert();
    });
  }

  function addProduto(v = {}, openEditor = false) {
    const div = document.createElement('div');
    div.className = 'dynamic-item product-summary-item';
    if (openEditor || !v.nome) div.classList.add('editing');

    // Header
    const header = document.createElement('div');
    header.className = 'dynamic-item-header';
    header.innerHTML = `
      <div class="dynamic-item-title">${v.nome || 'Novo Produto'}</div>
      <div class="product-summary-actions">
        <button type="button" class="btn-edit-item" title="Editar produto" aria-label="Editar produto"><i data-lucide="pencil"></i></button>
        <button type="button" class="btn-remove-item" title="Remover"><i data-lucide="trash-2"></i></button>
      </div>
    `;
    header.querySelector('.btn-edit-item').addEventListener('click', () => {
      const shouldOpen = !div.classList.contains('editing');
      ui.produtosList?.querySelectorAll('.product-summary-item.editing').forEach((item) => {
        if (item !== div) item.classList.remove('editing');
      });
      div.classList.toggle('editing', shouldOpen);
    });
    header.querySelector('.btn-remove-item').addEventListener('click', () => {
      div.remove();
      refreshBadges();
      updateProgress();
    });
    div.appendChild(header);
    const editPanel = document.createElement('div');
    editPanel.className = 'product-edit-panel';

    // Basic Fields
    const fieldsDiv = document.createElement('div');
    fieldsDiv.className = 'grid grid-cols-1 md:grid-cols-2 gap-4';
    
    const makeField = (key, label, ph, isTextarea = false, type = 'text') => {
      const g = document.createElement('div');
      g.className = 'form-group mb-2';
      g.innerHTML = `<label class="form-label">${label}</label>`;
      const el = document.createElement(isTextarea ? 'textarea' : 'input');
      el.className = isTextarea ? 'form-textarea' : 'form-input';
      if (!isTextarea) el.type = type;
      el.dataset.pkey = key;
      el.dataset.key = key;
      el.placeholder = ph;
      el.value = v[key] || '';
      el.addEventListener('input', updateProgress);
      g.appendChild(el);
      return g;
    };

    const nameField = makeField('nome', 'Nome do produto', 'Ex: Hambúrguer Artesanal');
    const nameInput = nameField.querySelector('input');
    nameInput.addEventListener('input', () => {
      header.querySelector('.dynamic-item-title').textContent = nameInput.value.trim() || 'Produto';
      updateProgress();
    });
    
    const descField = makeField('descricao', 'Descrição curta (opcional)', 'Benefício principal...', true);
    descField.className = 'form-group mb-2 md:col-span-2';

    // tipo_produto select
    const tipoField = document.createElement('div');
    tipoField.className = 'form-group mb-2 md:col-span-2';
    tipoField.innerHTML = `
      <label class="form-label">Tipo de produto</label>
      <select class="form-input" data-pkey="tipo_produto">
        <option value="simples"${(!v.tipo_produto || v.tipo_produto === 'simples') ? ' selected' : ''}>Produto simples (preço único)</option>
        <option value="pizza"${v.tipo_produto === 'pizza' ? ' selected' : ''}>Pizza / Meia a meia (tamanhos + sabores)</option>
        <option value="porcao"${v.tipo_produto === 'porcao' ? ' selected' : ''}>Porção / Combo (tem tamanhos)</option>
      </select>
    `;
    const tipoProdutoSelect = tipoField.querySelector('select');

    const precoField = makeField('preco', 'Preço', 'Ex: 29.90 (ou sob consulta)');

    // montagem section (tamanhos, meia a meia, adicionais)
    const montagemSection = document.createElement('div');
    montagemSection.className = 'md:col-span-2 mt-1 border-t border-gray-200 pt-3';
    montagemSection.innerHTML = `
      <div class="font-medium text-gray-900 mb-2">Tamanhos e montagem</div>
      <table class="w-full mb-2 text-sm">
        <thead><tr class="text-left text-gray-500 text-xs"><th class="pb-1 pr-2">Tamanho</th><th class="pb-1 pr-2">Preço (R$)</th><th></th></tr></thead>
        <tbody class="tamanhos-list"></tbody>
      </table>
      <button type="button" class="btn btn-secondary text-sm py-1 px-2 add-tamanho-btn"><i data-lucide="plus"></i> Adicionar tamanho</button>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pizza-only-fields">
        <div class="form-group mb-0">
          <label class="form-label">Máx. sabores (meia a meia)</label>
          <select class="form-input" data-pkey="max_sabores">
            <option value="1"${(v.max_sabores == null || v.max_sabores == 1) ? ' selected' : ''}>1 sabor (sem meia a meia)</option>
            <option value="2"${v.max_sabores == 2 ? ' selected' : ''}>2 sabores (meia a meia)</option>
          </select>
        </div>
      </div>
      <div class="form-group mt-3 mb-0">
        <label class="form-label">Adicionais disponíveis</label>
        <input type="text" class="form-input" data-pkey="adicionais" placeholder="Ex: Borda de catupiry, Extra queijo" value="${esc(v.adicionais)}">
        <div class="form-hint">Separados por vírgula. A IA oferece no momento da confirmação do pedido.</div>
      </div>
    `;

    const tamanhosList = montagemSection.querySelector('.tamanhos-list');
    const addTamanhoRow = (t = {}) => {
      const tr = document.createElement('tr');
      tr.className = 'tamanho-row';
      tr.innerHTML = `
        <td class="pr-2 pb-1"><input type="text" class="form-input t-nome" placeholder="Ex: G" value="${esc(t.nome)}"></td>
        <td class="pr-2 pb-1"><input type="text" class="form-input t-preco" placeholder="Ex: 45.90" value="${esc(t.preco)}"></td>
        <td class="pb-1"><button type="button" class="btn btn-icon text-danger"><i data-lucide="trash-2"></i></button></td>
      `;
      tr.querySelector('button').addEventListener('click', () => tr.remove());
      tamanhosList.appendChild(tr);
      if (window.lucide) window.lucide.createIcons({ root: tr });
    };
    if (Array.isArray(v.tamanhos)) v.tamanhos.forEach(addTamanhoRow);
    montagemSection.querySelector('.add-tamanho-btn').addEventListener('click', () => addTamanhoRow());

    const syncTipoProduto = () => {
      const tipo = tipoProdutoSelect.value;
      const hasTamanhos = tipo === 'pizza' || tipo === 'porcao';
      precoField.style.display = hasTamanhos ? 'none' : '';
      montagemSection.style.display = hasTamanhos ? '' : 'none';
      const pizzaOnly = montagemSection.querySelector('.pizza-only-fields');
      if (pizzaOnly) pizzaOnly.style.display = tipo === 'pizza' ? '' : 'none';
    };
    tipoProdutoSelect.addEventListener('change', syncTipoProduto);

    fieldsDiv.appendChild(nameField);
    // SKU do produto: essencial para casar pedido/estoque com o Bling
    // (renomear o produto no Bling ou no Zapien quebra a reconciliação por
    // nome — o código é a chave estável).
    const skuField = makeField('codigo', 'Código / SKU', 'Ex: SKU-123');
    const skuInput = skuField.querySelector('input');
    const skuHint = document.createElement('div');
    skuHint.className = 'form-hint';
    skuHint.textContent = 'Use o mesmo código cadastrado no Bling. Sem ele, o pedido pago não sincroniza automaticamente.';
    skuField.appendChild(skuHint);
    const blingAlert = document.createElement('div');
    blingAlert.className = 'product-bling-alert';
    blingAlert.setAttribute('role', 'status');
    blingAlert.style.display = 'none';
    blingAlert.innerHTML = '<i data-lucide="alert-triangle"></i><span>Este produto ainda n&atilde;o tem SKU. Com o Bling conectado, ele n&atilde;o vai sincronizar estoque nem receber o pedido pago automaticamente.</span>';
    skuField.appendChild(blingAlert);
    const syncBlingAlert = () => {
      const skuMissing = !(skuInput.value || '').trim();
      blingAlert.style.display = (_blingConnected && skuMissing) ? 'flex' : 'none';
    };
    skuInput.addEventListener('input', syncBlingAlert);
    // Guarda referência no card p/ atualizar quando o Bling reconectar/desconectar
    div.__syncBlingAlert = syncBlingAlert;
    setTimeout(syncBlingAlert, 0);
    fieldsDiv.appendChild(skuField);
    fieldsDiv.appendChild(tipoField);
    fieldsDiv.appendChild(precoField);
    fieldsDiv.appendChild(descField);
    fieldsDiv.appendChild(makeField('imagem_url', 'Imagem do produto ou URL da imagem', 'https://...'));
    fieldsDiv.appendChild(montagemSection);

    const advancedFields = document.createElement('details');
    advancedFields.className = 'product-advanced md:col-span-2';
    advancedFields.innerHTML = '<summary>Opções avançadas do produto</summary><div class="product-advanced-grid grid grid-cols-1 md:grid-cols-2 gap-4"></div>';
    const advancedGrid = advancedFields.querySelector('.product-advanced-grid');
    advancedGrid.appendChild(makeField('descricao_detalhada', 'Descrição detalhada', 'Detalhes extras para a IA consultar...', true));
    advancedGrid.appendChild(makeField('checkout_url', 'Link checkout próprio do produto', 'Link direto do Mercado Pago, etc.'));
    advancedGrid.appendChild(makeField('ciclo_dias', 'Ciclo de recompra', 'Ex: 30 — deixe vazio se não for consumível', false, 'number'));
    advancedGrid.appendChild(makeField('diferenciais', 'Diferenciais', 'Separe por vírgula'));

    // Produto digital: entregue por link (ebook, curso, receita, videoaula
    // etc.), sem frete. A IA não pergunta CEP para esse produto, e o link
    // é enviado automaticamente pelo sistema assim que o pagamento é
    // confirmado (Mercado Pago) — a IA nunca escreve o link ela mesma.
    const digitalGroup = document.createElement('div');
    digitalGroup.className = 'form-group mb-2 md:col-span-2';
    digitalGroup.innerHTML = `
      <label class="flex items-center gap-2 cursor-pointer" style="margin-bottom:0;">
        <input type="checkbox" data-pkey="digital" class="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" ${v.digital ? 'checked' : ''}>
        <span class="font-medium text-gray-900">Produto digital (sem frete, entrega por link)</span>
      </label>
      <div class="digital-link-field" style="display:none;margin-top:8px;">
        <label class="form-label">Link de entrega</label>
        <input type="text" class="form-input" data-pkey="link_entrega" placeholder="Link do ebook, curso, receita, videoaula... (Google Drive, YouTube, etc.)" value="${esc(v.link_entrega)}">
        <div class="form-hint">Enviado automaticamente pelo WhatsApp assim que o pagamento for confirmado — não precisa fazer nada na hora da venda.</div>
      </div>
    `;
    advancedGrid.appendChild(digitalGroup);

    const digitalInput = digitalGroup.querySelector('[data-pkey="digital"]');
    const digitalLinkField = digitalGroup.querySelector('.digital-link-field');
    const syncDigitalField = () => { digitalLinkField.style.display = digitalInput.checked ? 'block' : 'none'; };
    digitalInput.addEventListener('change', syncDigitalField);
    syncDigitalField();

    // Quantidade em estoque (opcional): quando preenchida, a IA desconta
    // automaticamente a cada venda e o campo "Esgotado" abaixo passa a ser
    // calculado sozinho (some do controle manual).
    const qtyField = makeField('estoque_qtd', 'Quantidade em estoque (opcional)', 'Deixe vazio pra não controlar estoque deste produto', false, 'number');
    advancedGrid.appendChild(qtyField);
    const qtyInput = qtyField.querySelector('input');

    // Esgotado: quando marcado (manual) ou quando a quantidade em estoque
    // chega a 0 (automático), a IA avisa o cliente e oferece lista de espera
    // de reposição — ver "Lista de espera" abaixo (aparece só se houver interessados).
    const stockGroup = document.createElement('div');
    stockGroup.className = 'form-group mb-2 md:col-span-2';
    stockGroup.innerHTML = `
      <label class="flex items-center gap-2 cursor-pointer" style="margin-bottom:0;">
        <input type="checkbox" data-pkey="esgotado" class="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" ${v.esgotado ? 'checked' : ''}>
        <span class="font-medium text-gray-900">Esgotado (fora de estoque no momento)</span>
      </label>
      <div class="form-hint stock-auto-hint" style="display:none;margin-top:4px;">Controlado automaticamente pela quantidade em estoque — a cada venda a IA desconta sozinha.</div>
      <div class="waitlist-info flex items-center gap-2" style="display:none;margin-top:8px;">
        <span class="badge badge-gray waitlist-count"></span>
        <button type="button" class="btn btn-secondary text-sm py-1 px-2 waitlist-notify-btn">Avisar reposição</button>
      </div>
    `;
    advancedGrid.appendChild(stockGroup);
    fieldsDiv.appendChild(advancedFields);
    syncTipoProduto();

    const esgotadoInput = stockGroup.querySelector('[data-pkey="esgotado"]');
    const stockAutoHint = stockGroup.querySelector('.stock-auto-hint');
    const syncStockControl = () => {
      const controlado = qtyInput.value.trim() !== '';
      esgotadoInput.disabled = controlado;
      stockAutoHint.style.display = controlado ? 'block' : 'none';
      if (controlado) esgotadoInput.checked = Number(qtyInput.value) <= 0;
    };
    qtyInput.addEventListener('input', syncStockControl);
    syncStockControl();

    editPanel.appendChild(fieldsDiv);

    // Variations
    const varSection = document.createElement('div');
    varSection.className = 'mt-4 border-t border-gray-200 pt-4';
    varSection.innerHTML = `<div class="font-medium text-gray-900 mb-2">Variações (Tamanhos, Sabores, etc)</div><div class="variations-list grid gap-2 mb-2"></div>`;
    
    const varList = varSection.querySelector('.variations-list');
    
    const addVariationRow = (varData = {}) => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2 variation-row flex-wrap';
      row.innerHTML = `
        <input type="text" class="form-input flex-1 min-w-[150px] v-nome" placeholder="Nome (Ex: G)" value="${esc(varData.nome)}">
        <input type="text" class="form-input w-24 v-preco" placeholder="R$ +0,00" value="${esc(varData.preco)}">
        <input type="text" class="form-input flex-1 min-w-[150px] v-img" placeholder="Imagem URL" value="${esc(varData.imagem_url)}">
        <button type="button" class="btn btn-icon text-danger"><i data-lucide="trash-2"></i></button>
      `;
      row.querySelector('button').addEventListener('click', () => row.remove());
      varList.appendChild(row);
      if(window.lucide) window.lucide.createIcons({root: row});
    };

    if (Array.isArray(v.variacoes_estr)) {
      v.variacoes_estr.forEach(addVariationRow);
    } else if (typeof v.variacoes === 'string' && v.variacoes.trim()) {
      v.variacoes.split(',').forEach(vn => addVariationRow({ nome: vn.trim() }));
    }

    const btnAddVar = document.createElement('button');
    btnAddVar.type = 'button';
    btnAddVar.className = 'btn btn-secondary text-sm py-1 px-2';
    btnAddVar.innerHTML = '<i data-lucide="plus"></i> Adicionar Variação';
    btnAddVar.addEventListener('click', () => addVariationRow());
    varSection.appendChild(btnAddVar);

    advancedGrid.appendChild(varSection);
    div.appendChild(editPanel);

    ui.produtosList.appendChild(div);
    if (div.classList.contains('editing')) {
      ui.produtosList.querySelectorAll('.product-summary-item.editing').forEach((item) => {
        if (item !== div) item.classList.remove('editing');
      });
    }
    if(window.lucide) window.lucide.createIcons({root: div});
    refreshBadges();
  }

  function addFaq(v = {}) {
    makeItem(ui.faqsList, [
      { key: 'pergunta', label: 'Pergunta', ph: 'Qual o prazo de entrega?' },
      { key: 'resposta', label: 'Resposta', ph: 'De 3 a 7 dias úteis.', textarea: true },
    ], v);
    refreshBadges();
  }

  function addObjecao(v = {}) {
    makeItem(ui.objecoesList, [
      { key: 'objecao',  label: 'Objeção',         ph: 'Está caro' },
      { key: 'resposta', label: 'Como responder',   ph: 'Reforce o valor, sem pressionar.', textarea: true },
    ], v);
    refreshBadges();
  }

  if(ui.addProdutoBtn) ui.addProdutoBtn.addEventListener('click', () => addProduto({}, true));

  const productPathPdf = document.getElementById('product-path-pdf');
  const productPathLink = document.getElementById('product-path-link');
  const productPathManual = document.getElementById('product-path-manual');
  if (productPathPdf) productPathPdf.addEventListener('click', () => document.getElementById('catalog-pdf-input')?.click());
  if (productPathLink) productPathLink.addEventListener('click', () => {
    ui.catalog_pdf_url?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => ui.catalog_pdf_url?.focus(), 250);
  });
  if (productPathManual) productPathManual.addEventListener('click', () => {
    if (!ui.produtos?.children.length) addProduto({}, true);
    document.getElementById('produtos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  if(ui.addFaqBtn) ui.addFaqBtn.addEventListener('click', () => addFaq());
  if(ui.addObjecaoBtn) ui.addObjecaoBtn.addEventListener('click', () => addObjecao());

  // ── Configuração da loja por voz ───────────────────────────────────────────
  const voice = {
    start: document.getElementById('voice-intake-start'),
    hint: document.getElementById('voice-hold-hint'),
    timer: document.getElementById('voice-intake-timer'),
    upload: document.getElementById('voice-intake-upload'),
    file: document.getElementById('voice-intake-file'),
    error: document.getElementById('voice-intake-error'),
    modal: document.getElementById('voice-review-modal'),
    close: document.getElementById('voice-review-close'),
    transcript: document.getElementById('voice-review-transcript'),
    descricao: document.getElementById('voice-review-descricao'),
    atendente: document.getElementById('voice-review-atendente'),
    tom: document.getElementById('voice-review-tom'),
    frete: document.getElementById('voice-review-frete'),
    faqs: document.getElementById('voice-review-faqs'),
    objecoes: document.getElementById('voice-review-objecoes'),
    produtos: document.getElementById('voice-review-produtos'),
    use: document.getElementById('voice-review-use'),
    edit: document.getElementById('voice-review-edit'),
    discard: document.getElementById('voice-review-discard'),
  };
  let voiceRecorder = null;
  let voiceChunks = [];
  let voiceTimerId = null;
  let voiceStartedAt = 0;
  let voiceReviewData = null;
  let voiceCancelled = false;
  let voiceHolding = false;

  function setVoiceError(message = '') {
    if (!voice.error) return;
    voice.error.textContent = message;
    voice.error.hidden = !message;
  }

  function formatVoiceSeconds(total) {
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function setVoiceBusy(label, busy = true) {
    if (voice.hint) voice.hint.textContent = label;
    if (voice.start) { voice.start.disabled = busy; voice.start.classList.toggle('processing', busy); }
    if (voice.upload) voice.upload.disabled = busy;
  }

  function resetVoiceRecordingUI() {
    clearInterval(voiceTimerId);
    voiceTimerId = null;
    voiceStartedAt = 0;
    if (voice.timer) voice.timer.textContent = '';
    if (voice.hint) voice.hint.textContent = 'Segure para gravar';
    if (voice.start) { voice.start.disabled = false; voice.start.classList.remove('recording', 'processing'); }
    if (voice.upload) voice.upload.disabled = false;
  }

  function startVoiceTimer() {
    voiceStartedAt = Date.now();
    clearInterval(voiceTimerId);
    voiceTimerId = setInterval(() => {
      const seconds = Math.floor((Date.now() - voiceStartedAt) / 1000);
      if (voice.timer) voice.timer.textContent = formatVoiceSeconds(seconds);
      if (seconds >= 60 && voiceRecorder?.state === 'recording') voiceRecorder.stop();
    }, 250);
  }

  async function submitVoiceAudio(blob) {
    setVoiceBusy('Transcrevendo áudio…');
    setVoiceError('');
    const form = new FormData();
    const ext = blob.type.includes('webm') ? 'webm' : blob.type.includes('wav') ? 'wav' : blob.type.includes('mp4') ? 'm4a' : 'mp3';
    form.append('audio', blob, `minha-loja.${ext}`);

    let organizeTimer = null;
    try {
      organizeTimer = setTimeout(() => setVoiceBusy('Organizando informações da sua loja…'), 2500);
      const token = await getCsrfToken();
      const res = await fetch('/api/settings/voice-intake', {
        method: 'POST',
        headers: { 'X-CSRF-Token': token },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não consegui transcrever o áudio. Tente novamente ou preencha manualmente.');
      openVoiceReview(data);
      window.Toast?.show('Áudio organizado. Revise antes de usar.', 'success');
    } catch (err) {
      setVoiceError(err.message || 'Não consegui transcrever o áudio. Tente novamente ou preencha manualmente.');
      window.Toast?.show('Não consegui transcrever o áudio. Tente novamente ou preencha manualmente.', 'error');
    } finally {
      clearTimeout(organizeTimer);
      resetVoiceRecordingUI();
    }
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Seu navegador não permite gravação de áudio aqui. Você ainda pode preencher manualmente ou enviar um áudio gravado.');
      voice.file?.click();
      return;
    }
    try {
      setVoiceError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceChunks = [];
      voiceCancelled = false;
      voiceRecorder = new MediaRecorder(stream);
      voiceRecorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) voiceChunks.push(event.data);
      });
      voiceRecorder.addEventListener('stop', () => {
        stream.getTracks().forEach((track) => track.stop());
        const type = voiceRecorder?.mimeType || 'audio/webm';
        const blob = new Blob(voiceChunks, { type });
        voiceChunks = [];
        if (voiceCancelled) { resetVoiceRecordingUI(); return; }
        if (blob.size) submitVoiceAudio(blob);
        else resetVoiceRecordingUI();
      }, { once: true });
      voiceRecorder.start();
      if (voice.start) voice.start.classList.add('recording');
      if (voice.hint) voice.hint.textContent = 'Solte para enviar';
      if (voice.upload) voice.upload.disabled = true;
      startVoiceTimer();
      if (!voiceHolding) voiceRecorder.stop();
    } catch (err) {
      setVoiceError('Não consegui acessar o microfone. Verifique a permissão do navegador ou envie um áudio gravado.');
      resetVoiceRecordingUI();
    }
  }

  function cancelVoiceRecording() {
    voiceCancelled = true;
    if (voiceRecorder?.state === 'recording') {
      voiceRecorder.stop();
      voiceRecorder.stream?.getTracks().forEach((track) => track.stop());
    }
    voiceChunks = [];
    resetVoiceRecordingUI();
  }

  function suggestionCheckbox(group, index, label, text) {
    return `
      <label class="voice-suggestion-item">
        <input type="checkbox" data-voice-group="${group}" data-voice-index="${index}">
        <span><strong>${esc(label)}</strong>${text ? `<small>${esc(text)}</small>` : ''}</span>
      </label>
    `;
  }

  function renderVoiceSuggestions(target, title, items, group, labelFn, textFn) {
    if (!target) return;
    if (!items?.length) { target.innerHTML = ''; return; }
    target.innerHTML = `
      <h4>${title}</h4>
      ${items.map((item, index) => suggestionCheckbox(group, index, labelFn(item), textFn(item))).join('')}
    `;
  }

  function openVoiceReview(data) {
    voiceReviewData = data || {};
    const suggested = voiceReviewData.suggested || {};
    if (voice.transcript) voice.transcript.textContent = voiceReviewData.transcript || '';
    if (voice.descricao) voice.descricao.value = suggested.descricao || ui.descricao?.value || '';
    if (voice.atendente) voice.atendente.value = suggested.atendente_name || ui.atendente_name?.value || 'Ana';
    if (voice.tom) voice.tom.value = suggested.tomDeVoz || ui.tomDeVoz?.value || 'Amigável, direto e profissional, como uma conversa de WhatsApp.';
    if (voice.frete) voice.frete.value = suggested.frete || ui.frete?.value || '';
    renderVoiceSuggestions(voice.faqs, 'Perguntas frequentes sugeridas', suggested.faqs, 'faqs', (f) => f.pergunta, (f) => f.resposta);
    renderVoiceSuggestions(voice.objecoes, 'Objeções sugeridas', suggested.objecoes, 'objecoes', (o) => o.objecao, (o) => o.resposta);
    renderVoiceSuggestions(voice.produtos, 'Produtos mencionados', suggested.produtos, 'produtos', (p) => p.nome, (p) => [p.preco, p.descricao].filter(Boolean).join(' • '));
    if (voice.modal) voice.modal.hidden = false;
    document.body.classList.add('modal-open');
    if (window.lucide) window.lucide.createIcons({ root: voice.modal });
  }

  function closeVoiceReview() {
    if (voice.modal) voice.modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function applyVoiceReview() {
    const suggested = voiceReviewData?.suggested || {};
    if (ui.descricao && voice.descricao) ui.descricao.value = voice.descricao.value.trim();
    if (ui.atendente_name && voice.atendente) ui.atendente_name.value = voice.atendente.value.trim() || 'Ana';
    if (ui.tomDeVoz && voice.tom) ui.tomDeVoz.value = voice.tom.value.trim() || 'Amigável, direto e profissional, como uma conversa de WhatsApp.';
    if (ui.frete && voice.frete) ui.frete.value = voice.frete.value.trim();
    voice.modal?.querySelectorAll('[data-voice-group]:checked').forEach((checkbox) => {
      const group = checkbox.dataset.voiceGroup;
      const index = Number(checkbox.dataset.voiceIndex);
      const item = suggested[group]?.[index];
      if (!item) return;
      if (group === 'faqs') addFaq(item);
      if (group === 'objecoes') addObjecao(item);
      if (group === 'produtos') addProduto(item, false);
    });
    refreshBadges();
    updateProgress();
    closeVoiceReview();
    window.Toast?.show('Texto aplicado. Revise e clique em Salvar alterações.', 'success');
  }

  function releaseVoiceHold() {
    if (!voiceHolding) return;
    voiceHolding = false;
    if (voiceRecorder?.state === 'recording') voiceRecorder.stop();
  }

  voice.start?.addEventListener('pointerdown', async (e) => {
    e.preventDefault();
    if (voiceHolding || voice.start?.disabled) return;
    voiceHolding = true;
    await startVoiceRecording();
  });
  voice.start?.addEventListener('pointerup', releaseVoiceHold);
  voice.start?.addEventListener('pointerleave', releaseVoiceHold);
  voice.start?.addEventListener('pointercancel', () => { voiceHolding = false; cancelVoiceRecording(); });
  voice.upload?.addEventListener('click', () => voice.file?.click());
  voice.file?.addEventListener('change', () => {
    const file = voice.file.files?.[0];
    if (file) submitVoiceAudio(file);
    voice.file.value = '';
  });
  voice.close?.addEventListener('click', closeVoiceReview);
  voice.discard?.addEventListener('click', closeVoiceReview);
  voice.edit?.addEventListener('click', () => voice.descricao?.focus());
  voice.use?.addEventListener('click', applyVoiceReview);

  function collect(container) {
    if(!container) return [];
    return [...container.querySelectorAll('.dynamic-item')].map((item) => {
      const obj = {};
      item.querySelectorAll('[data-key]').forEach((el) => { obj[el.dataset.key] = el.value.trim(); });
      return obj;
    }).filter((o) => Object.values(o).some((v) => v));
  }

  function collectProdutos() {
    if(!ui.produtosList) return [];
    return [...ui.produtosList.querySelectorAll('.dynamic-item')].map((item) => {
      const obj = {};
      item.querySelectorAll('[data-pkey]').forEach(el => {
        obj[el.dataset.pkey] = el.type === 'checkbox' ? el.checked : el.value.trim();
      });
      if (obj.max_sabores !== undefined) obj.max_sabores = parseInt(obj.max_sabores, 10) || 1;
      if (typeof obj.diferenciais === 'string') {
        obj.diferenciais = obj.diferenciais.split(',').map((item) => item.trim()).filter(Boolean);
      }
      obj.variacoes_estr = [...item.querySelectorAll('.variation-row')].map(row => {
        return {
          nome: row.querySelector('.v-nome').value.trim(),
          preco: row.querySelector('.v-preco').value.trim(),
          imagem_url: row.querySelector('.v-img').value.trim()
        };
      }).filter(v => v.nome);
      obj.tamanhos = [...item.querySelectorAll('.tamanho-row')].map(row => ({
        nome: row.querySelector('.t-nome').value.trim(),
        preco: row.querySelector('.t-preco').value.trim(),
      })).filter(t => t.nome);
      return obj;
    }).filter(o => o.nome);
  }

  // Lista de espera de reposição: mostra "N esperando" + botão de aviso em
  // cada produto que tenha gente aguardando (a IA já registrou via WhatsApp).
  async function loadWaitlistCounts() {
    if (!ui.produtosList) return;
    try {
      const res = await apiFetch('/api/products/waitlist');
      if (!res.ok) return;
      const counts = await res.json();
      ui.produtosList.querySelectorAll('.dynamic-item').forEach((item) => {
        const nameInput = item.querySelector('[data-pkey="nome"]');
        const info = item.querySelector('.waitlist-info');
        const countEl = item.querySelector('.waitlist-count');
        if (!nameInput || !info || !countEl) return;
        const n = counts[nameInput.value.trim()] || 0;
        countEl.textContent = `${n} esperando reposição`;
        info.style.display = n > 0 ? 'flex' : 'none';
      });
    } catch { /* contagem é só um extra visual — falha silenciosa */ }
  }

  if (ui.produtosList) {
    ui.produtosList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.waitlist-notify-btn');
      if (!btn) return;
      const item = btn.closest('.dynamic-item');
      const nome = item?.querySelector('[data-pkey="nome"]')?.value.trim();
      if (!nome) return;
      const confirmed = await window.ZapUI.confirm({
        title: 'Avisar clientes',
        message: `Avisar quem está esperando "${nome}" que o produto voltou ao estoque?`,
        confirmText: 'Enviar avisos',
        cancelText: 'Agora não',
      });
      if (!confirmed) return;
      btn.disabled = true;
      try {
        const res = await apiFetch('/api/products/notify-restock', {
          method: 'POST',
          body: JSON.stringify({ nome }),
        });
        const data = await res.json();
        if (res.ok) {
          window.Toast?.show(`Aviso enviado para ${data.enviados} pessoa(s).`, 'success');
          loadWaitlistCounts();
        } else {
          window.Toast?.show('Erro ao enviar aviso.', 'error');
        }
      } catch {
        window.Toast?.show('Erro de conexão ao enviar aviso.', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Respostas rapidas
  function renderRespostasRapidas() {
    if(!ui.respostasList) return;
    if (!_respostasRapidas.length) {
      ui.respostasList.innerHTML = '<p style="color:var(--text-secondary);font-size:.85rem;margin:.25rem 0;">Nenhum template cadastrado.</p>';
    } else {
      ui.respostasList.innerHTML = _respostasRapidas.map((r, i) =>
        `<div class="flex items-center gap-2 mb-2">
          <span class="flex-1 bg-gray-50 border border-gray-200 p-2 rounded-md text-sm">${r.replace(/</g,'&lt;')}</span>
          <button type="button" class="btn btn-icon text-danger hover-bg-danger-50" data-idx="${i}" title="Remover"><i data-lucide="trash-2"></i></button>
        </div>`
      ).join('');
      
      ui.respostasList.querySelectorAll('button[data-idx]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.currentTarget.dataset.idx, 10);
          _respostasRapidas.splice(idx, 1);
          renderRespostasRapidas();
        });
      });
      if(window.lucide) window.lucide.createIcons({root: ui.respostasList});
    }
    refreshBadges();
  }

  if(ui.addRespostaBtn && ui.novaResposta) {
    ui.addRespostaBtn.addEventListener('click', () => {
      const val = ui.novaResposta.value.trim();
      if (!val) return;
      _respostasRapidas.push(val);
      ui.novaResposta.value = '';
      renderRespostasRapidas();
    });
    ui.novaResposta.addEventListener('keydown', (e) => {
      if(e.key === 'Enter') { e.preventDefault(); ui.addRespostaBtn.click(); }
    });
  }

  // ── Templates por nicho ────────────────────────────────────────────────────
  let _nicheTemplates = {};

  async function loadNicheOptions() {
    if (!ui.nicheSelect) return;
    try {
      const res = await fetch('/api/niche-templates');
      if (!res.ok) return;
      const data = await res.json();
      _nicheTemplates = data.templates || {};
      ui.nicheSelect.innerHTML = '<option value="">Selecione um nicho para receber sugestões...</option>' +
        (data.niches || []).map((n) => `<option value="${n.id}">${n.label}</option>`).join('');
    } catch (err) {
      console.error('[niche] load', err);
    }
  }

  if (ui.nicheApplyBtn) {
    ui.nicheApplyBtn.addEventListener('click', () => {
      const nicheId = ui.nicheSelect?.value;
      if (!nicheId) { window.Toast?.show('Selecione um nicho primeiro.', 'error'); return; }
      const tpl = _nicheTemplates[nicheId];
      if (!tpl) return;

      let added = 0;

      const existingFaqs = collect(ui.faqsList).map((f) => (f.pergunta || '').toLowerCase().trim());
      (tpl.faqs || []).forEach((f) => {
        if (!existingFaqs.includes((f.pergunta || '').toLowerCase().trim())) { addFaq(f); added++; }
      });

      const existingObjs = collect(ui.objecoesList).map((o) => (o.objecao || '').toLowerCase().trim());
      (tpl.objecoes || []).forEach((o) => {
        if (!existingObjs.includes((o.objecao || '').toLowerCase().trim())) { addObjecao(o); added++; }
      });

      (tpl.respostas_rapidas || []).forEach((r) => {
        if (!_respostasRapidas.includes(r)) { _respostasRapidas.push(r); added++; }
      });
      renderRespostasRapidas();

      if (tpl.regras?.length && ui.regrasInput) {
        const currentRegras = (ui.regrasInput.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
        const newRegras = tpl.regras.filter((r) => !currentRegras.includes(r));
        if (newRegras.length) {
          ui.regrasInput.value = [...currentRegras, ...newRegras].join('\n');
          added += newRegras.length;
        }
      }

      refreshBadges();
      window.Toast?.show(
        added > 0 ? `${added} sugestão(ões) adicionada(s)! Revise e clique em Salvar.` : 'Você já tem tudo isso configurado.',
        'success'
      );
    });
  }

  // Toggles
  if(ui.horario_ativo) {
    ui.horario_ativo.addEventListener('change', () => {
      const on = ui.horario_ativo.checked;
      ui.horarioFields.style.display = on ? 'block' : 'none';
      const badge = document.getElementById('badge-horario');
      if(badge) {
        badge.textContent = on ? 'Ativado' : 'Desativado';
        badge.className = 'badge ' + (on ? 'badge-success' : 'badge-gray');
      }
    });
  }

  if(ui.followup_ativo) {
    ui.followup_ativo.addEventListener('change', () => {
      const on = ui.followup_ativo.checked;
      ui.followupFields.style.display = on ? 'block' : 'none';
      const badge = document.getElementById('badge-followup');
      if(badge) {
        badge.textContent = on ? 'Ativado' : 'Desativado';
        badge.className = 'badge ' + (on ? 'badge-success' : 'badge-gray');
      }
    });
  }

  if(ui.resumo_diario_ativo) {
    ui.resumo_diario_ativo.addEventListener('change', () => {
      const on = ui.resumo_diario_ativo.checked;
      ui.resumoDiarioFields.style.display = on ? 'block' : 'none';
      const badge = document.getElementById('badge-resumo-diario');
      if(badge) {
        badge.textContent = on ? 'Ativado' : 'Desativado';
        badge.className = 'badge ' + (on ? 'badge-success' : 'badge-gray');
      }
    });
  }

  if(ui.delivery_ativo) {
    ui.delivery_ativo.addEventListener('change', () => {
      const on = ui.delivery_ativo.checked;
      if(ui.deliveryFields) ui.deliveryFields.style.display = on ? 'block' : 'none';
      const badge = document.getElementById('badge-delivery');
      if(badge) {
        badge.textContent = on ? 'Ativado' : 'Desativado';
        badge.className = 'badge ' + (on ? 'badge-success' : 'badge-gray');
      }
    });
  }

  function refreshBadges() {
    if(ui.produtosList) {
      const nProd = ui.produtosList.querySelectorAll('.dynamic-item').length;
      const bProd = document.getElementById('badge-produtos');
      if(bProd) { bProd.textContent = nProd; bProd.className = 'badge ' + (nProd > 0 ? 'badge-brand' : 'badge-gray'); }
    }
    
    if(ui.faqsList && ui.objecoesList && ui.regrasInput) {
      const nFaq = ui.faqsList.querySelectorAll('.dynamic-item').length;
      const nObj = ui.objecoesList.querySelectorAll('.dynamic-item').length;
      const nReg = (ui.regrasInput.value || '').split('\n').filter((s) => s.trim()).length;
      const nIA = nFaq + nObj + nReg;
      const bIA = document.getElementById('badge-ia');
      if(bIA) { bIA.textContent = nIA + ' itens'; bIA.className = 'badge ' + (nIA > 0 ? 'badge-brand' : 'badge-gray'); }
    }
    
    const bResp = document.getElementById('badge-respostas');
    if(bResp) { bResp.textContent = _respostasRapidas.length; bResp.className = 'badge ' + (_respostasRapidas.length > 0 ? 'badge-brand' : 'badge-gray'); }
    
    updateProgress();
  }
  
  function updateProgress() {
    const autoActivationPercent = 80;
    const nameOk  = (ui.business_name?.value || '').trim().length > 0;
    const descOk  = (ui.descricao?.value || '').trim().length > 0;
    const lojaOk = nameOk && descOk;

    const prodCount = ui.produtosList ? ui.produtosList.querySelectorAll('.dynamic-item').length : 0;
    const precoEls = [...(ui.produtosList?.querySelectorAll('[data-key="preco"]') || [])];
    const nomeEls = [...(ui.produtosList?.querySelectorAll('[data-key="nome"]') || [])];
    const missingPreco = precoEls.filter(el => el.value.trim().length === 0).length;
    const missingNome = nomeEls.filter(el => el.value.trim().length === 0).length;
    const catalogOk = _hasCatalogFile || (ui.catalog_pdf_url?.value || '').trim().length > 0;
    const produtosOk = catalogOk || (prodCount > 0 && missingNome === 0 && missingPreco === 0);

    const { nomeOk, tomOk, iaConfigOk } = getIaConfigState();
    const checks  = [nameOk, descOk, produtosOk, nomeOk, tomOk];
    const score = checks.filter(Boolean).length;
    const checklistPercent = Math.round((score / checks.length) * 100);
    const percent = _officialAnalysis ? _officialAnalysis.score : checklistPercent;
    const analysisComplete = _officialAnalysis ? percent === 100 : checklistPercent === 100;

    const pbText = document.getElementById('setup-progress-text');
    const pbBar  = document.getElementById('setup-progress-bar');
    const pbLabel = document.getElementById('setup-progress-label');
    if (pbText) { pbText.textContent = percent + '%'; pbText.style.color = percent === 100 ? 'var(--brand-600)' : 'var(--info-600)'; }
    if (pbBar)  { pbBar.style.width = percent + '%'; pbBar.style.backgroundColor = percent === 100 ? 'var(--brand-500)' : 'var(--info-500)'; }
    if (pbLabel) pbLabel.textContent = _officialAnalysis ? 'nota da análise' : 'preenchido';

    const setStatus = (id, done, completeText = 'Concluído') => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = done ? completeText : 'Pendente';
      el.className = 'step-status ' + (done ? 'done' : 'pending');
    };
    setStatus('status-loja', lojaOk);
    setStatus('status-produtos', produtosOk, 'Pronto');
    setStatus('status-ia-config', iaConfigOk, 'Pronto');
    // Mercado Pago: status recomendado (sem bloquear ativação da IA) até conectar.
    const mpStatusEl = document.getElementById('status-mp');
    const mpBtn = document.querySelector('[data-step-card="mercado-pago"] a.btn');
    const mpTitleEl = document.querySelector('[data-step-card="mercado-pago"] h3');
    const bMP = document.getElementById('badge-mp');
    const mpConnected = bMP && (bMP.textContent || '').toLowerCase() === 'configurado';
    if (mpStatusEl) {
      mpStatusEl.textContent = mpConnected ? 'Conectado' : 'Recomendado';
      mpStatusEl.className = 'step-status ' + (mpConnected ? 'done' : 'recommended');
    }
    // Título do card: quando conectado, evita repetir "Conectar" com "Conectado".
    if (mpTitleEl) {
      mpTitleEl.textContent = mpConnected ? 'Mercado Pago' : 'Conectar Mercado Pago';
    }
    // Botão: quando conectado, vira "Desconectar Mercado Pago" em vermelho.
    if (mpBtn) {
      mpBtn.textContent = mpConnected ? 'Desconectar Mercado Pago' : 'Conectar Mercado Pago';
      mpBtn.classList.toggle('btn-primary', !mpConnected);
      mpBtn.classList.toggle('btn-danger', mpConnected);
    }
    document.querySelector('[data-step-card="loja"] .setup-toggle-section')?.replaceChildren(document.createTextNode(lojaOk ? 'Editar loja' : 'Configurar loja'));
    document.querySelector('[data-step-card="produtos"] .setup-toggle-section')?.replaceChildren(document.createTextNode(produtosOk ? 'Editar produtos' : 'Adicionar produtos'));
    document.querySelector('[data-step-card="ia-config"] .setup-toggle-section')?.replaceChildren(document.createTextNode(iaConfigOk ? 'Editar IA' : 'Personalizar IA'));
    document.getElementById('setup-checklist')?.classList.toggle('all-done', analysisComplete);

    const missing = [];
    if (!lojaOk) missing.push('Loja');
    if (!produtosOk) missing.push('Produtos');
    if (!iaConfigOk) missing.push('Personalização da IA');
    const missingEl = document.getElementById('setup-missing-list');
    if (missingEl) {
      if (_officialAnalysis) {
        missingEl.textContent = percent === 100
          ? 'Análise concluída: sua configuração está pronta para vendas reais.'
          : `Nota oficial da última análise: ${percent}%. Corrija as pendências e toque em “Analisar IA” novamente para atualizar.`;
      } else {
        missingEl.textContent = checklistPercent === 100
          ? 'Preenchimento básico concluído. Analise a IA para obter a nota oficial de prontidão.'
          : `Complete pelo menos ${autoActivationPercent}% dos dados e depois analise a IA.`;
      }
    }

  }

  if(ui.regrasInput)    ui.regrasInput.addEventListener('input', refreshBadges);
  if(ui.business_name)  ui.business_name.addEventListener('input', updateProgress);
  if(ui.descricao)      ui.descricao.addEventListener('input', updateProgress);
  if(ui.atendente_name) ui.atendente_name.addEventListener('input', updateProgress);
  if(ui.tomDeVoz)       ui.tomDeVoz.addEventListener('input', updateProgress);
  if(ui.catalog_pdf_url) ui.catalog_pdf_url.addEventListener('input', updateProgress);
  if(ui.notify_phone)   ui.notify_phone.addEventListener('input', updateProgress);

  // ── WhatsApp Link (número servidor) ────────────────────────────────────────

  function updateWhatsappLogoState(hasLogo, logoUrl) {
    const preview = document.getElementById('wa-link-logo-preview');
    const status = document.getElementById('wa-link-logo-status');
    const removeBtn = document.getElementById('wa-link-logo-remove-btn');

    if (preview) {
      preview.innerHTML = hasLogo && logoUrl
        ? `<img src="${logoUrl}" alt="Logo do link">`
        : '<i data-lucide="image"></i>';
    }
    if (status) {
      status.textContent = hasLogo ? 'Logo carregada para o link.' : 'Nenhuma logo enviada.';
    }
    if (removeBtn) {
      removeBtn.style.display = hasLogo ? 'inline-flex' : 'none';
    }
    if (window.lucide && preview) window.lucide.createIcons({ root: preview });
  }

  async function uploadWhatsappLogo(file) {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      window.Toast?.show('Use uma imagem PNG, JPG ou WebP.', 'error');
      return;
    }
    if (file.size > 1024 * 1024) {
      window.Toast?.show('A logo deve ter no máximo 1 MB.', 'error');
      return;
    }

    const form = new FormData();
    form.append('logo', file);
    const res = await apiFetch('/api/settings/link-logo', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Não foi possível carregar a logo.');
    window.Toast?.show('Logo carregada no link.', 'success');
    await loadWhatsappLink();
  }

  async function loadWhatsappLink() {
    try {
      const res = await fetch('/api/whatsapp/link');
      if (!res.ok) return;
      const data = await res.json();

      const linkDisplay = document.getElementById('wa-link-display');
      const linkNotConfigured = document.getElementById('wa-link-not-configured');
      const linkInput = document.getElementById('wa-link-input');
      const linkOpenBtn = document.getElementById('wa-link-open-btn');
      const attendanceCodeEl = document.getElementById('wa-attendance-code');
      const bWA = document.getElementById('badge-wa');

      if (data.link) {
        const waUrl = data.attendance_url || data.link;
        if (linkDisplay) linkDisplay.style.display = 'flex';
        if (linkNotConfigured) linkNotConfigured.style.display = 'none';
        if (linkInput) linkInput.value = waUrl;
        if (linkOpenBtn) linkOpenBtn.href = waUrl;
        const setupTestWa = document.getElementById('setup-test-wa');
        if (setupTestWa) setupTestWa.href = waUrl;
        if (attendanceCodeEl) attendanceCodeEl.textContent = data.attendance_code || '';
        if (bWA) { bWA.textContent = 'Ativo'; bWA.className = 'badge badge-success'; }
      } else {
        if (linkDisplay) linkDisplay.style.display = 'none';
        if (linkNotConfigured) linkNotConfigured.style.display = 'block';
        if (linkInput) linkInput.value = '';
        if (linkOpenBtn) linkOpenBtn.href = '#';
        const setupTestWa = document.getElementById('setup-test-wa');
        if (setupTestWa) setupTestWa.href = '#';
        if (bWA) { bWA.textContent = 'Não configurado'; bWA.className = 'badge badge-gray'; }
      }
      updateProgress();
      updateWhatsappLogoState(Boolean(data.link_logo_set), data.link_logo_url);

      const previewEl = document.getElementById('wa-link-message-preview');
      const previewTextEl = document.getElementById('wa-link-preview-text');
      if (previewEl && previewTextEl) {
        let msg = null;
        if (data.attendance_preview_msg) {
          // Novo formato TX579 — mensagem dinâmica com nome da empresa
          msg = data.attendance_preview_msg;
        } else if (data.entry_handle && data.entry_code) {
          // Formato entry route (pontuação natural)
          const [o, m, q] = Array.from(data.entry_code);
          msg = `Olá${o} Conheci a @${data.entry_handle}${m} e queria tirar uma dúvida${q}`;
        } else if (data.route_code && data.display_handle) {
          // Formato Braille legado
          msg = `Olá! Vim conhecer ${data.route_code} @${data.display_handle} e gostaria de ver os produtos 😊`;
        } else if (data.slug) {
          // Formato slug legado
          msg = `Olá! Vim conhecer a loja @${data.slug} e gostaria de ver os produtos 😊`;
        }
        if (msg) {
          previewTextEl.textContent = msg;
          previewEl.style.display = 'block';
          const hint = document.getElementById('wa-route-code-hint');
          if (hint) hint.style.display = 'block';
        }
      }

      const copyBtn = document.getElementById('wa-link-copy-btn');
      if (copyBtn && !copyBtn.dataset.bound) {
        copyBtn.dataset.bound = 'true';
        copyBtn.addEventListener('click', () => {
          const url = document.getElementById('wa-link-input')?.value || '';
          if (!url) return;
          navigator.clipboard.writeText(url)
            .then(() => window.Toast?.show('Link copiado!', 'success'));
        });
      }
    } catch (err) {
      console.error('[WA Link]', err);
    }
  }

  document.getElementById('wa-link-logo-input')?.addEventListener('change', async (e) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await uploadWhatsappLogo(file);
    } catch (err) {
      window.Toast?.show(err.message || 'Não foi possível carregar a logo.', 'error');
    } finally {
      input.value = '';
    }
  });

  document.getElementById('wa-link-logo-remove-btn')?.addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/settings/link-logo', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível remover a logo.');
      window.Toast?.show('Logo removida do link.', 'success');
      await loadWhatsappLink();
    } catch (err) {
      window.Toast?.show(err.message || 'Não foi possível remover a logo.', 'error');
    }
  });

  // ── Catalog PDF upload ────────────────────────────────────────────────────
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function catalogStatusInfo(status) {
    const map = {
      uploaded: { text: 'Enviado', processing: true },
      queued: { text: 'Na fila', processing: true },
      extracting: { text: 'Lendo PDF', processing: true },
      indexing: { text: 'Organizando', processing: true },
      extracting_products: { text: 'Buscando produtos', processing: true },
      ready: { text: 'Pronto', processing: false },
      partial: { text: 'Pronto parcial', processing: false },
      failed: { text: 'Falhou', processing: false },
      rejected_limit: { text: 'Limite excedido', processing: false },
      disabled: { text: 'Desativado', processing: false },
    };
    return map[status] || { text: 'Recebido', processing: false };
  }

  function renderCatalogDocument(doc, fileMeta = null) {
    if (!ui.catalogFileStatus) return;
    const status = catalogStatusInfo(doc?.status || (fileMeta ? 'uploaded' : ''));
    _hasCatalogFile = Boolean(fileMeta || doc);
    ui.catalogFileStatus.style.display = _hasCatalogFile ? 'flex' : 'none';
    if (ui.catalogFileName) ui.catalogFileName.textContent = fileMeta?.filename || doc?.filename || '';
    if (ui.catalogFileDate) {
      const pct = Number(doc?.progress_percent) || 0;
      ui.catalogFileDate.textContent = status.processing && pct > 0 ? `${status.text} - ${pct}%` : status.text;
      ui.catalogFileDate.title = doc?.error_message || '';
    }
    if (ui.catalogUploadText) ui.catalogUploadText.textContent = _hasCatalogFile ? 'Substituir PDF' : 'Carregar PDF';
    updateProgress();
  }

  async function showCatalogProductsReview(items) {
    const produtos = (items || []).map((item) => item.product || item).filter((p) => p && p.nome);
    if (!produtos.length) return false;
    const modal = document.getElementById('catalogReviewModal');
    const body = document.getElementById('catalogReviewBody');
    if (!modal || !body) {
      const confirmAdd = await window.ZapUI.confirm({
        title: 'Adicionar produtos encontrados',
        message: `${produtos.length} produto(s) encontrado(s) no PDF. Deseja adicionar à lista de produtos?`,
        confirmText: 'Adicionar produtos',
        cancelText: 'Agora não',
      });
      if (confirmAdd) {
        produtos.forEach(addProduto);
        refreshBadges();
      }
      return confirmAdd;
    }

    body.innerHTML = produtos.map((p) => `
      <div style="border:1px solid #eaecf0; border-radius:8px; padding:12px;">
        <div style="font-weight:600; margin-bottom:4px;">${escapeHtml(p.nome)} <span style="color:var(--text-secondary);font-weight:400;">- ${escapeHtml(p.preco || 'sob consulta')}</span></div>
        ${p.descricao ? `<div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:8px;">${escapeHtml(p.descricao)}</div>` : ''}
        ${Array.isArray(p.variacoes_estr) && p.variacoes_estr.length > 0
          ? `<div style="font-size:0.8rem; background:#f9fafb; padding:4px 8px; border-radius:4px;">Variacoes: ${p.variacoes_estr.map((v) => escapeHtml(v.nome)).join(', ')}</div>`
          : (p.variacoes ? `<div style="font-size:0.8rem; background:#f9fafb; padding:4px 8px; border-radius:4px;">Variacoes: ${escapeHtml(p.variacoes)}</div>` : '')}
      </div>
    `).join('');

    modal.style.display = 'flex';
    const closeModal = () => { modal.style.display = 'none'; };
    document.getElementById('catalogReviewClose').onclick = closeModal;
    document.getElementById('catalogReviewCancel').onclick = closeModal;
    document.getElementById('catalogReviewConfirm').onclick = () => {
      produtos.forEach(addProduto);
      refreshBadges();
      closeModal();
      window.Toast?.show('Produtos adicionados!', 'success');
    };
    return true;
  }

  async function maybeShowCatalogProducts(doc) {
    if (!_catalogProductDocToPrompt || !doc?.id || doc.id !== _catalogProductDocToPrompt) return;
    if (!['ready', 'partial'].includes(doc.status) || _catalogProductPrompted.has(doc.id)) return;
    _catalogProductPrompted.add(doc.id);
    try {
      const res = await fetch(`/api/knowledge/documents/${doc.id}/products`);
      if (!res.ok) return;
      const data = await res.json();
      const shown = await showCatalogProductsReview(data.products || []);
      if (!shown) window.Toast?.show('Catalogo pronto para a IA consultar.', 'success');
    } catch (err) {
      console.error('[catalog products]', err);
    }
  }

  async function loadCatalogKnowledgeStatus() {
    try {
      const res = await fetch('/api/knowledge/documents?limit=20');
      if (!res.ok) return null;
      const data = await res.json();
      const doc = (data.documents || []).find((item) => item.source_type === 'catalog') || null;
      if (doc) {
        renderCatalogDocument(doc);
        await maybeShowCatalogProducts(doc);
      }
      return doc;
    } catch (err) {
      console.error('[catalog status]', err);
      return null;
    }
  }

  function scheduleKnowledgePolling(documentId = null) {
    if (documentId) _catalogProductDocToPrompt = documentId;
    if (_catalogPollTimer) clearInterval(_catalogPollTimer);
    let remaining = 18;
    const tick = async () => {
      remaining -= 1;
      const [catalogDoc, docs] = await Promise.all([
        loadCatalogKnowledgeStatus(),
        loadDocuments(),
      ]);
      const busy = catalogStatusInfo(catalogDoc?.status).processing;
      const docsBusy = (docs || []).some((doc) => catalogStatusInfo(doc.status).processing);
      if ((!busy && !docsBusy) || remaining <= 0) {
        clearInterval(_catalogPollTimer);
        _catalogPollTimer = null;
      }
    };
    _catalogPollTimer = setInterval(tick, 4000);
    setTimeout(tick, 1500);
  }

  if (ui.catalogPdfInput) {
    ui.catalogPdfInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.type !== 'application/pdf') {
        window.Toast?.show('Por favor, selecione um arquivo PDF.', 'error');
        return;
      }

      const label = ui.catalogUploadLabel;
      const origHtml = label ? label.innerHTML : '';
      if (label) label.innerHTML = '<span style="display:flex;align-items:center;gap:6px;"><i data-lucide="loader-2" class="spin" style="width:16px;height:16px;"></i> Importando…</span>';
      if (window.lucide && label) window.lucide.createIcons({ root: label });

      try {
        const token = await (async () => { const r = await fetch('/api/csrf-token'); return r.ok ? (await r.json()).token : ''; })();
        const fd = new FormData();
        fd.append('catalog', file);
        const res = await fetch('/api/catalog/import', {
          method: 'POST',
          headers: { 'X-CSRF-Token': token },
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          window.Toast?.show(data.error || 'Erro ao importar PDF.', 'error');
          return;
        }

        renderCatalogDocument({
          id: data.document_id,
          filename: file.name,
          status: data.status || 'queued',
          progress_percent: data.duplicate ? 100 : 5,
        });
        scheduleKnowledgePolling(data.document_id || null);
        window.Toast?.show(data.duplicate
          ? 'Este PDF ja estava na base. Vou atualizar o status na tela.'
          : 'PDF recebido. A IA esta lendo o arquivo em segundo plano.', 'success');
      } catch (err) {
        console.error('[catalog upload]', err);
        window.Toast?.show('Erro de conexão ao importar PDF.', 'error');
      } finally {
        if (label) label.innerHTML = origHtml;
        if (window.lucide && label) window.lucide.createIcons({ root: label });
        ui.catalogPdfInput.value = '';
      }
    });
  }

  // ── Catalog PDF delete ────────────────────────────────────────────────────
  if (ui.catalogDeleteBtn) {
    ui.catalogDeleteBtn.addEventListener('click', async () => {
      const confirmed = await window.ZapUI.confirm({
        title: 'Remover PDF do catálogo',
        message: 'O arquivo será removido permanentemente. Esta ação não pode ser desfeita.',
        confirmText: 'Remover PDF',
        cancelText: 'Manter arquivo',
        tone: 'danger',
      });
      if (!confirmed) return;
      try {
        const token = await (async () => { const r = await fetch('/api/csrf-token'); return r.ok ? (await r.json()).token : ''; })();
        const res = await fetch('/api/catalog/delete', {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': token },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          window.Toast?.show(data.error || 'Erro ao remover o PDF.', 'error');
          return;
        }
        _hasCatalogFile = false;
        _catalogProductDocToPrompt = null;
        if (_catalogPollTimer) clearInterval(_catalogPollTimer);
        _catalogPollTimer = null;
        if (ui.catalogFileStatus) ui.catalogFileStatus.style.display = 'none';
        if (ui.catalogFileName) ui.catalogFileName.textContent = '';
        if (ui.catalogFileDate) ui.catalogFileDate.textContent = '';
        if (ui.catalogUploadText) ui.catalogUploadText.textContent = 'Carregar PDF';
        updateProgress();
        window.Toast?.show('PDF removido com sucesso.', 'success');
      } catch (err) {
        console.error('[catalog delete]', err);
        window.Toast?.show('Erro de conexão ao remover PDF.', 'error');
      }
    });
  }

  // ── Documentos extras ─────────────────────────────────────────────────────
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderDocuments(docs) {
    if (!ui.documentsList) return;
    if (!docs.length) { ui.documentsList.innerHTML = ''; return; }
    ui.documentsList.innerHTML = docs.map((d) => {
      const status = catalogStatusInfo(d.status);
      const pct = Number(d.progress_percent) || 0;
      const statusText = status.processing && pct > 0 ? `${status.text} - ${pct}%` : status.text;
      return `
        <div class="catalog-file-row" data-doc-id="${d.id}">
          <i data-lucide="file-text" style="color:var(--brand-500);width:16px;height:16px;flex-shrink:0;"></i>
          <a href="/api/documents/${d.id}/download" style="font-size:0.875rem;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit;text-decoration:none;" target="_blank" rel="noopener">${escapeHtml(d.filename)}</a>
          <span style="font-size:0.75rem;color:var(--text-secondary);white-space:nowrap;">${statusText}</span>
          <span style="font-size:0.75rem;color:var(--text-secondary);white-space:nowrap;">${formatBytes(d.size_bytes)}</span>
          <button type="button" class="document-delete-btn" title="Remover" data-doc-id="${d.id}" style="background:none;border:none;cursor:pointer;padding:4px 6px;color:var(--text-secondary);display:flex;align-items:center;flex-shrink:0;">
            <i data-lucide="trash-2" style="width:18px;height:18px;"></i>
          </button>
        </div>
      `;
    }).join('');
    if (window.lucide) window.lucide.createIcons({ root: ui.documentsList });
  }

  async function loadDocuments() {
    if (!ui.documentsList) return;
    try {
      const res = await fetch('/api/documents');
      if (!res.ok) return [];
      const data = await res.json();
      const docs = data.documents || [];
      renderDocuments(docs);
      return docs;
    } catch (err) {
      console.error('[documents] load', err);
    }
    return [];
  }

  if (ui.documentInput) {
    ui.documentInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.type !== 'application/pdf') {
        window.Toast?.show('Por favor, selecione um arquivo PDF.', 'error');
        ui.documentInput.value = '';
        return;
      }
      const label = ui.documentUploadLabel;
      const origHtml = label ? label.innerHTML : '';
      if (label) label.innerHTML = '<span style="display:flex;align-items:center;gap:6px;"><i data-lucide="loader-2" class="spin" style="width:16px;height:16px;"></i> Enviando…</span>';
      if (window.lucide && label) window.lucide.createIcons({ root: label });

      try {
        const token = await (async () => { const r = await fetch('/api/csrf-token'); return r.ok ? (await r.json()).token : ''; })();
        const fd = new FormData();
        fd.append('document', file);
        const res = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'X-CSRF-Token': token },
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          window.Toast?.show(data.error || 'Erro ao enviar documento.', 'error');
          return;
        }
        await loadDocuments();
        scheduleKnowledgePolling();
        window.Toast?.show(data.duplicate ? 'Este documento ja estava na base.' : 'Documento recebido. A IA esta lendo o PDF em segundo plano.', 'success');
      } catch (err) {
        console.error('[documents] upload', err);
        window.Toast?.show('Erro de conexão ao enviar documento.', 'error');
      } finally {
        if (label) label.innerHTML = origHtml;
        if (window.lucide && label) window.lucide.createIcons({ root: label });
        ui.documentInput.value = '';
      }
    });
  }

  if (ui.documentsList) {
    ui.documentsList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.document-delete-btn');
      if (!btn) return;
      const id = btn.dataset.docId;
      const confirmed = await window.ZapUI.confirm({
        title: 'Remover documento',
        message: 'Este documento será removido permanentemente. Esta ação não pode ser desfeita.',
        confirmText: 'Remover documento',
        cancelText: 'Manter documento',
        tone: 'danger',
      });
      if (!confirmed) return;
      try {
        const token = await (async () => { const r = await fetch('/api/csrf-token'); return r.ok ? (await r.json()).token : ''; })();
        const res = await fetch(`/api/documents/${id}`, {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': token },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          window.Toast?.show(data.error || 'Erro ao remover documento.', 'error');
          return;
        }
        await loadDocuments();
        window.Toast?.show('Documento removido.', 'success');
      } catch (err) {
        console.error('[documents] delete', err);
        window.Toast?.show('Erro de conexão ao remover documento.', 'error');
      }
    });
  }

  // ── Mercado Pago: desconectar ────────────────────────────────────────────
  document.getElementById('setup-mp-disconnect-main')?.addEventListener('click', () => {
    document.getElementById('setup-mp-disconnect')?.click();
  });

  document.getElementById('setup-mp-disconnect')?.addEventListener('click', async () => {
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
      const bMP = document.getElementById('badge-mp');
      if (bMP) { bMP.textContent = 'Não configurado'; bMP.className = 'badge badge-gray text-xs'; }
      window.Toast?.show('Mercado Pago desconectado.', 'success');
      updateProgress();
    } catch (err) {
      console.error('[MP disconnect]', err);
      window.Toast?.show(err.message || 'Não foi possível desconectar Mercado Pago.', 'error');
    }
  });

  // ── Google Sheets: status, sync e desconexão ──────────────────────────────
  const googleSheetsSyncBtn = document.getElementById('google-sheets-sync-btn');
  const googleSheetsDisconnectBtn = document.getElementById('google-sheets-disconnect-btn');
  if (googleSheetsSyncBtn) {
    googleSheetsSyncBtn.addEventListener('click', async () => {
      googleSheetsSyncBtn.disabled = true;
      const oldText = googleSheetsSyncBtn.textContent;
      googleSheetsSyncBtn.textContent = 'Sincronizando...';
      try {
        const res = await apiFetch('/api/google-sheets/sync', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Não foi possível sincronizar a planilha. Tente novamente.');
        applyGoogleSheetsStatus(data);
        window.Toast?.show('Planilha sincronizada com sucesso.', 'success');
      } catch (err) {
        window.Toast?.show(err.message || 'Não foi possível sincronizar a planilha. Tente novamente.', 'error');
      } finally {
        googleSheetsSyncBtn.disabled = false;
        googleSheetsSyncBtn.textContent = oldText;
      }
    });
  }
  if (googleSheetsDisconnectBtn) {
    googleSheetsDisconnectBtn.addEventListener('click', async () => {
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
  }

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
    if (syncEl) syncEl.textContent = status.last_sync_at ? `Última sincronização: ${new Date(status.last_sync_at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')}` : 'Ainda não sincronizado';
  }

  document.querySelectorAll('.automation-scroll-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.querySelector(btn.dataset.target || '#webhook_url');
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => target.focus?.(), 350);
    });
  });

  // ── Webhook: gerar/regenerar segredo ──────────────────────────────────────
  const webhookRegenerateBtn = document.getElementById('webhook-regenerate-btn');
  if (webhookRegenerateBtn) {
    webhookRegenerateBtn.addEventListener('click', async () => {
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
      } catch (err) {
        console.error('[webhook] regenerate-secret', err);
        window.Toast?.show('Erro de conexão.', 'error');
      }
    });
  }

  // ── Webhook: enviar evento de teste ───────────────────────────────────────
  const webhookTestBtn = document.getElementById('webhook-test-btn');
  if (webhookTestBtn) {
    webhookTestBtn.addEventListener('click', async () => {
      const resultEl = document.getElementById('webhook-test-result');
      if (resultEl) resultEl.textContent = 'Enviando teste...';
      try {
        const res = await apiFetch('/api/webhooks/test', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (resultEl) resultEl.textContent = data.error || 'Não foi possível entregar o teste. Verifique o link de destino.';
          return;
        }
        const d = data.delivery;
        if (resultEl) {
          resultEl.textContent = d?.status === 'sucesso'
            ? 'Teste enviado com sucesso.'
            : 'Não foi possível entregar o teste. Verifique o link de destino.';
        }
      } catch (err) {
        console.error('[webhook] test', err);
        if (resultEl) resultEl.textContent = 'Erro de conexão.';
      }
    });
  }

  // ── OAuth return (MP connected / error URL params) ───────────────────────
  (function handleOAuthReturn() {
    const params = new URLSearchParams(location.search);
    if (params.has('mp_connected')) {
      setTimeout(() => window.Toast?.show('Mercado Pago conectado com sucesso! 🎉', 'success'), 400);
      history.replaceState({}, '', location.pathname);
    } else if (params.has('mp_error')) {
      const errMap = {
        invalid_state: 'Erro de segurança na autenticação. Tente novamente.',
        oauth_failed: 'Falha ao conectar com Mercado Pago. Verifique suas credenciais e o Redirect URI no painel MP.',
        not_configured: 'OAuth do Mercado Pago não está configurado na plataforma.'
      };
      const msg = errMap[params.get('mp_error')] || 'Erro ao conectar com Mercado Pago.';
      setTimeout(() => window.Toast?.show(msg, 'error'), 400);
      history.replaceState({}, '', location.pathname);
    } else if (params.has('bling_connected')) {
      setTimeout(() => window.Toast?.show('Bling conectado com sucesso! 🎉', 'success'), 400);
      history.replaceState({}, '', location.pathname);
    } else if (params.has('bling_error')) {
      const errMap = {
        invalid_state: 'Erro de segurança na autenticação. Tente novamente.',
        oauth_failed: 'Falha ao conectar com Bling. Verifique as credenciais no painel de desenvolvedor.',
        not_configured: 'OAuth do Bling não está configurado na plataforma.'
      };
      const msg = errMap[params.get('bling_error')] || 'Erro ao conectar com Bling.';
      setTimeout(() => window.Toast?.show(msg, 'error'), 400);
      history.replaceState({}, '', location.pathname);
    } else if (params.has('gs_connected')) {
      setTimeout(() => window.Toast?.show('Google Sheets conectado com sucesso! 🎉', 'success'), 400);
      history.replaceState({}, '', location.pathname);
    } else if (params.has('gs_error')) {
      const errMap = {
        invalid_state: 'Erro de segurança na autenticação. Tente novamente.',
        oauth_failed: 'Falha ao conectar com Google Sheets. Verifique as credenciais no Google Cloud.',
        not_configured: 'Google Sheets ainda não está configurado na plataforma.'
      };
      const msg = errMap[params.get('gs_error')] || 'Erro ao conectar com Google Sheets.';
      setTimeout(() => window.Toast?.show(msg, 'error'), 400);
      history.replaceState({}, '', location.pathname);
    }
  })();



  function renderAiCapabilities(settings) {
    const list = document.getElementById('aiCapabilitiesList');
    if (!list) return;
    const business = settings.business || {};
    const products = Array.isArray(business.produtos) ? business.produtos : [];
    const hasProductImages = products.some((p) => p.imagem_url || (Array.isArray(p.variacoes_estr) && p.variacoes_estr.some((v) => v.imagem_url)));
    const hasCatalog = Boolean(settings.catalog_file || business.catalog_pdf_url || products.length);
    const items = [
      { label: 'Texto', ok: true, hint: 'Atendimento por mensagem' },
      { label: 'Imagem', ok: true, hint: hasProductImages ? 'Com referências do catálogo' : 'Sem imagens de referência' },
      { label: 'Áudio', ok: Boolean(settings.features?.audioTranscriptionEnabled), hint: settings.features?.audioTranscriptionEnabled ? 'Transcrição ativa' : 'Configure OPENAI_API_KEY' },
      { label: 'Catálogo', ok: hasCatalog, hint: hasCatalog ? 'Produtos disponíveis para IA' : 'Cadastre produtos ou PDF' },
      { label: 'Checkout', ok: Boolean(settings.mp_token_set || business.checkout_url), hint: settings.mp_token_set ? 'Mercado Pago conectado' : business.checkout_url ? 'Link padrão configurado' : 'Configure pagamento' },
      { label: 'Frete', ok: Boolean(settings.melhor_envio_token_set || settings.cep_origem || settings.features?.mePlatformEnabled), hint: settings.features?.mePlatformEnabled ? 'Melhor Envio da plataforma' : 'Configure CEP/token' },
    ];
    list.innerHTML = items.map((item) => `
      <div class="capability-item ${item.ok ? 'is-active' : 'is-missing'}">
        <span class="capability-dot">${item.ok ? '✓' : '!'}</span>
        <div>
          <div class="capability-title">${item.label}</div>
          <div class="capability-hint">${item.hint}</div>
        </div>
      </div>
    `).join('');
  }

  // ── Uso do plano ──────────────────────────────────────────────────────────
  const USAGE_COLORS = { ok: 'var(--brand-500)', warning: '#eab308', critical: '#f97316', blocked: 'var(--danger-500)' };
  const USAGE_BANNER_BG = { warning: '#fefce8', critical: '#fff7ed', blocked: '#fef2f2' };
  const USAGE_BANNER_FG = { warning: '#854d0e', critical: '#9a3412', blocked: '#991b1b' };

  function usageBarHtml(label, used, limit, unit, status) {
    const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    return `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:4px;">
          <span>${label}</span>
          <span style="color:var(--text-secondary);">${used}${unit} de ${limit}${unit}</span>
        </div>
        <div style="width:100%;height:6px;background:var(--gray-100);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${USAGE_COLORS[status] || USAGE_COLORS.ok};"></div>
        </div>
      </div>
    `;
  }

  async function loadUsage() {
    const barsEl = document.getElementById('usageBars');
    const bannerEl = document.getElementById('usageBanner');
    const labelEl = document.getElementById('usagePlanLabel');
    if (!barsEl) return;
    window.ZapUI.renderAsyncState(barsEl, {
      state: 'loading',
      title: 'Carregando uso do plano…',
      message: 'Atualizando seus limites disponíveis.',
      compact: true,
    });
    try {
      const res = await fetch('/api/usage');
      if (!res.ok) throw new Error();
      const u = await res.json();

      if (labelEl) labelEl.textContent = `Plano ${u.limits.label} — ciclo atual até ${new Date(u.cycleEnd).toLocaleDateString('pt-BR')}`;

      const bars = [usageBarHtml('Respostas de IA', u.ai.used, u.ai.limit, '', u.ai.status)];
      bars.push(usageBarHtml('Armazenamento', u.storage.usedMb, u.storage.limitMb, 'MB', u.storage.status));
      if (u.audio.enabled) bars.push(usageBarHtml('Áudio transcrito', u.audio.usedMinutes, u.audio.limitMinutes, 'min', u.audio.status));
      if (u.extraDocs.limit > 0) bars.push(usageBarHtml('Documentos extras', u.extraDocs.used, u.extraDocs.limit, '', u.extraDocs.status));
      barsEl.innerHTML = bars.join('');

      // Banner mostra o pior status entre as métricas (blocked > critical > warning).
      const order = { blocked: 3, critical: 2, warning: 1, ok: 0 };
      const worst = [u.ai.status, u.storage.status, u.audio.status, u.extraDocs.status]
        .reduce((a, b) => (order[b] > order[a] ? b : a), 'ok');
      if (worst === 'ok' || !bannerEl) {
        if (bannerEl) bannerEl.style.display = 'none';
      } else {
        const messages = {
          warning: 'Você já usou 70% ou mais de um dos limites do seu plano.',
          critical: 'Atenção: você está perto de atingir o limite do seu plano (80%+).',
          blocked: 'Você atingiu o limite do seu plano em pelo menos um recurso. Considere fazer upgrade para não ficar sem atendimento automático.',
        };
        bannerEl.style.display = 'block';
        bannerEl.style.background = USAGE_BANNER_BG[worst];
        bannerEl.style.color = USAGE_BANNER_FG[worst];
        bannerEl.textContent = messages[worst];
      }
    } catch (err) {
      console.error('[usage] load', err);
      if (labelEl) labelEl.textContent = 'Não foi possível atualizar o uso agora.';
      window.ZapUI.renderAsyncState(barsEl, {
        state: 'error',
        title: 'Não foi possível carregar o uso',
        message: 'Seus limites continuam os mesmos. Tente novamente para consultar os valores atuais.',
        actionLabel: 'Tentar novamente',
        onAction: loadUsage,
        compact: true,
      });
    }
  }

  // Load
  async function loadSettings() {
    try {
      const meRes = await fetch('/api/me');
      const me = await meRes.json();
      planFeatures = me.planFeatures || {};
      features = me.features || {};

      window.ZapUI.setupProfileDropdown(me, apiFetch);
      window.ZapUI.setupSupportLink(me.supportPhone);

      if (me.is_admin && ui.adminLink) ui.adminLink.classList.remove('hidden');
      if (!me.is_admin) { const s = document.getElementById('supportBtn'); if (s) s.style.display = ''; }
      if (me.impersonatedBy && ui.impersonateBar) {
        ui.impersonateBar.style.display = 'flex';
        ui.impersonateEmail.textContent = me.email;
      }
      
      const [sRes, metaRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/meta')
      ]);
      const s = await sRes.json();
      metaInfo = await metaRes.json();
      _officialAnalysis = s.setup_analysis && Number.isFinite(Number(s.setup_analysis.score))
        ? { ...s.setup_analysis, score: Math.max(0, Math.min(100, Math.round(Number(s.setup_analysis.score)))) }
        : null;
      
      renderAiCapabilities(s);

      if (!s.business) return;
      const b = s.business;

      if(ui.business_name) ui.business_name.value = b.name || s.business_name || '';
      const tipoNegocioEl = document.getElementById('tipo_negocio');
      if (tipoNegocioEl) tipoNegocioEl.value = b.tipo_negocio || 'produtos';
      const pedirIdEl = document.getElementById('pedir_identificacao');
      if (pedirIdEl) pedirIdEl.checked = Boolean(b.pedir_identificacao);
      if(ui.atendente_name) ui.atendente_name.value = b.atendente_name || s.atendente_name || 'Ana';
      if(ui.descricao) ui.descricao.value = b.descricao || '';
      if(ui.tomDeVoz) ui.tomDeVoz.value = b.tomDeVoz || b.tom_de_voz || 'Amigável, direto e profissional, como uma conversa de WhatsApp.';
      if(ui.frete) ui.frete.value = b.frete || '';
      if(ui.notify_phone) ui.notify_phone.value = b.notify_phone || '';
      if(ui.catalog_pdf_url) ui.catalog_pdf_url.value = b.catalog_pdf_url || '';

      // Catálogo PDF armazenado
      if (s.catalog_file || s.catalog_document) {
        renderCatalogDocument(s.catalog_document, s.catalog_file);
        if (catalogStatusInfo(s.catalog_document?.status).processing) scheduleKnowledgePolling(s.catalog_document.id);
      }

      (b.produtos || []).forEach(addProduto);
      loadWaitlistCounts();
      (b.perguntasFrequentes || b.faqs || []).forEach(addFaq);
      (b.objecoesComuns || b.objecoes || []).forEach(addObjecao);

      if(ui.regrasInput) ui.regrasInput.value = (b.regras || []).join('\n');
      
      _respostasRapidas = b.respostas_rapidas || [];
      renderRespostasRapidas();

      // MP
      if(ui.mp_access_token) ui.mp_access_token.value = s.mp_token_set ? '*** (configurado)' : '';
      const bMP = document.getElementById('badge-mp');
      if(bMP) {
        if(s.mp_token_set) { bMP.textContent = 'Configurado'; bMP.className = 'badge badge-success text-xs'; }
        else { bMP.textContent = 'Não configurado'; bMP.className = 'badge badge-gray text-xs'; }
        updateProgress();
      }

      // MP OAuth UI — mostra botão OAuth OU input manual, conforme plataforma
      const mpOAuthSection = document.getElementById('mp-oauth-section');
      const mpManualSection = document.getElementById('mp-manual-section');
      if (features.mpOAuthEnabled) {
        if (mpOAuthSection) mpOAuthSection.style.display = 'block';
        if (mpManualSection) mpManualSection.style.display = 'none';
        const mpConnectedBox = document.getElementById('mp-connected-box');
        if (mpConnectedBox) mpConnectedBox.style.display = s.mp_token_set ? 'flex' : 'none';
        const mpOAuthBtn = document.getElementById('mp-oauth-btn');
        if (mpOAuthBtn) mpOAuthBtn.style.display = s.mp_token_set ? 'none' : '';
      }


      // Melhor envio — cep_origem e melhor_envio_token_set vêm de colunas no /api/settings
      if(ui.cep_origem) ui.cep_origem.value = s.cep_origem || '';
      if(ui.peso_padrao_kg) ui.peso_padrao_kg.value = b.peso_padrao_kg || '';
      if(ui.melhor_envio_token) ui.melhor_envio_token.value = s.melhor_envio_token_set ? '*** (configurado)' : '';
      const bME = document.getElementById('badge-frete');
      if(bME) {
        const meAtivo = s.melhor_envio_token_set || s.cep_origem || features.mePlatformEnabled;
        if(meAtivo) { bME.textContent = 'Configurado'; bME.className = 'badge badge-success text-xs ml-1'; }
        else { bME.textContent = 'Não configurado'; bME.className = 'badge badge-gray text-xs ml-1'; }
      }

      // ME plataforma — esconde campo de token se a plataforma já gerencia
      if (features.mePlatformEnabled) {
        const mePlatformInfo = document.getElementById('me-platform-info');
        const meTokenSection = document.getElementById('me-token-section');
        if (mePlatformInfo) mePlatformInfo.style.display = 'flex';
        if (meTokenSection) meTokenSection.style.display = 'none';
        if(bME) { bME.textContent = 'Ativo (plataforma)'; bME.className = 'badge badge-success text-xs ml-1'; }
      }

      // Bling — disponível só no plano Elite/Especial (planFeatures.blingEnabled)
      const bBling = document.getElementById('badge-bling');
      const blingOAuthSection = document.getElementById('bling-oauth-section');
      const blingNotAvailable = document.getElementById('bling-not-available');
      if (planFeatures.blingEnabled && features.blingOAuthEnabled) {
        if (blingOAuthSection) blingOAuthSection.style.display = 'block';
        if (blingNotAvailable) blingNotAvailable.style.display = 'none';
        const blingConnectedBox = document.getElementById('bling-connected-box');
        const blingOAuthBtn = document.getElementById('bling-oauth-btn');
        const blingDisconnectBtn = document.getElementById('bling-disconnect-btn');
        if (blingConnectedBox) blingConnectedBox.style.display = s.bling_connected ? 'flex' : 'none';
        if (blingOAuthBtn) blingOAuthBtn.style.display = s.bling_connected ? 'none' : 'inline-flex';
        if (blingDisconnectBtn) blingDisconnectBtn.style.display = s.bling_connected ? 'inline-flex' : 'none';
        if (bBling) {
          if (s.bling_connected) { bBling.textContent = 'Conectado'; bBling.className = 'badge badge-success text-xs'; }
          else { bBling.textContent = 'Não conectado'; bBling.className = 'badge badge-gray text-xs'; }
        }
        _blingConnected = !!s.bling_connected;
        refreshProductBlingAlerts();
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

      // Webhook genérico (Zapier/Make)
      if (ui.webhook_url) ui.webhook_url.value = s.outbound_webhook_url || '';
      if (ui.webhook_enabled) ui.webhook_enabled.checked = s.outbound_webhook_enabled !== false;
      const bWebhook = document.getElementById('badge-webhook');
      if (bWebhook) {
        if (s.outbound_webhook_url) { bWebhook.textContent = 'Configurado'; bWebhook.className = 'badge badge-success text-xs'; }
        else { bWebhook.textContent = 'Não configurado'; bWebhook.className = 'badge badge-gray text-xs'; }
      }
      const webhookSecretDisplay = document.getElementById('webhook_secret_display');
      if (webhookSecretDisplay && !webhookSecretDisplay.dataset.justGenerated) {
        webhookSecretDisplay.value = s.outbound_webhook_secret_set ? '(já gerada — gere novamente para ver o valor)' : '';
      }

      applyGoogleSheetsStatus(s.google_sheets || { connected: false });

      // Horario
      const ho = b.horario_atendimento || { ativo: false };
      if(ui.horario_ativo) {
        ui.horario_ativo.checked = ho.ativo;
        ui.horario_ativo.dispatchEvent(new Event('change'));
      }
      if(ui.horario_inicio) ui.horario_inicio.value = ho.inicio || '08:00';
      if(ui.horario_fim) ui.horario_fim.value = ho.fim || '18:00';
      if(ui.horario_msg_fora) ui.horario_msg_fora.value = ho.mensagem_fora || ho.msg_fora || '';
      
      const diasArr = Array.isArray(ho.dias) ? ho.dias.map(String) : String(ho.dias || '1,2,3,4,5').split(',');
      document.querySelectorAll('.dia-cb').forEach(cb => { cb.checked = diasArr.includes(cb.value); });

      // Followup
      const fu = b.followup || { ativo: false };
      if(ui.followup_ativo) {
        ui.followup_ativo.checked = fu.ativo;
        ui.followup_ativo.dispatchEvent(new Event('change'));
      }
      if(ui.followup_horas) ui.followup_horas.value = fu.horas || 24;
      if(ui.followup_mensagem) ui.followup_mensagem.value = fu.mensagem || '';
      if(ui.alerta_sem_resposta_horas) ui.alerta_sem_resposta_horas.value = b.alerta_sem_resposta_horas || 2;

      // Resumo diário
      const rd = b.resumoDiario || { ativo: false };
      if(ui.resumo_diario_ativo) {
        ui.resumo_diario_ativo.checked = rd.ativo;
        ui.resumo_diario_ativo.dispatchEvent(new Event('change'));
      }
      if(ui.resumo_diario_hora) ui.resumo_diario_hora.value = String(rd.hora ?? 20);

      // Delivery / restaurante
      const dl = b.delivery || { ativo: false };
      if(ui.delivery_ativo) {
        ui.delivery_ativo.checked = dl.ativo;
        ui.delivery_ativo.dispatchEvent(new Event('change'));
      }
      if(ui.delivery_taxa_fixa) ui.delivery_taxa_fixa.value = dl.taxa_fixa != null ? dl.taxa_fixa : '';
      if(ui.delivery_eta_minutos) ui.delivery_eta_minutos.value = dl.eta_minutos || 45;
      if(ui.delivery_raio_km) ui.delivery_raio_km.value = dl.raio_km || 0;
      if(ui.delivery_aceita_retirada) ui.delivery_aceita_retirada.checked = dl.aceita_retirada !== false;
      if(ui.delivery_aceita_mesa) ui.delivery_aceita_mesa.checked = dl.aceita_mesa || false;

      // WhatsApp — link do número servidor
      await loadWhatsappLink();

      // Documentos extras
      await loadDocuments();

      // Uso do plano
      await loadUsage();

      // Templates por nicho
      await loadNicheOptions();

      // Check copy elements
      document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const targetId = e.currentTarget.dataset.target;
          const el = document.getElementById(targetId);
          if(el) {
            navigator.clipboard.writeText(el.value);
            window.Toast?.show('Copiado para área de transferência.', 'success');
          }
        });
      });

    } catch(err) {
      console.error(err);
      window.Toast?.show('Erro ao carregar configurações', 'error');
    }
  }

  if(ui.saveBtn) {
    ui.saveBtn.addEventListener('click', async () => {
      const b = {
        name: ui.business_name?.value,
        tipo_negocio: document.getElementById('tipo_negocio')?.value || 'produtos',
        pedir_identificacao: document.getElementById('pedir_identificacao')?.checked || false,
        atendente_name: ui.atendente_name?.value,
        descricao: ui.descricao?.value,
        tom_de_voz: ui.tomDeVoz?.value,
        frete: ui.frete?.value,
        notify_phone: ui.notify_phone?.value,

        catalog_pdf_url: (ui.catalog_pdf_url?.value || '').trim(),

        produtos: collectProdutos(),
        faqs: collect(ui.faqsList),
        objecoes: collect(ui.objecoesList),
        regras: (ui.regrasInput?.value || '').split('\n').filter(s => s.trim()),
        respostas_rapidas: _respostasRapidas,
        alerta_sem_resposta_horas: Math.min(168, Math.max(1, parseInt(ui.alerta_sem_resposta_horas?.value) || 2)),
      };

      b.horario_atendimento = {
        ativo: ui.horario_ativo?.checked || false,
        inicio: ui.horario_inicio?.value || '08:00',
        fim: ui.horario_fim?.value || '18:00',
        dias: Array.from(document.querySelectorAll('.dia-cb:checked')).map(cb => Number(cb.value)),
        msg_fora: ui.horario_msg_fora?.value || ''
      };

      b.followup = {
        ativo: ui.followup_ativo?.checked || false,
        horas: parseInt(ui.followup_horas?.value) || 24,
        mensagem: ui.followup_mensagem?.value || ''
      };

      b.resumoDiario = {
        ativo: ui.resumo_diario_ativo?.checked || false,
        hora: parseInt(ui.resumo_diario_hora?.value) || 20,
      };

      b.delivery = {
        ativo: ui.delivery_ativo?.checked || false,
        taxa_fixa: parseFloat(ui.delivery_taxa_fixa?.value) || 0,
        eta_minutos: parseInt(ui.delivery_eta_minutos?.value) || 45,
        raio_km: parseFloat(ui.delivery_raio_km?.value) || 0,
        aceita_retirada: ui.delivery_aceita_retirada?.checked !== false,
        aceita_mesa: ui.delivery_aceita_mesa?.checked || false,
      };

      // Campos top-level — salvos em colunas dedicadas (não dentro de business_json)
      const payload = {
        business: b,
        // Mantém colunas de texto sincronizadas
        business_name: ui.business_name?.value || '',
        atendente_name: ui.atendente_name?.value || '',
        notify_phone: ui.notify_phone?.value || '',
      };

      ui.saveBtn.disabled = true;
      ui.saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Salvando...';
      if(window.lucide) window.lucide.createIcons({root: ui.saveBtn});

      try {
        const res = await apiFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if(res.ok) {
          window.Toast?.show('Configurações salvas com sucesso!', 'success');
          ui.saveBtn.disabled = false;
          ui.saveBtn.innerHTML = '<i data-lucide="save"></i> Salvar alterações';
          if(window.lucide) window.lucide.createIcons({root: ui.saveBtn});
        } else {
          const data = await res.json().catch(() => ({}));
          window.Toast?.show(data.error || 'Erro ao salvar.', 'error');
          ui.saveBtn.disabled = false;
          ui.saveBtn.innerHTML = '<i data-lucide="save"></i> Salvar alterações';
          if(window.lucide) window.lucide.createIcons({root: ui.saveBtn});
        }
      } catch(err) {
        window.Toast?.show('Erro de conexão.', 'error');
        ui.saveBtn.disabled = false;
        ui.saveBtn.innerHTML = '<i data-lucide="save"></i> Salvar alterações';
        if(window.lucide) window.lucide.createIcons({root: ui.saveBtn});
      }
    });
  }


  function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Simulador da atendente ────────────────────────────────────────────────
  (function setupSimulator() {
    const openBtn = document.getElementById('setup-open-sim');
    const modal = document.getElementById('simModal');
    const closeBtn = document.getElementById('simCloseBtn');
    const msgsEl = document.getElementById('simMessages');
    const input = document.getElementById('simInput');
    const sendBtn = document.getElementById('simSendBtn');
    const resetBtn = document.getElementById('simResetBtn');
    const starters = document.getElementById('simStarters');
    const insights = document.getElementById('simInsights');
    if (!openBtn || !modal) return;

    let history = [];
    const STAGE_LABELS = {
      novo_contato: 'Contato inicial',
      duvida: 'Tirando dúvidas',
      orcamento: 'Orçamento',
      negociacao: 'Negociação',
      checkout: 'No checkout',
      fechado: 'Venda fechada',
      perdido: 'Perdido',
    };
    const INTENT_LABELS = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };

    function addBubble(role, text) {
      const div = document.createElement('div');
      div.className = 'sim-bubble ' + role;
      div.textContent = text;
      msgsEl.appendChild(div);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      return div;
    }
    function reset() {
      history = [];
      msgsEl.innerHTML = '';
      addBubble('meta', 'Tudo aqui é simulado. Comece com uma sugestão ou escreva como se fosse um cliente.');
      if (insights) {
        insights.innerHTML = '<div class="sim-insights-title"><i data-lucide="scan-search"></i> O que a IA entendeu</div><div class="sim-insights-empty">Envie uma mensagem para ver a etapa do funil, a intenção e as ações previstas.</div>';
        if (window.lucide) window.lucide.createIcons({ root: insights });
      }
    }

    function renderInsights(data) {
      if (!insights) return;
      const items = [
        ['Etapa do funil', STAGE_LABELS[data.etapa] || data.etapa || 'Não identificada'],
        ['Intenção de compra', INTENT_LABELS[data.intencao_compra] || data.intencao_compra || 'Não identificada'],
      ];
      if (data.produto_mencionado) items.push(['Produto identificado', data.produto_mencionado]);
      if (data.enviar_catalogo) items.push(['Ação prevista', 'Enviar catálogo']);
      if (data.precisa_humano) items.push(['Ação prevista', 'Encaminhar para atendimento humano']);
      if (data.pedido?.itens?.length) {
        const total = data.pedido.itens.reduce((sum, item) => sum + ((Number(item.valor_unitario) || 0) * (Number(item.quantidade) || 0)), 0);
        items.push(['Pedido simulado', `${data.pedido.itens.length} item(ns) · R$ ${total.toFixed(2).replace('.', ',')}`]);
      }

      insights.innerHTML = `
        <div class="sim-insights-title"><i data-lucide="scan-search"></i> O que a IA entendeu</div>
        <div class="sim-insights-grid">
          ${items.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}
        </div>
        ${data.resumo ? `<p class="sim-summary"><span>Resumo:</span> ${esc(data.resumo)}</p>` : ''}
        <div class="sim-no-action"><i data-lucide="shield-check"></i> Estas ações são apenas uma prévia; nada foi enviado ou cobrado.</div>`;
      if (window.lucide) window.lucide.createIcons({ root: insights });
    }
    function open() { modal.classList.add('open'); if (!history.length) reset(); setTimeout(() => input?.focus(), 50); }
    function close() { modal.classList.remove('open'); }

    openBtn.addEventListener('click', open);
    closeBtn?.addEventListener('click', close);
    resetBtn?.addEventListener('click', reset);
    starters?.querySelectorAll('[data-message]').forEach((button) => {
      button.addEventListener('click', () => {
        if (sendBtn.disabled) return;
        input.value = button.dataset.message || '';
        send();
      });
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });

    async function send() {
      const text = (input.value || '').trim();
      if (!text) return;
      input.value = '';
      addBubble('user', text);
      history.push({ role: 'user', content: text });
      sendBtn.disabled = true; input.disabled = true;
      const typing = addBubble('meta', 'digitando…');
      try {
        const res = await apiFetch('/api/ai/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history }),
        });
        const data = await res.json().catch(() => ({}));
        typing.remove();
        if (!res.ok) {
          addBubble('meta', data.error || 'Erro ao simular.');
        } else {
          addBubble('assistant', data.mensagem || '(sem resposta)');
          history.push({ role: 'assistant', content: data.mensagem || '' });
          renderInsights(data);
        }
      } catch {
        typing.remove();
        addBubble('meta', 'Erro de conexão.');
      } finally {
        sendBtn.disabled = false; input.disabled = false; input.focus();
      }
    }
    sendBtn?.addEventListener('click', send);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  })();

  // ── Análise da configuração da IA ────────────────────────────────────────
  (function setupAnalyze() {
    const openBtn = document.getElementById('setup-open-analyze');
    const modal = document.getElementById('analyzeModal');
    const closeBtn = document.getElementById('analyzeCloseBtn');
    const runBtn = document.getElementById('analyzeRunBtn');
    const body = document.getElementById('analyzeBody');
    if (!openBtn || !modal) return;

    const AREA_SECTION = { loja: 'business-section', produtos: 'products-section', 'ia-config': 'ia-config-section' };
    const AREA_LABEL = { loja: 'Negócio', produtos: 'Produtos', 'ia-config': 'Configuração da IA', pagamento: 'Pagamento', frete: 'Frete/entrega' };

    function renderResult(data) {
      _officialAnalysis = {
        ...data,
        score: Math.max(0, Math.min(100, Math.round(Number(data.score) || 0))),
      };
      updateProgress();
      const scoreColor = data.score >= 80 ? 'var(--brand-600)' : data.score >= 50 ? 'var(--warning-600, #b45309)' : 'var(--danger-600, #dc2626)';
      const sugestoesHtml = data.sugestoes.length
        ? data.sugestoes.map((s) => {
            const isCritico = s.severidade === 'critico';
            const sectionId = AREA_SECTION[s.area];
            const actionHtml = sectionId
              ? `<button type="button" class="btn btn-secondary step-jump" data-target="${sectionId}" style="padding:4px 10px;font-size:0.75rem;">Corrigir</button>`
              : `<a href="/integrations.html" class="btn btn-secondary" style="padding:4px 10px;font-size:0.75rem;text-decoration:none;">Ir em Integrações</a>`;
            return `
              <div class="flex items-center justify-between gap-2" style="padding:10px 12px;border:1px solid var(--border);border-left:3px solid ${isCritico ? 'var(--danger-500, #ef4444)' : 'var(--warning-500)'};border-radius:8px;margin-bottom:8px;">
                <div style="min-width:0;">
                  <span class="badge ${isCritico ? 'badge-danger' : 'badge-warning'} text-xs" style="margin-right:6px;">${isCritico ? 'Crítico' : 'Recomendado'}</span>
                  <span style="font-size:0.7rem;color:var(--text-secondary);">${esc(AREA_LABEL[s.area] || s.area)}</span>
                  <div style="font-size:0.875rem;margin-top:4px;">${esc(s.mensagem)}</div>
                </div>
                ${actionHtml}
              </div>`;
          }).join('')
        : '<div class="form-hint" style="margin:0;">Nenhuma sugestão — sua configuração está em bom estado. 🎉</div>';

      body.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <div style="font-size:2rem;font-weight:800;color:${scoreColor};">${data.score}</div>
          <div style="font-size:0.875rem;color:var(--text-secondary);">${esc(data.resumo)}</div>
        </div>
        ${sugestoesHtml}
      `;
      if (window.lucide) window.lucide.createIcons({ root: body });

      body.querySelectorAll('.step-jump').forEach((btn) => {
        btn.addEventListener('click', () => {
          modal.classList.remove('open');
          const target = document.getElementById(btn.dataset.target);
          if (!target) return;
          target.classList.add('open');
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
    }

    let analysisRequestId = 0;

    async function enrichWithAnthropic(baseData, requestId) {
      body.insertAdjacentHTML('beforeend', '<div id="anthropicAnalysisStatus" class="form-hint" style="margin-top:10px;"><i data-lucide="loader-2" class="spin" style="width:14px;height:14px;vertical-align:-2px;"></i> Anthropic revisando o conteúdo em segundo plano...</div>');
      if (window.lucide) window.lucide.createIcons({ root: body });
      try {
        const res = await apiFetch('/api/ai/analyze-setup', { method: 'POST' });
        const advisory = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(advisory.error || `HTTP ${res.status}`);
        if (requestId !== analysisRequestId) return;
        renderResult({
          ...advisory,
          score: baseData.score,
          criterios: baseData.criterios,
          score_method: baseData.score_method,
          analyzed_at: baseData.analyzed_at,
        });
        body.insertAdjacentHTML('beforeend', '<div class="form-hint" style="margin-top:10px;color:var(--success-700,#15803d);">✓ Recomendações revisadas pela Anthropic. A porcentagem oficial permaneceu fixa.</div>');
      } catch (err) {
        if (requestId !== analysisRequestId) return;
        document.getElementById('anthropicAnalysisStatus')?.remove();
        body.insertAdjacentHTML('beforeend', '<div class="form-hint" style="margin-top:10px;">A nota oficial foi calculada. As recomendações da Anthropic estão temporariamente indisponíveis.</div>');
      }
    }

    async function runAnalysis() {
      const requestId = ++analysisRequestId;
      runBtn.disabled = true;
      runBtn.innerHTML = '<i data-lucide="loader-2" class="spin" style="width:14px;height:14px;"></i> Calculando...';
      if (window.lucide) window.lucide.createIcons({ root: runBtn });
      body.innerHTML = '<div class="form-hint">Calculando os critérios objetivos...</div>';
      try {
        const res = await apiFetch('/api/ai/setup-readiness', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(`${data.error || 'Erro ao analisar'} (${res.status}${data.code ? ` · ${data.code}` : ''})`);
        renderResult(data);
        void enrichWithAnthropic(data, requestId);
      } catch (e) {
        body.innerHTML = `<div class="form-hint" style="color:var(--danger-600,#dc2626);">${esc(e.message)}</div>`;
      } finally {
        runBtn.disabled = false;
        runBtn.innerHTML = '<i data-lucide="sparkles" style="width:14px;height:14px;"></i> Analisar de novo';
        if (window.lucide) window.lucide.createIcons({ root: runBtn });
      }
    }

    openBtn.addEventListener('click', () => {
      modal.classList.add('open');
      if (_officialAnalysis) renderResult(_officialAnalysis);
    });
    closeBtn?.addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
    runBtn?.addEventListener('click', runAnalysis);
  })();

  if(ui.logoutBtn) ui.logoutBtn.addEventListener('click', async () => {
    await apiFetch('/api/logout', { method: 'POST' });
    location.href = '/';
  });

  if(ui.stopImpersonateBtn) ui.stopImpersonateBtn.addEventListener('click', async () => {
    const r = await apiFetch('/api/admin/stop-impersonate', { method: 'POST' });
    const j = await r.json();
    location.href = j.redirect || '/admin.html';
  });

  // Excluir conta (LGPD — direito de eliminação do titular sobre a própria conta).
  (() => {
    const openBtn = document.getElementById('deleteAccountBtn');
    const modal = document.getElementById('deleteAccountModal');
    const closeBtn = document.getElementById('deleteAccountClose');
    const confirmBtn = document.getElementById('deleteAccountConfirmBtn');
    const passwordInput = document.getElementById('deleteAccountPassword');
    if (!openBtn || !modal) return;

    openBtn.addEventListener('click', () => {
      passwordInput.value = '';
      modal.classList.add('open');
    });
    closeBtn?.addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });

    confirmBtn?.addEventListener('click', async () => {
      const password = passwordInput.value;
      if (!password) { window.Toast?.show('Digite sua senha para confirmar.', 'error'); return; }
      confirmBtn.disabled = true;
      try {
        const res = await apiFetch('/api/account', { method: 'DELETE', body: JSON.stringify({ password }) });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          window.location.href = '/landing.html';
        } else {
          window.Toast?.show(data.error || 'Erro ao excluir conta.', 'error');
          confirmBtn.disabled = false;
        }
      } catch {
        window.Toast?.show('Erro de conexão.', 'error');
        confirmBtn.disabled = false;
      }
    });
  })();

  loadSettings();
});
