document.addEventListener('DOMContentLoaded', () => {
  // Mostra botão Google se disponível; trata erros vindos do callback OAuth
  fetch('/api/auth/google/available').then(r => r.json()).then(d => {
    if (d.available) {
      const sec = document.getElementById('googleSection');
      if (sec) sec.style.display = 'block';
    }
  }).catch(() => {});

  const params = new URLSearchParams(window.location.search);
  const oauthError = params.get('error');
  if (oauthError) {
    const msgs = {
      google_failed: 'Não foi possível entrar com o Google. Tente novamente.',
      google_unavailable: 'Login com Google não está disponível no momento.',
      google_email_unverified: 'O e-mail da conta Google não está verificado.',
      verification_invalid: 'O link de confirmação é inválido ou expirou. Solicite um novo link.',
    };
    const alertEl = document.getElementById('errorAlert');
    if (alertEl) {
      alertEl.textContent = msgs[oauthError] || 'Erro ao entrar com o Google.';
      alertEl.style.display = 'block';
    }
  }

  const ui = {
    title: document.getElementById('loginTitle'),
    subtitle: document.getElementById('loginSubtitle'),
    submitBtn: document.getElementById('submitBtn'),
    toggleText: document.getElementById('toggleText'),
    toggleLink: document.getElementById('toggleLink'),
    forgotLink: document.getElementById('forgotLink'),
    errorAlert: document.getElementById('errorAlert'),
    successAlert: document.getElementById('successAlert'),
    signupBadge: document.getElementById('signupBadge'),
    form: document.getElementById('loginForm'),
    email: document.getElementById('email'),
    emailGroup: document.getElementById('emailGroup'),
    password: document.getElementById('password'),
    passwordGroup: document.getElementById('passwordGroup'),
    passwordLabel: document.getElementById('passwordLabel'),
    togglePwd: document.getElementById('togglePwd'),
    termsGroup: document.getElementById('termsGroup'),
    acceptTerms: document.getElementById('acceptTerms'),
    footer: document.querySelector('.login-footer'),
  };

  // Modos:
  //   login  → e-mail + senha
  //   signup → e-mail + senha + termos
  //   forgot → e-mail (envia link)
  //   reset  → nova senha (token vem do hash #reset=...)
  function parseHash() {
    const h = window.location.hash || '';
    if (h.startsWith('#reset=')) return { mode: 'reset', token: decodeURIComponent(h.slice(7)) };
    if (h === '#signup') return { mode: 'signup' };
    if (h === '#forgot') return { mode: 'forgot' };
    return { mode: 'login' };
  }

  let state = parseHash();

  function hide(el) { if (el) el.style.display = 'none'; }
  function show(el, display = 'block') { if (el) el.style.display = display; }

  // Medição de conversão (first-party, anônima) — nunca envia e-mail/senha.
  const track = (name, props) => { if (window.zapienTrack) window.zapienTrack(name, props); };
  let signupViewTracked = false;
  let signupStartedTracked = false;

  function render() {
    ui.errorAlert.style.display = 'none';
    ui.successAlert.style.display = 'none';
    hide(ui.signupBadge);
    hide(ui.termsGroup);

    if (state.mode === 'signup' && !signupViewTracked) {
      signupViewTracked = true;
      track('signup_view');
    }

    switch (state.mode) {
      case 'signup':
        ui.title.textContent = 'Crie sua conta';
        ui.subtitle.textContent = 'Comece a automatizar suas vendas em poucos minutos.';
        ui.submitBtn.textContent = 'Criar conta grátis';
        ui.toggleText.textContent = 'Já tem uma conta?';
        ui.toggleLink.textContent = 'Entrar';
        ui.passwordLabel.textContent = 'Senha';
        ui.password.autocomplete = 'new-password';
        ui.password.placeholder = 'Mínimo 8 caracteres';
        ui.password.setAttribute('minlength', '8');
        show(ui.emailGroup);
        show(ui.passwordGroup);
        show(ui.signupBadge, 'flex');
        show(ui.termsGroup);
        show(ui.forgotLink, 'inline');
        show(ui.footer, 'block');
        break;
      case 'forgot':
        ui.title.textContent = 'Recuperar senha';
        ui.subtitle.textContent = 'Informe seu e-mail e enviaremos um link para redefinir a senha.';
        ui.submitBtn.textContent = 'Enviar link de recuperação';
        ui.toggleText.textContent = 'Lembrou a senha?';
        ui.toggleLink.textContent = 'Voltar ao login';
        show(ui.emailGroup);
        hide(ui.passwordGroup);
        show(ui.footer, 'block');
        break;
      case 'reset':
        ui.title.textContent = 'Definir nova senha';
        ui.subtitle.textContent = 'Escolha uma nova senha para sua conta.';
        ui.submitBtn.textContent = 'Salvar nova senha';
        ui.passwordLabel.textContent = 'Nova senha';
        ui.password.autocomplete = 'new-password';
        ui.password.placeholder = 'Mínimo 8 caracteres';
        ui.password.setAttribute('minlength', '8');
        hide(ui.emailGroup);
        show(ui.passwordGroup);
        hide(ui.forgotLink);
        // No fluxo de reset o rodapé "Já tem conta?/Criar conta" só confunde.
        hide(ui.footer);
        if (!state.token) {
          ui.errorAlert.textContent = 'Link inválido. Peça um novo em "Esqueceu a senha?".';
          ui.errorAlert.style.display = 'block';
        }
        break;
      default: // login
        ui.title.textContent = 'Bem-vindo de volta';
        ui.subtitle.textContent = 'Entre com seus dados para acessar o painel.';
        ui.submitBtn.textContent = 'Entrar no painel';
        ui.toggleText.textContent = 'Não tem uma conta?';
        ui.toggleLink.textContent = 'Criar conta';
        ui.passwordLabel.textContent = 'Senha';
        ui.password.autocomplete = 'current-password';
        ui.password.placeholder = 'Sua senha';
        // Em login, senhas antigas podem ter menos de 8 chars — não bloqueie
        // no HTML5, o backend rejeita se estiver errado.
        ui.password.removeAttribute('minlength');
        show(ui.emailGroup);
        show(ui.passwordGroup);
        show(ui.forgotLink, 'inline');
        show(ui.footer, 'block');
        break;
    }
  }

  render();

  window.addEventListener('hashchange', () => {
    state = parseHash();
    render();
  });

  ui.toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (state.mode === 'login') window.location.hash = '#signup';
    else if (state.mode === 'signup') window.location.hash = '';
    else if (state.mode === 'forgot') window.location.hash = '';
    else window.location.hash = '';
    state = parseHash();
    render();
  });

  ui.forgotLink.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.hash = '#forgot';
    state = parseHash();
    render();
  });

  // Toggle password visibility
  ui.togglePwd.addEventListener('click', (e) => {
    e.preventDefault();
    const type = ui.password.getAttribute('type') === 'password' ? 'text' : 'password';
    ui.password.setAttribute('type', type);
    const icon = type === 'password' ? 'eye' : 'eye-off';
    ui.togglePwd.innerHTML = `<i data-lucide="${icon}"></i>`;
    if (window.lucide) window.lucide.createIcons({ root: ui.togglePwd });
  });

  // signup_started: primeira digitação no formulário em modo cadastro.
  const markSignupStarted = () => {
    if (state.mode === 'signup' && !signupStartedTracked) {
      signupStartedTracked = true;
      track('signup_started');
    }
  };
  ui.email.addEventListener('input', markSignupStarted);
  ui.password.addEventListener('input', markSignupStarted);

  async function submitLogin(email, password) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data.verification_required) {
      await fetch('/api/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }).catch(() => {});
      throw new Error('Confirme seu e-mail antes de entrar. Enviamos um novo link de confirmação.');
    }
    if (!res.ok) throw new Error(data.error || 'Erro ao entrar.');
    track('login_completed');
    location.href = data.redirect || '/dashboard.html';
  }

  async function submitSignup(email, password) {
    if (!ui.acceptTerms.checked) {
      throw new Error('É necessário aceitar os Termos de Uso e a Política de Privacidade.');
    }
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, accept_terms: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro ao criar conta.');
    track('signup_completed'); // UTMs viajam junto via zapien-analytics (atribuição)
    ui.successAlert.innerHTML = `
      <strong>Confira seu e-mail.</strong><br>
      Enviamos um link de confirmação para ${email}. Ele expira em 24 horas.
      <button type="button" id="resendVerificationBtn" class="btn btn-secondary" style="width:100%;margin-top:12px;">Reenviar e-mail</button>
    `;
    ui.successAlert.style.display = 'block';
    document.getElementById('resendVerificationBtn')?.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      try {
        const resend = await fetch('/api/resend-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const result = await resend.json().catch(() => ({}));
        if (!resend.ok) throw new Error(result.error || 'Não foi possível reenviar.');
        btn.textContent = 'E-mail reenviado';
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Tentar reenviar novamente';
        ui.errorAlert.textContent = err.message;
        ui.errorAlert.style.display = 'block';
      }
    });
    ui.form.reset();
  }

  async function submitForgot(email) {
    const res = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro ao solicitar recuperação.');
    ui.successAlert.textContent = (data.message || 'Se o e-mail existir, enviamos um link para redefinir a senha.') +
      ' Verifique sua caixa de entrada e a pasta de spam — o e-mail pode levar alguns minutos. ' +
      'Se não chegar, aguarde um pouco e tente novamente.';
    ui.successAlert.style.display = 'block';
  }

  async function submitReset(token, password) {
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro ao redefinir senha.');
    ui.successAlert.textContent = 'Senha redefinida. Redirecionando para o login…';
    ui.successAlert.style.display = 'block';
    setTimeout(() => { window.location.hash = ''; window.location.reload(); }, 1500);
  }

  ui.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ui.errorAlert.style.display = 'none';
    ui.successAlert.style.display = 'none';

    const email = ui.email.value.trim();
    const password = ui.password.value;
    const originalText = ui.submitBtn.textContent;
    ui.submitBtn.disabled = true;
    ui.submitBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Aguarde...';
    if (window.lucide) window.lucide.createIcons({ root: ui.submitBtn });

    try {
      if (state.mode === 'forgot') {
        if (!email) throw new Error('Informe o e-mail.');
        await submitForgot(email);
      } else if (state.mode === 'reset') {
        if (!state.token) throw new Error('Link inválido. Peça um novo em "Esqueceu a senha?".');
        if (!password || password.length < 8) throw new Error('A nova senha deve ter pelo menos 8 caracteres.');
        await submitReset(state.token, password);
      } else if (state.mode === 'signup') {
        if (!email || !password) throw new Error('Preencha e-mail e senha.');
        await submitSignup(email, password);
      } else {
        if (!email || !password) throw new Error('Preencha e-mail e senha.');
        await submitLogin(email, password);
      }
    } catch (err) {
      ui.errorAlert.textContent = err.message || 'Erro ao processar requisição.';
      ui.errorAlert.style.display = 'block';
    } finally {
      ui.submitBtn.disabled = false;
      ui.submitBtn.textContent = originalText;
    }
  });
});
