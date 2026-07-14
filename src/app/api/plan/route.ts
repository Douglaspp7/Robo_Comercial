import { NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

// Plano de busca salvo no worker. GET lista; POST adiciona linha (ou semeia
// com {seed:true}); DELETE remove por ?id=.
export async function GET() {
  try {
    const res = await workerFetch("/plan");
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ plan: [], error: "worker offline" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  let body: { seed?: boolean };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  try {
    const path = body.seed ? "/plan/seed" : "/plan";
    const res = await workerFetch(path, { method: "POST", body: JSON.stringify(body) });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "worker indisponível" }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  try {
    const res = await workerFetch(`/plan/${encodeURIComponent(id)}`, { method: "DELETE" });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "worker indisponível" }, { status: 502 });
  }
}
