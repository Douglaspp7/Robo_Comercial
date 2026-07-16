import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const limited = rateLimit(request, "ai-search-plan", 10, 60 * 60 * 1000);
  if (limited) return limited;
  const url = (process.env.ATTENDANT_URL || "http://localhost:3001").replace(/\/$/, "");
  const token = process.env.WORKER_API_TOKEN || "";
  if (!token) return NextResponse.json({ error: "WORKER_API_TOKEN não configurado." }, { status: 503 });
  try {
    const body = await request.json();
    const res = await fetch(`${url}/internal/search-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-token": token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ error: "Resposta inválida do atendente." }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Atendente com IA indisponível. Use a sugestão rápida." }, { status: 502 });
  }
}
