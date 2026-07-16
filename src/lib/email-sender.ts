import nodemailer from "nodemailer";

export interface EmailTarget { email?: string; name?: string; company_name?: string; dedup_key?: string }

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);

function parseImage(dataUrl: unknown) {
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!match) return null;
  const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  const content = Buffer.from(match[2], "base64");
  if (!content.length || content.length > 6 * 1024 * 1024) return null;
  return { filename: `imagem.${ext}`, content, cid: "promo-img" };
}

export async function sendEmailBatch(targets: EmailTarget[], subject: string, body: string, image?: unknown) {
  const user = process.env.SMTP_EMAIL;
  const password = process.env.SMTP_PASSWORD;
  if (!user || !password) throw new Error("Credenciais SMTP não configuradas");
  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass: password } });
  const attachment = parseImage(image);
  const sent: EmailTarget[] = [];
  const errors: string[] = [];
  let skipped = 0;
  for (const target of targets) {
    const recipient = String(target.email || "").trim().toLowerCase();
    if (!validEmail(recipient)) { skipped++; continue; }
    const name = target.company_name || target.name || "Empresa";
    const personalized = body.replace(/{nome}/g, name);
    try {
      await transporter.sendMail({ from: user, to: recipient, subject, text: personalized,
        html: `${attachment ? `<img src="cid:${attachment.cid}" style="max-width:100%;height:auto" alt=""/><br/><br/>` : ""}<p>${escapeHtml(personalized).replace(/\n/g, "<br>")}</p>`,
        attachments: attachment ? [attachment] : undefined });
      sent.push(target);
      if (targets.length > 1) await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { sent, skipped, errors };
}
