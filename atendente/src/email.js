/**
 * Envio de e-mail transacional (recuperação de senha).
 *
 * Modos (RESET_EMAIL_SENDER):
 *   console → imprime a URL de reset no log (SOMENTE desenvolvimento);
 *   resend  → envia e-mail real via API HTTPS do Resend (fetch nativo);
 *   off     → não envia nem imprime (testes automatizados).
 *
 * Em produção o modo console é recusado pela validação de configuração
 * (npm run validate:config:production). Se mesmo assim o processo subir com
 * console em produção, degradamos para "off" com erro operacional bem
 * visível — o link de reset NUNCA é impresso em log de produção.
 *
 * Nunca logar token, URL de reset (em produção) ou e-mail completo.
 */
import { randomUUID } from 'node:crypto';

const RESEND_API_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = Number(process.env.EMAIL_RETRY_DELAY_MS || 1_000);

let warnedInsecureProd = false;

/** Modo efetivo de envio, já aplicando a trava de produção. */
export function getEmailSenderMode() {
  const mode = (process.env.RESET_EMAIL_SENDER || 'console').toLowerCase();
  if (mode === 'console' && process.env.NODE_ENV === 'production') {
    if (!warnedInsecureProd) {
      warnedInsecureProd = true;
      console.error(
        '[email] RESET_EMAIL_SENDER=console não é permitido em produção — ' +
        'links de reset NÃO serão impressos. Configure RESET_EMAIL_SENDER=resend ' +
        'com RESEND_API_KEY (valide com npm run validate:config:production).'
      );
    }
    return 'off';
  }
  return mode;
}

/** Mascara e-mail para logs: "do****@gmail.com". */
export function maskEmail(email) {
  const [user = '', domain = ''] = String(email || '').split('@');
  return `${user.slice(0, 2)}****@${domain}`;
}

/**
 * Template do e-mail de redefinição — HTML simples e responsivo + texto puro.
 * Exportado para os testes conferirem o conteúdo sem enviar nada.
 */
export function renderPasswordResetEmail({ resetUrl, expiresInMinutes = 60 }) {
  const supportEmail = (process.env.SUPPORT_EMAIL || '').trim();
  const supportLine = supportEmail
    ? `Precisa de ajuda? Fale com a gente: ${supportEmail}`
    : 'Precisa de ajuda? Fale com o suporte pelo painel do Zapien.';

  const subject = 'Redefinir sua senha — Zapien';
  const text = [
    'Zapien',
    '',
    'Redefinir sua senha',
    '',
    'Recebemos um pedido para redefinir a senha da sua conta.',
    `Este link vale por ${expiresInMinutes} minutos e só pode ser usado uma vez:`,
    '',
    resetUrl,
    '',
    'Se você não pediu a redefinição, ignore este e-mail — sua senha continua a mesma.',
    '',
    supportLine,
  ].join('\n');

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:24px 16px;">
      <div style="background:#ffffff;border-radius:12px;padding:32px 24px;border:1px solid #e5e9ef;">
        <div style="font-size:20px;font-weight:700;color:#0f172a;margin-bottom:16px;">Zapien</div>
        <h1 style="font-size:18px;color:#0f172a;margin:0 0 12px;">Redefinir sua senha</h1>
        <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 20px;">
          Recebemos um pedido para redefinir a senha da sua conta.
          O link abaixo vale por <strong>${expiresInMinutes} minutos</strong> e só pode ser usado uma vez.
        </p>
        <p style="text-align:center;margin:0 0 20px;">
          <a href="${resetUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">Redefinir senha</a>
        </p>
        <p style="font-size:12px;color:#64748b;line-height:1.6;margin:0 0 20px;">
          Se o botão não funcionar, copie e cole este endereço no navegador:<br>
          <a href="${resetUrl}" style="color:#2563eb;word-break:break-all;">${resetUrl}</a>
        </p>
        <p style="font-size:12px;color:#64748b;line-height:1.6;margin:0;">
          Se você não pediu a redefinição, ignore este e-mail — sua senha continua a mesma.<br>
          ${supportLine}
        </p>
      </div>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

class EmailSendError extends Error {
  constructor(message, { requestId, status, retryable = false } = {}) {
    super(message);
    this.name = 'EmailSendError';
    this.requestId = requestId;
    this.status = status;
    this.retryable = retryable;
  }
}

async function postToResend({ to, subject, html, text, requestId }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new EmailSendError('RESEND_API_KEY não configurada.', { requestId });
  }
  const from = (process.env.EMAIL_FROM || 'Zapien <acesso@zapien.app>').trim();

  let res;
  try {
    res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new EmailSendError(
      timedOut ? `timeout após ${SEND_TIMEOUT_MS}ms` : `falha de rede: ${err?.message || err}`,
      { requestId, retryable: true }
    );
  }

  if (res.ok) return;

  // Corpo de erro do Resend não contém dados do destinatário, mas por
  // segurança logamos só um trecho curto e o status.
  const body = await res.text().catch(() => '');
  const snippet = body.slice(0, 150);
  if (res.status === 429) {
    throw new EmailSendError(`rate limit do provedor (429): ${snippet}`, {
      requestId, status: 429, retryable: true,
    });
  }
  if (res.status >= 500) {
    throw new EmailSendError(`erro do provedor (${res.status}): ${snippet}`, {
      requestId, status: res.status, retryable: true,
    });
  }
  throw new EmailSendError(`provedor recusou o envio (${res.status}): ${snippet}`, {
    requestId, status: res.status, retryable: false,
  });
}

