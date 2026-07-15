import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

// Ponte entre o painel e o worker de disparo (Baileys) que roda no Pi.
// O token do worker fica só no servidor (nunca vai pro navegador).
const WORKER_URL = (process.env.WORKER_URL || "http://localhost:8787").replace(
  /\/$/,
  ""
);
const WORKER_TOKEN = process.env.WORKER_API_TOKEN || "";

function workerHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (WORKER_TOKEN) h["x-worker-token"] = WORKER_TOKEN;
  return h;
}

// GET → estado do worker + progresso das campanhas (para o painel exibir).
export async function GET() {
  try {
    const res = await fetch(`${WORKER_URL}/status`, {
      headers: workerHeaders(),
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      {
        error:
          "Worker de disparo indisponível. Confira se ele está rodando no Pi " +
          "e o WORKER_URL configurado.",
        wa: { connected: false, status: "offline" },
        campaigns: [],
      },
      { status: 502 }
    );
  }
}

// POST → cria uma campanha no worker com os contatos selecionados.
export async function POST(request: Request) {
  const blocked = rateLimit(request, "wa-campaign", 10, 60 * 60 * 1000);
  if (blocked) return blocked;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  try {
    const res = await fetch(`${WORKER_URL}/campaigns`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      {
        error:
          "Não consegui falar com o worker de disparo. Ele está ligado no Pi?",
      },
      { status: 502 }
    );
  }
}
