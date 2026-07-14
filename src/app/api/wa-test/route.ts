import { NextResponse } from "next/server";

// Teste de disparo para um número avulso (envio imediato pelo worker).
const WORKER_URL = (process.env.WORKER_URL || "http://localhost:8787").replace(
  /\/$/,
  ""
);
const WORKER_TOKEN = process.env.WORKER_API_TOKEN || "";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (WORKER_TOKEN) headers["x-worker-token"] = WORKER_TOKEN;
    const res = await fetch(`${WORKER_URL}/test-send`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "Worker de disparo indisponível. Ele está ligado?" },
      { status: 502 }
    );
  }
}