/**
 * Envia o e-mail de redefinição de senha.
 * Retorna { sent, mode, requestId }. Lança EmailSendError quando o provedor
 * falha (o chamador decide alertar; a resposta pública não muda).
 */
export async function sendPasswordResetEmail({ to, resetUrl, expiresInMinutes = 60 }) {
  const mode = getEmailSenderMode();
  const requestId = randomUUID().slice(0, 8);

  if (mode === 'off') return { sent: false, mode, requestId };

  if (mode === 'console') {
    // Somente desenvolvimento (a trava de produção está em getEmailSenderMode).
    console.log(`[reset-senha] link de redefinição: ${resetUrl}`);
    return { sent: false, mode, requestId };
  }

  if (mode !== 'resend') {
    throw new EmailSendError(`RESET_EMAIL_SENDER desconhecido: ${mode}`, { requestId });
  }

  const { subject, html, text } = renderPasswordResetEmail({ resetUrl, expiresInMinutes });

  try {
    await postToResend({ to, subject, html, text, requestId });
  } catch (err) {
    if (!(err instanceof EmailSendError) || !err.retryable) throw err;
    // Uma única nova tentativa para falhas transitórias (timeout/429/5xx).
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    await postToResend({ to, subject, html, text, requestId });
  }

  console.log(`[reset-senha][${requestId}] e-mail enviado para ${maskEmail(to)}`);
  return { sent: true, mode, requestId };
}

