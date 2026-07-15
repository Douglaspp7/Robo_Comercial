/**
 * QR Code do link de atendimento (WhatsApp).
 *
 * Exposto em duas telas — Configurações e Integrações — via botões:
 *   #wa-link-qr-btn                (Configurações)
 *   #integrations-wa-link-qr-btn   (Integrações)
 *
 * O modal aparece sob demanda (criado no primeiro clique). Baixa e imprime
 * usando o endpoint /api/whatsapp/qrcode.png que gera o PNG server-side
 * a partir do link /a/:attendance_code do tenant. Sem depender de lib no
 * cliente — o backend usa a mesma lib pra outros usos (offline PDF etc).
 */
(function () {
  const QR_URL = '/api/whatsapp/qrcode.png?size=768';

  function getWaLink() {
    return (
      document.getElementById('wa-link-input')?.value ||
      document.getElementById('integrations-wa-link-input')?.value ||
      ''
    );
  }

  function ensureModal() {
    let m = document.getElementById('wa-qr-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'wa-qr-modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.style.cssText =
      'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:9999;' +
      'display:none;align-items:center;justify-content:center;padding:20px;';
    m.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px;max-width:420px;width:100%;
                  box-shadow:0 20px 60px rgba(0,0,0,0.25);text-align:center;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="margin:0;font-size:1.05rem;font-weight:800;color:#0f172a;">QR Code do seu link</h3>
          <button type="button" id="wa-qr-close" aria-label="Fechar"
                  style="background:none;border:0;font-size:22px;color:#64748b;cursor:pointer;line-height:1;padding:0 6px;">×</button>
        </div>
        <p style="margin:0 0 14px;color:#475569;font-size:0.88rem;line-height:1.45;">
          Escaneie com a câmera para conversar com sua IA no WhatsApp.
        </p>
        <div style="background:#f8fafc;border-radius:12px;padding:16px;margin-bottom:14px;">
          <img id="wa-qr-img" alt="QR Code" style="width:100%;max-width:340px;height:auto;display:block;margin:0 auto;">
        </div>
        <div style="font-size:0.75rem;color:#64748b;word-break:break-all;margin-bottom:16px;" id="wa-qr-link"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
          <a id="wa-qr-download" class="btn btn-primary" style="min-width:140px;">
            <i data-lucide="download"></i> Baixar PNG
          </a>
          <button type="button" id="wa-qr-print" class="btn btn-secondary" style="min-width:140px;">
            <i data-lucide="printer"></i> Imprimir
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(m);

    // Fechar: X, ESC, clicar no backdrop
    const close = () => (m.style.display = 'none');
    m.querySelector('#wa-qr-close').addEventListener('click', close);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && m.style.display !== 'none') close();
    });

    m.querySelector('#wa-qr-print').addEventListener('click', () => {
      const link = getWaLink();
      const w = window.open('', '_blank', 'width=600,height=700');
      if (!w) return window.Toast?.show('Permita pop-ups pra imprimir.', 'error');
      w.document.write(`
        <!doctype html><html><head><meta charset="utf-8"><title>QR Code — meu atendimento</title>
        <style>
          body { font-family: system-ui, sans-serif; text-align: center; margin: 40px; color: #0f172a; }
          h1 { font-size: 22px; margin: 0 0 6px; }
          p  { color: #475569; margin: 0 0 24px; font-size: 14px; }
          .link { font-size: 12px; color: #64748b; word-break: break-all; margin-top: 16px; }
          img { max-width: 380px; width: 100%; }
        </style></head><body>
        <h1>Fale comigo no WhatsApp</h1>
        <p>Escaneie o QR code abaixo</p>
        <img src="${QR_URL}" alt="QR Code">
        <div class="link">${link}</div>
        <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
        </body></html>
      `);
      w.document.close();
    });

    return m;
  }

  function openModal() {
    const link = getWaLink();
    if (!link) {
      window.Toast?.show('Ative primeiro o link de atendimento na aba Configurações.', 'info');
      return;
    }
    const m = ensureModal();
    const img = m.querySelector('#wa-qr-img');
    const dl = m.querySelector('#wa-qr-download');
    const linkEl = m.querySelector('#wa-qr-link');
    // Cache-bust para pegar o QR atualizado se o slug tiver mudado.
    img.src = QR_URL + '&t=' + Date.now();
    dl.href = QR_URL + '&t=' + Date.now();
    dl.download = 'zapien-qr-code.png';
    linkEl.textContent = link;
    m.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons({ root: m });
  }

  function wire() {
    ['wa-link-qr-btn', 'integrations-wa-link-qr-btn'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn && !btn.dataset.wired) {
        btn.dataset.wired = '1';
        btn.addEventListener('click', openModal);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
