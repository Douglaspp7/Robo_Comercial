import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

// Controle do worker de disparo (pausar/retomar) a partir do painel.
// Global:      { action: "pause" | "resume" }
// Por campanha:{ campaignId: number, action: "pause" | "resume" | "cancel" }
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

export async function POST(request: Request) {
  const blocked = rateLimit(request, "wa-control", 60, 60 * 1000);
  if (blocked) return blocked;
  let body: { campaignId?: number; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const action = body.action;
  if (!action) {
    return NextResponse.json({ error: "action obrigatória" }, { status: 400 });
  }

  // Rota do worker: global (/control) ou por campanha (/campaigns/:id/status).
  const path =
    body.campaignId != null
      ? `/campaigns/${body.campaignId}/status`
      : `/control`;

  try {
    const res = await fetch(`${WORKER_URL}${path}`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "Worker de disparo indisponível." },
      { status: 502 }
    );
  }
}
