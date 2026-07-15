import { NextResponse } from "next/server";

// Status do ATENDENTE (a cópia do Zapien que vende Zapien) para o painel mostrar
// num card: está no ar? + URL do dashboard para abrir. ATTENDANT_URL é a URL
// pública do atendente (não é segredo); vazio = não configurado.
export async function GET() {
  const url = (process.env.ATTENDANT_URL || "").replace(/\/$/, "");
  if (!url) return NextResponse.json({ configured: false });
  try {
    // Pingar a raiz basta para saber se está no ar (login/landing responde 2xx/3xx).
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "manual" });
    const online = res.status > 0 && res.status < 500;
    return NextResponse.json({ configured: true, online, url });
  } catch {
    return NextResponse.json({ configured: true, online: false, url });
  }
}
