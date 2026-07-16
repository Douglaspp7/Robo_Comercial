import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { randomUUID } from "node:crypto";

// Ponte entre o painel e o worker de disparo (Baileys) que roda no Pi.
// O token do worker fica só no servidor (nunca vai pro navegador).
const WORKER_URL = (process.env.WORKER_URL || "http://localhost:8787").replace(
  /\/$/,
  ""
);
const WORKER_TOKEN = process.env.WORKER_API_TOKEN || "";
const CONTROL_URL = (process.env.CONTROL_PLANE_URL || "").replace(/\/$/, "");
const CONTROL_TOKEN = process.env.CONTROL_PLANE_TOKEN || "";

function workerHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (WORKER_TOKEN) h["x-worker-token"] = WORKER_TOKEN;
  return h;
}

// GET → estado do worker + progresso das campanhas (para o painel exibir).
export async function GET() {
  try {
    if (CONTROL_URL && CONTROL_TOKEN) {
      const res = await fetch(`${CONTROL_URL}/api/robo/control/status`, { headers: { "x-robo-control-token": CONTROL_TOKEN }, cache: "no-store" });
      const data = await res.json(); const worker = data.workers?.[0];
      return NextResponse.json({ control_plane:true, numbers:worker?.numbers||[], paused:worker?.paused??false, dry_run:worker?.dry_run??true, campaigns:worker?.campaigns||[], jobs:data.jobs||[], worker_online:Boolean(worker?.online) }, { status:res.status });
    }
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
    if (CONTROL_URL && CONTROL_TOKEN) {
      const payload = body as Record<string, unknown>;
      const res = await fetch(`${CONTROL_URL}/api/robo/control/jobs`, { method:"POST", headers:{"Content-Type":"application/json","x-robo-control-token":CONTROL_TOKEN}, body:JSON.stringify({type:"campaign",payload,idempotency_key:`campaign-${randomUUID()}`,available_at:Number(payload.scheduled_for)||Date.now()}), cache:"no-store" });
      const data = await res.json(); return NextResponse.json({...data,queued_centrally:res.ok},{status:res.status});
    }
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
