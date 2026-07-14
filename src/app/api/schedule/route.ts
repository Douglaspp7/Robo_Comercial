import { NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

// Config de agendamento no worker (roda a busca sozinho 1x/dia).
export async function GET() {
  try {
    const res = await workerFetch("/schedule");
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ enabled: false, error: "worker offline" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    const res = await workerFetch("/schedule", { method: "POST", body: JSON.stringify(body) });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "worker indisponível" }, { status: 502 });
  }
}
