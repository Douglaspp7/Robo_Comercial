import { NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

// Pool de leads no worker. GET = estatísticas; POST = adiciona (deduplicado).
export async function GET() {
  try {
    const res = await workerFetch("/leads/stats");
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "worker offline" }, { status: 502 });
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
    const res = await workerFetch("/leads", { method: "POST", body: JSON.stringify(body) });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "worker indisponível" }, { status: 502 });
  }
}
