import { NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";
import { rateLimit } from "@/lib/rate-limit";
import { sendEmailBatch, type EmailTarget } from "@/lib/email-sender";

export async function POST(request: Request) {
  const limited = rateLimit(request, "multichannel-orchestration", 3, 60 * 60 * 1000);
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  const message = String(body.message || "").trim();
  const subject = String(body.email_subject || "").trim();
  const emailBody = String(body.email_body || "").trim();
  if (!message || !subject || !emailBody || subject.length > 200 || emailBody.length > 10_000) {
    return NextResponse.json({ error: "Revise a mensagem do WhatsApp, o assunto e o texto do e-mail." }, { status: 400 });
  }

  try {
    const waResponse = await workerFetch("/campaigns/from-pending", { method: "POST", body: JSON.stringify({
      name: body.name || `Orquestração ${new Date().toLocaleDateString('pt-BR')}`,
      message, app_url: body.app_url || "", approach: body.approach || "custom", image: body.image,
    }) });
    const waData = await waResponse.json().catch(() => ({}));
    const wa = waResponse.ok ? { created: true, count: waData.count || 0, campaign_id: waData.id } :
      { created: false, count: 0, reason: waData.error || "sem contatos de WhatsApp aprovados" };

    const pendingResponse = await workerFetch("/leads/pending-email?limit=50");
    if (!pendingResponse.ok) throw new Error("Não foi possível consultar a fila de e-mail");
    const pendingData = await pendingResponse.json();
    const targets: EmailTarget[] = Array.isArray(pendingData.items) ? pendingData.items : [];
    let email = { sent: 0, pending: targets.length, skipped: 0, errors: [] as string[] };
    if (targets.length) {
      const footer = "\n\nSe este contato não for relevante, responda SAIR e não enviaremos novas mensagens.";
      try {
        const result = await sendEmailBatch(targets, subject, emailBody + footer, body.email_image);
        const keys = result.sent.map((target) => target.dedup_key).filter(Boolean);
        if (keys.length) await workerFetch("/leads/mark-contacted", { method: "POST", body: JSON.stringify({ keys }) });
        email = { sent: result.sent.length, pending: Math.max(0, targets.length - result.sent.length), skipped: result.skipped, errors: result.errors };
      } catch (error) {
        email.errors = [error instanceof Error ? error.message : String(error)];
      }
    }
    return NextResponse.json({ success: wa.created || email.sent > 0, whatsapp: wa, email });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Worker indisponível" }, { status: 502 });
  }
}
