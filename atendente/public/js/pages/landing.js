document.addEventListener('DOMContentLoaded', () => {
  // Mobile menu toggle (if added in HTML)
  const mobileBtn = document.querySelector('.mobile-menu-btn');
  const nav = document.querySelector('.header-nav');
  if(mobileBtn && nav) {
    mobileBtn.addEventListener('click', () => {
      nav.style.display = nav.style.display === 'flex' ? 'none' : 'flex';
    });
  }

  // Handle plan buttons
  document.querySelectorAll('[data-plan]').forEach((el) => {
    el.addEventListener('click', (e) => {
      sessionStorage.setItem('chosen_plan', el.dataset.plan);
    });
  });

  // Check if logged in
  fetch('/api/me').then((r) => {
    if (r.ok) location.href = '/dashboard.html';
  }).catch(() => {});

  // Plano Especial — CTA leva direto para o WhatsApp de vendas (sem checkout self-service).
  const especialLink = document.getElementById('especial-contact-link');
  if (especialLink) {
    fetch('/api/meta').then((r) => r.ok ? r.json() : null).then((meta) => {
      if (meta?.supportPhone) {
        especialLink.href = `https://wa.me/${meta.supportPhone}?text=${encodeURIComponent('Olá! Quero saber mais sobre o plano Especial do Zapien.')}`;
        especialLink.target = '_blank';
        especialLink.rel = 'noopener';
      }
    }).catch(() => {});
  }

  // ---------- Scroll reveal ----------
  initScrollReveal();
  initHeroParallax();
});

function initScrollReveal() {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const selectors = [
    '.hero-badge', '.hero-title', '.hero-subtitle', '.hero-actions', '.hero-trust', '.hero-visual',
    '.trust-item',
    '.section-header',
    '.feature-card',
    '.split-media', '.split-content',
    '.showcase-card',
    '.how-media', '.demo-step',
    '.pricing-card',
    '.faq-item',
    '.cta-container'
  ];

  const els = Array.from(document.querySelectorAll(selectors.join(',')));
  if (!els.length) return;

  // Cards e mídia ganham um leve zoom ao surgir
  const scaleTargets = new Set(['feature-card', 'showcase-card', 'pricing-card', 'split-media', 'how-media', 'hero-visual']);

  if (prefersReduced) {
    els.forEach((el) => el.classList.add('reveal-in'));
    return;
  }

  // Agrupa por pai para aplicar atraso escalonado (efeito cascata)
  const byParent = new Map();
  els.forEach((el) => {
    el.classList.add('reveal');
    if ([...scaleTargets].some((c) => el.classList.contains(c))) {
      el.classList.add('reveal-scale');
    }
    const parent = el.parentElement;
    const arr = byParent.get(parent) || [];
    arr.push(el);
    byParent.set(parent, arr);
  });

  byParent.forEach((arr) => {
    if (arr.length > 1) {
      arr.forEach((el, i) => el.style.setProperty('--reveal-delay', `${Math.min(i * 90, 450)}ms`));
    }
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('reveal-in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  els.forEach((el) => io.observe(el));
}

function initHeroParallax() {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) return;

  const layers = [
    { el: document.querySelector('.hero-visual img'), speed: -0.04 },
    { el: document.querySelector('.split-media img'), speed: 0.05 },
    { el: document.querySelector('.how-media img'), speed: 0.05 }
  ].filter((l) => l.el);

  if (!layers.length) return;

  let ticking = false;
  const update = () => {
    const vh = window.innerHeight;
    layers.forEach(({ el, speed }) => {
      const rect = el.getBoundingClientRect();
      const offset = (rect.top + rect.height / 2 - vh / 2) * speed;
      el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    });
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });

  update();
}
