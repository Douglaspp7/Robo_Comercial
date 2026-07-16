import { NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

// Pool de leads no worker. GET = estatísticas; POST = adiciona (deduplicado).
export async function GET(request: Request) {
  try {
    const detailed = new URL(request.url).searchParams.get("detail") === "1";
    const res = await workerFetch(detailed ? "/leads/review" : "/leads/stats");
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "worker offline" }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const res = await workerFetch("/leads/review", { method: "PATCH", body: JSON.stringify(body) });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "worker indisponível" }, { status: 502 });
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
