import { NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

export async function GET() {
  try { const res = await workerFetch("/daily-summary"); return NextResponse.json(await res.json(), { status: res.status }); }
  catch { return NextResponse.json({ error: "worker indisponível" }, { status: 502 }); }
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const path = body.test ? "/daily-summary/test" : "/daily-summary";
  try { const res = await workerFetch(path, { method: "POST", body: JSON.stringify(body) }); return NextResponse.json(await res.json(), { status: res.status }); }
  catch { return NextResponse.json({ error: "worker indisponível" }, { status: 502 }); }
}
