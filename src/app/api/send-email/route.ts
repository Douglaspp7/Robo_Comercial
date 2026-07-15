import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { rateLimit } from "@/lib/rate-limit";

const MAX_EMAIL_TARGETS = 50;

export async function POST(request: Request) {
  const blocked = rateLimit(request, "email-campaign", 3, 60 * 60 * 1000);
  if (blocked) return blocked;
  try {
    const { targets, subject, body, image } = await request.json();

    if (!Array.isArray(targets) || targets.length === 0 || !subject || !body) {
      return NextResponse.json({ error: "Parâmetros incompletos" }, { status: 400 });
    }
    if (targets.length > MAX_EMAIL_TARGETS) {
      return NextResponse.json({ error: `Máximo de ${MAX_EMAIL_TARGETS} destinatários por envio` }, { status: 400 });
    }
    if (String(subject).length > 200 || String(body).length > 10_000) {
      return NextResponse.json({ error: "Assunto ou mensagem excede o limite permitido" }, { status: 400 });
    }

    // Imagem opcional embutida no corpo (inline via CID).
    const parseImage = (dataUrl: unknown) => {
      const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataUrl || ""));
      if (!m) return null;
      const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
      const content = Buffer.from(m[2], "base64");
      if (content.length === 0 || content.length > 6 * 1024 * 1024) return null;
      return { filename: `imagem.${ext}`, content, cid: "promo-img" };
    };
    const attachment = parseImage(image);
    const imgHtml = attachment
      ? `<img src="cid:${attachment.cid}" style="max-width:100%;height:auto" /><br/><br/>`
      : "";

    const userEmail = process.env.SMTP_EMAIL;
    const userPassword = process.env.SMTP_PASSWORD;

    if (!userEmail || !userPassword) {
      return NextResponse.json(
        { error: "Credenciais de e-mail (SMTP) não configuradas no servidor (.env.local)" },
        { status: 500 }
      );
    }

    // Configuração do Nodemailer (Assumindo Gmail por padrão, mas pode ser genérico)
    // Se for Gmail, a senha deve ser uma "Senha de Aplicativo" (App Password)
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: userEmail,
        pass: userPassword,
      },
    });

    let successCount = 0;
    let skipped = 0; // sem e-mail válido (ex.: lead do Google Maps, que não traz e-mail)
    const errors: string[] = [];

    const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

    // Loop de envio: manda para o e-mail REAL de cada lead (o extrator do
    // Instagram preenche target.email a partir da bio/site). Quem não tem
    // e-mail válido é pulado — não há mais destinatário de teste chumbado.
    // Nota: para volume alto o ideal é um serviço dedicado (SendGrid/SES).
    for (const target of targets) {
      const recipientEmail = String(target.email || "").trim();
      if (!recipientEmail || !isValidEmail(recipientEmail)) {
        skipped++;
        continue;
      }

      const personalizedBody = body.replace(/{nome}/g, target.name || "Empresa");

      try {
        await transporter.sendMail({
          from: userEmail,
          to: recipientEmail,
          subject: subject,
          text: personalizedBody,
          html: `${imgHtml}<p>${personalizedBody.replace(/\n/g, "<br>")}</p>`,
          attachments: attachment ? [attachment] : undefined,
        });
        successCount++;
        // Respiro entre envios para não parecer spam no provedor SMTP.
        await new Promise((r) => setTimeout(r, 800));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Erro ao enviar para ${target.name}:`, msg);
        errors.push(`${target.name || recipientEmail}: ${msg}`);
      }
    }

    return NextResponse.json({
      success: true,
      sent: successCount,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Erro interno no /api/send-email:", error);
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 });
  }
}