export function renderInvitationEmail({ inviteUrl, companyName, role, expiresInHours = 48 }) {
  const supportEmail = (process.env.SUPPORT_EMAIL || '').trim();
  const supportLine = supportEmail
    ? `Precisa de ajuda? Fale com a gente: ${supportEmail}`
    : 'Precisa de ajuda? Fale com o suporte pelo painel do Zapien.';

  const roleLabel = role === 'admin' ? 'Administrador' : 'Atendente';
  const subject = `Convite para participar da equipe no Zapien — ${companyName}`;
  const text = [
    'Zapien',
    '',
    `Você foi convidado para participar da equipe da empresa ${companyName} no Zapien como ${roleLabel}.`,
    `Este convite vale por ${expiresInHours} horas:`,
    '',
    inviteUrl,
    '',
    'Se você não esperava este convite, pode ignorar este e-mail com segurança.',
    '',
    supportLine,
  ].join('\n');

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:24px 16px;">
      <div style="background:#ffffff;border-radius:12px;padding:32px 24px;border:1px solid #e5e9ef;">
        <div style="font-size:20px;font-weight:700;color:#0f172a;margin-bottom:16px;">Zapien</div>
        <h1 style="font-size:18px;color:#0f172a;margin:0 0 12px;">Você foi convidado!</h1>
        <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 20px;">
          Você foi convidado para participar da equipe de <strong>${companyName}</strong> no Zapien como <strong>${roleLabel}</strong>.
          O link abaixo vale por <strong>${expiresInHours} horas</strong>.
        </p>
        <p style="text-align:center;margin:0 0 20px;">
          <a href="${inviteUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">Aceitar Convite</a>
        </p>
        <p style="font-size:12px;color:#64748b;line-height:1.6;margin:0 0 20px;">
          Se o botão não funcionar, copie e cole este endereço no navegador:<br>
          <a href="${inviteUrl}" style="color:#2563eb;word-break:break-all;">${inviteUrl}</a>
        </p>
        <p style="font-size:12px;color:#64748b;line-height:1.6;margin:0;">
          Se você não esperava este convite, ignore este e-mail.<br>
          ${supportLine}
        </p>
      </div>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

export async function sendInvitationEmail({ to, inviteUrl, companyName, role, expiresInHours = 48 }) {
  const mode = getEmailSenderMode();
  const requestId = randomUUID().slice(0, 8);

  if (mode === 'off') return { sent: false, mode, requestId };

  if (mode === 'console') {
    console.log(`[convite-usuario] link de convite: ${inviteUrl}`);
    return { sent: false, mode, requestId };
  }

  if (mode !== 'resend') {
    throw new EmailSendError(`RESET_EMAIL_SENDER desconhecido: ${mode}`, { requestId });
  }

  const { subject, html, text } = renderInvitationEmail({ inviteUrl, companyName, role, expiresInHours });

  try {
    await postToResend({ to, subject, html, text, requestId });
  } catch (err) {
    if (!(err instanceof EmailSendError) || !err.retryable) throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    await postToResend({ to, subject, html, text, requestId });
  }

  console.log(`[convite-usuario][${requestId}] convite enviado para ${maskEmail(to)}`);
  return { sent: true, mode, requestId };
}


export async function sendEmailVerificationEmail({ to, verifyUrl, expiresInHours = 24 }) {
  const mode = getEmailSenderMode();
  const requestId = randomUUID().slice(0, 8);
  if (mode === 'off') return { sent: false, mode, requestId };
  if (mode === 'console') {
    console.log(`[verificar-email] link: ${verifyUrl}`);
    return { sent: false, mode, requestId };
  }
  if (mode !== 'resend') {
    throw new EmailSendError(`RESET_EMAIL_SENDER desconhecido: ${mode}`, { requestId });
  }

  const subject = 'Confirme seu e-mail no Zapien';
  const text = `Confirme seu e-mail para ativar sua conta Zapien: ${verifyUrl}\n\nEste link expira em ${expiresInHours} horas.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#111827">
    <div style="max-width:560px;margin:0 auto;padding:40px 20px">
      <div style="background:#fff;border-radius:18px;padding:32px;border:1px solid #e5e7eb">
        <h1 style="margin:0 0 12px;font-size:24px">Confirme seu e-mail</h1>
        <p style="line-height:1.6;color:#4b5563">Clique no botão abaixo para confirmar que este endereço pertence a você e ativar sua conta Zapien.</p>
        <p style="margin:28px 0"><a href="${verifyUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:bold">Confirmar meu e-mail</a></p>
        <p style="font-size:13px;line-height:1.5;color:#6b7280">O link expira em ${expiresInHours} horas. Se você não criou esta conta, ignore este e-mail.</p>
      </div>
    </div>
  </body></html>`;

  await postToResend({ to, subject, html, text, requestId });
  console.log(`[verificar-email][${requestId}] enviado para ${maskEmail(to)}`);
  return { sent: true, mode, requestId };
}
