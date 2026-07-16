import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { sendEmailBatch } from "@/lib/email-sender";

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

    const result = await sendEmailBatch(targets, String(subject), String(body), image);

    return NextResponse.json({
      success: true,
      sent: result.sent.length,
      skipped: result.skipped,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    console.error("Erro interno no /api/send-email:", error);
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 });
  }
}
