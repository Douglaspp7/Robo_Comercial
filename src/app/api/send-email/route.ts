import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(request: Request) {
  try {
    const { targets, subject, body } = await request.json();

    if (!targets || targets.length === 0 || !subject || !body) {
      return NextResponse.json({ error: "Parâmetros incompletos" }, { status: 400 });
    }

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
    const errors = [];

    // Loop para enviar e-mails
    // Nota: Em produção real, disparos em massa devem usar serviços profissionais como SendGrid/AWS SES
    // e devem ter um "delay" entre os envios para não configurar SPAM no provedor SMTP.
    for (const target of targets) {
      // Como o Google Places não retorna e-mail (geralmente),
      // este código simula o envio usando um e-mail fictício baseado no site ou
      // usa um e-mail padrão para demonstração, já que o alvo não tem e-mail extraído diretamente.
      
      // ALERTA: Na vida real, você precisaria de uma etapa de enriquecimento de dados (ex: Hunter.io)
      // para encontrar os e-mails dessas empresas. Para testes, vamos simular que estamos enviando
      // para o seu próprio e-mail de teste ou registrar apenas o log.
      
      const recipientEmail = "seu-email-de-teste@exemplo.com"; // Substitua em produção
      
      const personalizedBody = body.replace(/{nome}/g, target.name || "Empresa");

      try {
        await transporter.sendMail({
          from: userEmail,
          to: recipientEmail, // Enviando para o email de teste
          subject: subject,
          text: personalizedBody,
          // html: `<p>${personalizedBody.replace(/\n/g, "<br>")}</p>`, // Se quiser enviar em HTML
        });
        successCount++;
      } catch (err: any) {
        console.error(`Erro ao enviar para ${target.name}:`, err);
        errors.push(err.message);
      }
    }

    return NextResponse.json({ 
      success: true, 
      sent: successCount,
      errors: errors.length > 0 ? errors : undefined 
    });
  } catch (error) {
    console.error("Erro interno no /api/send-email:", error);
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 });
  }
}
