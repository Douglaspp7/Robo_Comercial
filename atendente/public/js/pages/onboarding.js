document.addEventListener('DOMContentLoaded', () => {
  const KEY = 'zapien_onboarding_v2';
  const TOTAL_STEPS = 6;
  const params = new URLSearchParams(location.search);
  if (params.get('email') === 'verified' || params.get('restart') === '1') {
    localStorage.removeItem(KEY);
  }

  const q = (selector) => document.querySelector(selector);
  const qa = (selector) => [...document.querySelectorAll(selector)];
  const state = JSON.parse(localStorage.getItem(KEY) || '{}');
  let current = Math.min(TOTAL_STEPS, Math.max(1, Number(state.step) || 1));
  let settings = null;

  const TYPE_LABELS = {
    loja: 'Loja e produtos',
    servicos: 'Serviços',
    alimentacao: 'Alimentação',
    digital: 'Produtos digitais',
  };
  const TYPE_EXAMPLES = {
    loja: {
      placeholder: 'Ex.: Vendo roupas femininas e entrego na Baixada Santista.',
      preview: 'Olá! Posso ajudar você a encontrar o produto ideal. O que está procurando?',
    },
    servicos: {
      placeholder: 'Ex.: Faço manutenção de ar-condicionado em Santos e região.',
      preview: 'Olá! Vou entender o que você precisa e ajudar com seu atendimento. Como posso ajudar?',
    },
    alimentacao: {
      placeholder: 'Ex.: Somos uma pizzaria com delivery todos os dias à noite.',
      preview: 'Olá! Posso mostrar as opções e ajudar com seu pedido. O que você gostaria hoje?',
    },
    digital: {
      placeholder: 'Ex.: Vendo um curso online para confeiteiras começarem a vender.',
      preview: 'Olá! Posso explicar como funciona e ajudar você a escolher a melhor opção. O que deseja saber?',
    },
  };
  const PRODUCT_LABELS = {
    catalogo: 'Enviar catálogo',
    manual: 'Cadastrar aos poucos',
    depois: 'Decidir depois',
  };

  const els = {
    label: q('#stepLabel'),
    progress: q('#progressLabel'),
    bar: q('#progressBar'),
    back: q('#backBtn'),
    skip: q('#skipBtn'),
    next: q('#nextBtn'),
    status: q('#statusMessage'),
    business: q('#businessName'),
    description: q('#description'),
    assistant: q('#assistantName'),
    preview: q('#previewName'),
    previewText: q('#previewText'),
    summary: q('#summaryList'),
    finishNote: q('#finishNote'),
    testChatEmpty: q('#testChatEmpty'),
    testMessages: q('#testMessages'),
    testTyping: q('#testTyping'),
    testInput: q('#testInput'),
    testSend: q('#testSendBtn'),
  };
  const simulationMessages = [];

  function persist(extra = {}) {
    Object.assign(state, extra, { step: current, updatedAt: new Date().toISOString() });
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function message(text, type = 'success') {
    els.status.textContent = text;
    els.status.className = 'status-message show ' + type;
    setTimeout(() => { els.status.className = 'status-message'; }, 3500);
  }

  async function csrf() {
    const response = await fetch('/api/csrf-token');
    if (!response.ok) throw new Error('Sua sessão expirou. Entre novamente.');
    return (await response.json()).token;
  }

  function selectedTone() {
    return q('[name=tone]:checked')?.value || '';
  }

  function applySelections() {
    qa('[data-business-type]').forEach((button) => {
      button.classList.toggle('selected', button.dataset.businessType === state.businessType);
      button.setAttribute('aria-pressed', String(button.dataset.businessType === state.businessType));
    });
    qa('[data-product-method]').forEach((button) => {
      button.classList.toggle('selected', button.dataset.productMethod === state.productMethod);
      button.setAttribute('aria-pressed', String(button.dataset.productMethod === state.productMethod));
    });
    const example = TYPE_EXAMPLES[state.businessType] || TYPE_EXAMPLES.loja;
    els.description.placeholder = example.placeholder;
  }

  function updatePreview() {
    const example = TYPE_EXAMPLES[state.businessType] || TYPE_EXAMPLES.loja;
    els.preview.textContent = els.assistant.value.trim() || 'Ana';
    els.previewText.textContent = example.preview;
  }

  async function load() {
    const response = await fetch('/api/settings');
    if (response.status === 401) {
      location.href = '/login.html';
      return;
    }
    if (!response.ok) throw new Error('Não foi possível carregar sua conta.');

    settings = await response.json();
    const existingType = settings.business?.tipo_negocio;
    state.businessType = state.businessType || (TYPE_LABELS[existingType] ? existingType : '');
    els.business.value = state.businessName || (settings.business_name === 'Meu Negócio' ? '' : settings.business_name) || '';
    els.description.value = state.description || settings.business?.descricao || '';
    els.assistant.value = state.assistantName || settings.atendente_name || 'Ana';

    const savedTone = state.tone || settings.business?.tomDeVoz;
    const toneRadio = qa('[name=tone]').find((radio) => radio.value === savedTone);
    if (toneRadio) toneRadio.checked = true;

    applySelections();
    updatePreview();
    render();
  }

  async function saveInterview() {
    if (!settings) return;
    const business = {
      ...(settings.business || {}),
      tipo_negocio: state.businessType || settings.business?.tipo_negocio || '',
      descricao: els.description.value.trim(),
      tomDeVoz: selectedTone(),
    };
    const body = {
      business_name: els.business.value.trim() || settings.business_name || 'Meu Negócio',
      atendente_name: els.assistant.value.trim() || 'Ana',
      checkout_url: settings.checkout_url || '',
      notify_phone: settings.notify_phone || '',
      business,
    };
    const token = await csrf();
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível salvar agora.');
    settings = { ...settings, ...body };
    persist({
      businessName: els.business.value.trim(),
      description: business.descricao,
      assistantName: body.atendente_name,
      tone: business.tomDeVoz,
    });
  }

  function appendTestMessage(role, content) {
    if (els.testChatEmpty) els.testChatEmpty.hidden = true;
    const row = document.createElement('div');
    row.className = 'msg-row ' + (role === 'user' ? 'msg-row-user' : 'msg-row-ai');
    if (role !== 'user') {
      const avatar = document.createElement('img');
      avatar.src = '/assets/ai-avatar.png?v=1';
      avatar.className = 'ai-avatar-sm';
      avatar.alt = els.assistant ? (els.assistant.value.trim() || 'IA') : 'IA';
      row.appendChild(avatar);
    }
    const bubble = document.createElement('div');
    bubble.className = 'test-message ' + (role === 'user' ? 'is-user' : 'is-assistant');
    const text = document.createElement('p');
    text.textContent = content;
    bubble.appendChild(text);
    row.appendChild(bubble);
    els.testMessages.appendChild(row);
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function runSimulation(rawMessage) {
    const content = String(rawMessage || '').trim();
    if (!content || els.testSend.disabled) return;

    if (!settings) {
      message('Aguarde sua conta terminar de carregar.', 'error');
      return;
    }

    els.testInput.value = '';
    els.testSend.disabled = true;
    els.testInput.disabled = true;
    els.testTyping.hidden = false;
    appendTestMessage('user', content);
    simulationMessages.push({ role: 'user', content });

    try {
      await saveInterview();
      const token = await csrf();
      const response = await fetch('/api/ai/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({ messages: simulationMessages }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível testar agora.');
      const answer = data.mensagem || 'Não consegui responder agora. Você pode tentar outra pergunta.';
      simulationMessages.push({ role: 'assistant', content: answer });
      appendTestMessage('assistant', answer);
      persist({ testDone: true, skipped5: false });
      els.next.disabled = false;
      els.next.textContent = 'Continuar';
    } catch (error) {
      simulationMessages.pop();
      message(error.message, 'error');
    } finally {
      els.testTyping.hidden = true;
      els.testSend.disabled = false;
      els.testInput.disabled = false;
      els.testInput.focus();
    }
  }

  function renderSummary() {
    const rows = [
      ['Tipo de negócio', TYPE_LABELS[state.businessType] || 'Completar depois'],
      ['Negócio', els.business.value.trim() || els.description.value.trim() ? 'Informado' : 'Completar depois'],
      ['Produtos', PRODUCT_LABELS[state.productMethod] || 'Completar depois'],
      ['Atendente', els.assistant.value.trim() || 'Ana'],
      ['Teste da IA', state.testDone ? 'Realizado' : 'Pulado — testar depois'],
    ];
    els.summary.innerHTML = rows.map(([label, value]) => {
      const status = value.includes('depois') ? 'pending' : 'done';
      return '<li><strong>' + escapeHtml(label) + '</strong><span class="' + status + '">' + escapeHtml(value) + '</span></li>';
    }).join('');

    const nextByMethod = {
      catalogo: '<strong>Próximo passo:</strong> enviar seu catálogo na área de produtos.',
      manual: '<strong>Próximo passo:</strong> cadastrar seu primeiro produto ou serviço.',
      depois: '<strong>Próximo passo:</strong> testar como sua atendente conversa.',
    };
    els.finishNote.innerHTML = nextByMethod[state.productMethod] || '<strong>Próximo passo:</strong> adicionar seu primeiro produto ou serviço.';
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }

  function render() {
    qa('.wizard-step').forEach((step) => {
      step.classList.toggle('active', Number(step.dataset.step) === current);
    });
    const percent = Math.round((current / TOTAL_STEPS) * 100);
    els.label.textContent = 'Passo ' + current + ' de ' + TOTAL_STEPS;
    els.progress.textContent = percent + '%';
    els.bar.style.width = percent + '%';
    els.back.style.visibility = current === 1 ? 'hidden' : 'visible';
    els.skip.style.visibility = current === TOTAL_STEPS ? 'hidden' : 'visible';
    els.skip.textContent = current === 5 ? 'Pular teste' : 'Fazer depois';
    els.next.textContent = current === TOTAL_STEPS ? 'Ir para o painel' : 'Continuar';
    els.next.disabled = current === 5 && !state.testDone;
    if (current === 5) updatePreview();
    if (current === TOTAL_STEPS) renderSummary();
    persist();
  }

  async function completeOnboarding() {
    const token = await csrf();
    const response = await fetch('/api/onboarding/complete', {
      method: 'POST',
      headers: { 'X-CSRF-Token': token },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir agora.');
    persist({ completed: true, step: TOTAL_STEPS });
    location.href = data.redirect || '/dashboard.html?onboarding=done';
  }

  async function advance(skip = false) {
    if (!skip && current === 1 && !state.businessType) {
      message('Escolha o tipo de negócio para continuar.', 'error');
      return;
    }
    if (!skip && current === 3 && !state.productMethod) {
      message('Escolha uma opção para continuar.', 'error');
      return;
    }

    els.next.disabled = true;
    try {
      if (!skip && [2, 4].includes(current)) await saveInterview();
      if (skip) persist({ ['skipped' + current]: true, ...(current === 5 ? { testDone: false } : {}) });
      if (current < TOTAL_STEPS) {
        current += 1;
        render();
      } else {
        await saveInterview();
        await completeOnboarding();
      }
    } catch (error) {
      message(error.message, 'error');
    } finally {
      els.next.disabled = false;
    }
  }

  qa('[data-business-type]').forEach((button) => {
    button.addEventListener('click', () => {
      state.businessType = button.dataset.businessType;
      persist({ businessType: state.businessType });
      applySelections();
    });
  });

  qa('[data-product-method]').forEach((button) => {
    button.addEventListener('click', () => {
      state.productMethod = button.dataset.productMethod;
      persist({ productMethod: state.productMethod });
      applySelections();
    });
  });

  els.next.addEventListener('click', () => advance(false));
  els.skip.addEventListener('click', () => advance(true));
  els.back.addEventListener('click', () => {
    if (current > 1) {
      current -= 1;
      render();
    }
  });
  q('#leaveBtn').addEventListener('click', () => {
    persist();
    location.href = '/dashboard.html?onboarding=pending';
  });
  els.assistant.addEventListener('input', updatePreview);
  qa('[data-test-message]').forEach((button) => {
    button.addEventListener('click', () => runSimulation(button.dataset.testMessage));
  });
  els.testSend.addEventListener('click', () => runSimulation(els.testInput.value));
  els.testInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSimulation(els.testInput.value);
    }
  });

  load().catch((error) => message(error.message, 'error'));
});
