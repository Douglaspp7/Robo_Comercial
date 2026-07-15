/**
 * Plans Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const ui = {
    logoutBtn: document.getElementById('logoutBtn'),
    adminLink: document.getElementById('adminLink'),
    plansGrid: document.getElementById('plansGrid'),
    pageSub: document.getElementById('pageSub'),
    trialBanner: document.getElementById('trialBanner'),
    billingPeriodToggle: document.getElementById('billingPeriodToggle'),
  };

  // Dias restantes até trial_ends_at (ISO). null se sem data, nunca negativo.
  function daysUntil(iso) {
    if (!iso) return null;
    const end = new Date(iso).getTime();
    if (!Number.isFinite(end)) return null;
    const diffMs = end - Date.now();
    return Math.max(0, Math.ceil(diffMs / 86400000));
  }

  function renderTrialBanner(me) {
    if (!ui.trialBanner) return;
    const status = me.subscription?.status;
    if (status !== 'trial') { ui.trialBanner.style.display = 'none'; return; }
    const dias = daysUntil(me.trial_ends_at);
    const diasTxt = dias === null
      ? ''
      : dias === 0
        ? '<span class="trial-banner-days">termina hoje</span>'
        : dias === 1
          ? '<span class="trial-banner-days">termina amanhã</span>'
          : `<span class="trial-banner-days">termina em ${dias} dias</span>`;
    ui.trialBanner.innerHTML = `
      <span class="trial-banner-icon">✦</span>
      <span>Voc&ecirc; est&aacute; no <strong>teste gr&aacute;tis</strong> com todos os recursos do plano <strong>Elite</strong>${diasTxt ? ' — ' + diasTxt : ''}. Escolha um plano abaixo para continuar depois que o teste terminar.</span>
    `;
    ui.trialBanner.style.display = 'flex';
  }

  let _csrfToken = null;
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

  const PLAN_FEATURES = {
    essencial: {
      desc: 'Para começar a vender com IA no WhatsApp.',
      highlights: ['IA no WhatsApp', 'Produtos e catálogo', 'Mercado Pago', 'Atendimento humano'],
      details: ['1.000 respostas de IA por mês', 'Até 30 produtos no catálogo', 'Catálogo PDF até 5MB e 25 páginas', 'Base pesquisável com 25 páginas', '50 MB de armazenamento', 'FAQs e objeções configuráveis', 'Sandbox para testar o bot'],
      missing: ['Follow-up automático', 'Transcrição de áudio', 'Documentos extras', 'Frete real Melhor Envio'],
    },
    pro: {
      desc: 'Para não perder vendas.',
      highlights: ['Follow-up automático', 'Transcrição de áudio', 'Catálogo por PDF', 'Mais produtos'],
      details: ['Tudo do Essencial', '2.000 respostas de IA por mês', 'Até 100 produtos + 150 MB de armazenamento', 'Catálogo PDF até 5MB e 25 páginas', '5 documentos extras (5MB e 25 páginas cada)', 'Base pesquisável com 50 páginas', 'Notas internas por contato'],
      missing: ['Cálculo de frete real Melhor Envio', 'Suporte prioritário'],
    },
    elite: {
      desc: 'Para lojas com estoque, frete e integrações.',
      highlights: ['Melhor Envio', 'Bling', 'Nuvemshop', 'Hotmart', 'Maior volume'],
      details: ['Tudo do Pro', '5.000 respostas de IA por mês', 'Até 300 produtos + 500 MB de armazenamento', 'Catálogo PDF até 5MB e 25 páginas', '20 documentos extras (5MB e 25 páginas cada)', 'Base pesquisável com 100 páginas', '1.000 min de transcrição de áudio/mês', 'Suporte prioritário via WhatsApp'],
      missing: [],
    },
    especial: {
      desc: 'Para operações de alto volume.',
      highlights: ['Limites maiores', 'Suporte dedicado', 'Configuração sob medida'],
      details: ['Tudo do Elite', '10.000 respostas de IA por mês', 'Até 1.000 produtos + 1 GB de armazenamento', 'Catálogo PDF até 5MB e 25 páginas', '50 documentos extras (5MB e 25 páginas cada)', 'Base pesquisável com limite personalizado', '5.000 min de transcrição de áudio/mês'],
      missing: [],
    },
  };

  const PLAN_LABELS = { essencial: 'Essencial', pro: 'Pro', elite: 'Elite', especial: 'Especial' };
  // Fallback caso /api/plans falhe — mesmos valores de src/plans.js PLAN_LIMITS.
  const PLAN_PRICES_FALLBACK = { essencial: 97, pro: 149, elite: 297, especial: 497 };
  const BILLING_PERIODS_FALLBACK = {
    mensal: { label: 'Mensal', months: 1, discount: 0 },
    semestral: { label: 'Semestral', months: 6, discount: 0.10 },
    anual: { label: 'Anual', months: 12, discount: 0.20 },
  };

  let currentPlan = null;
  let mpBillingEnabled = false;
  let isLoggedIn = false;
  let supportPhone = '';
  let planPrices = { ...PLAN_PRICES_FALLBACK };
  let billingPeriods = BILLING_PERIODS_FALLBACK;
  let selectedPeriod = 'mensal';

  /** Espelha src/plans.js getPeriodPricing — mesma matemática, pro preço bater no front e no backend. */
  function getPeriodPricing(monthlyPrice, periodId) {
    const period = billingPeriods[periodId] || billingPeriods.mensal;
    const totalCheio = monthlyPrice * period.months;
    const total = Math.round(totalCheio * (1 - period.discount) * 100) / 100;
    const equivalenteMensal = Math.round((total / period.months) * 100) / 100;
    return { months: period.months, discount: period.discount, totalCheio, total, equivalenteMensal };
  }

  function fmtBRL(value) {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function load() {
    try {
      const [meRes, metaRes, plansRes] = await Promise.all([
        fetch('/api/me').catch(() => null),
        fetch('/api/meta').catch(() => null),
        fetch('/api/plans').catch(() => null),
      ]);

      if (metaRes?.ok) {
        const meta = await metaRes.json();
        supportPhone = meta.supportPhone || '';
      }

      if (plansRes?.ok) {
        const plansData = await plansRes.json();
        if (plansData.billingPeriods) billingPeriods = plansData.billingPeriods;
        if (plansData.plans) {
          planPrices = Object.fromEntries(Object.entries(plansData.plans).map(([id, p]) => [id, p.price]));
        }
      }

      if (meRes?.ok) {
        const me = await meRes.json();
        currentPlan = me.plan || 'essencial';
        isLoggedIn = true;
        mpBillingEnabled = me.features?.mpBillingEnabled;

        window.ZapUI.setupProfileDropdown(me, apiFetch);
        window.ZapUI.setupSupportLink(me.supportPhone);
        if (me.is_admin && ui.adminLink) ui.adminLink.classList.remove('hidden');
        if (!me.is_admin) { const s = document.getElementById('supportBtn'); if (s) s.style.display = ''; }

        if (me.subscription?.status === 'ativo') {
          ui.pageSub.textContent = `Seu plano atual: ${PLAN_LABELS[currentPlan] || currentPlan}. Faça upgrade para desbloquear mais recursos.`;
        } else if (me.subscription?.status === 'trial') {
          // Durante o teste, o plano efetivo é Elite (ver plans.js effectivePlanId),
          // então o texto padrão "seu plano atual" enganava. Mostramos só a chamada
          // para escolher; o banner acima detalha os dias restantes.
          ui.pageSub.textContent = 'Escolha o plano que continuará ativo quando o teste grátis terminar.';
        }
        renderTrialBanner(me);
      }

      renderPlans();

      // Auto-subscribe se veio da landing
      const preselect = new URLSearchParams(location.search).get('plan');
      if (preselect && isLoggedIn && mpBillingEnabled) {
        sessionStorage.removeItem('chosen_plan');
        history.replaceState({}, '', '/plans.html');
        setTimeout(() => window.subscribe(preselect), 400);
      }
    } catch(err) {
      console.error(err);
      renderPlans(); // Render defaults
    }
  }

  ui.billingPeriodToggle?.addEventListener('click', (e) => {
    const btn = e.target.closest('.billing-period-btn');
    if (!btn) return;
    selectedPeriod = btn.dataset.period;
    ui.billingPeriodToggle.querySelectorAll('.billing-period-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    renderPlans();
  });

  function renderPlans() {
    if(!ui.plansGrid) return;
    
    const planIds = ['essencial', 'pro', 'elite', 'especial'];
    ui.plansGrid.innerHTML = planIds.map((id) => {
      const info = PLAN_FEATURES[id];
      const isPopular = id === 'pro';
      const isContactOnly = id === 'especial';
      const isCurrent = id === currentPlan && isLoggedIn;
      const pricing = getPeriodPricing(planPrices[id] ?? PLAN_PRICES_FALLBACK[id], selectedPeriod);

      const featHtml = info.highlights.map((f) => `
        <div class="plan-feature-item">
          <i data-lucide="check" class="feature-icon included"></i>
          <span>${f}</span>
        </div>
      `).join('');

      const detailsHtml = info.details.map((f) => `
        <div class="plan-feature-item">
          <i data-lucide="check" class="feature-icon included"></i>
          <span>${f}</span>
        </div>
      `).join('');

      const missingHtml = info.missing.map((f) => `
        <div class="plan-feature-item missing">
          <i data-lucide="minus" class="feature-icon missing"></i>
          <span>${f}</span>
        </div>
      `).join('');

      let btnHtml;
      if (isContactOnly) {
        const waHref = supportPhone
          ? `https://wa.me/${supportPhone}?text=${encodeURIComponent('Olá! Quero saber mais sobre o plano Especial do Zapien.')}`
          : '#';
        btnHtml = `<a href="${waHref}" target="_blank" rel="noopener" class="btn btn-secondary w-full">Fale com vendas</a>`;
      } else if (isCurrent) {
        btnHtml = `<button class="btn btn-secondary w-full" disabled style="opacity:.6;cursor:default;">Plano atual ✓</button>`;
      } else if (!isLoggedIn) {
        btnHtml = `<a href="/login.html#signup" class="btn ${isPopular ? 'btn-primary' : 'btn-secondary'} w-full">Começar grátis</a>`;
      } else {
        btnHtml = `<button class="btn ${isPopular ? 'btn-primary' : 'btn-secondary'} w-full" onclick="subscribe('${id}', '${selectedPeriod}')" id="btn-sub-${id}">
          ${id === 'essencial' ? 'Escolher Essencial' : `Fazer upgrade para ${PLAN_LABELS[id]}`}
        </button>`;
      }

      return `
        <div class="plan-card ${isPopular ? 'popular' : ''}">
          ${isPopular ? '<div class="plan-badge">Recomendado</div>' : ''}
          <div class="plan-name">
            ${PLAN_LABELS[id]}
            ${isCurrent ? '<span class="current-badge">ATUAL</span>' : ''}
          </div>
          <div class="plan-desc">${info.desc}</div>
          <div class="plan-price-group">
            ${isContactOnly ? '<div style="font-size:0.85rem;font-weight:500;color:var(--text-secondary);">A partir de</div>' : ''}
            ${pricing.discount > 0 ? `<div class="plan-price-old">de R$${fmtBRL(pricing.totalCheio / pricing.months)}</div>` : ''}
            <div class="plan-price">
              <span class="plan-currency">R$</span>
              ${fmtBRL(pricing.equivalenteMensal)}
              <span class="plan-period">/mês</span>
            </div>
            ${pricing.discount > 0 ? `<div class="plan-price-cycle-note">Cobrado R$${fmtBRL(pricing.total)} a cada ${pricing.months} meses</div>` : ''}
          </div>
          <div class="plan-features">
            ${featHtml}
          </div>
          <details class="plan-details">
            <summary>Ver todos os recursos e limites</summary>
            <div class="plan-features plan-features-details">
              ${detailsHtml}
              ${missingHtml ? `<div class="plan-details-label">Não inclui</div>${missingHtml}` : ''}
            </div>
          </details>
          ${btnHtml}
        </div>
      `;
    }).join('');
    
    if(window.lucide) window.lucide.createIcons({root: ui.plansGrid});
  }

  window.subscribe = async (planId, period) => {
    if (!isLoggedIn) { location.href = '/login.html#signup'; return; }
    
    if (!mpBillingEnabled) {
      if (supportPhone) {
        window.open(`https://wa.me/${supportPhone}?text=${encodeURIComponent('Olá! Quero assinar o Zapien.')}`, '_blank');
      } else {
        window.Toast?.show('Assinatura temporariamente indisponível. Fale com o suporte.', 'error');
      }
      return;
    }
    
    const btn = document.getElementById(`btn-sub-${planId}`);
    if (btn) { 
      btn.disabled = true; 
      btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Aguarde...'; 
      if(window.lucide) window.lucide.createIcons({root: btn});
    }
    
    try {
      const res = await apiFetch('/api/plans/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, period: period || selectedPeriod }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar assinatura');
      location.href = data.init_point;
    } catch (e) {
      window.Toast?.show(e.message, 'error');
      if (btn) { 
        btn.disabled = false; 
        btn.textContent = `Fazer upgrade`; 
      }
    }
  };

  if(ui.logoutBtn) {
    ui.logoutBtn.addEventListener('click', async () => {
      await apiFetch('/api/logout', { method: 'POST' });
      location.href = '/';
    });
  }

  load();
});
