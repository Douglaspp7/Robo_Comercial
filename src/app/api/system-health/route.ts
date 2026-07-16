import { NextResponse } from "next/server";

const WORKER_URL = (process.env.WORKER_URL || "http://localhost:8787").replace(/\/$/, "");
const ATTENDANT_URL = (process.env.ATTENDANT_URL || "").replace(/\/$/, "");
const WORKER_TOKEN = process.env.WORKER_API_TOKEN || "";

async function readJson(url: string, headers?: Record<string, string>) {
  const started = Date.now();
  const res = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { data: await res.json(), latencyMs: Date.now() - started };
}

export async function GET() {
  const workerHeaders = WORKER_TOKEN ? { "x-worker-token": WORKER_TOKEN } : undefined;
  const [workerResult, attendantResult] = await Promise.allSettled([
    readJson(`${WORKER_URL}/status`, workerHeaders),
    ATTENDANT_URL ? readJson(`${ATTENDANT_URL}/health`) : Promise.reject(new Error("não configurado")),
  ]);

  const worker = workerResult.status === "fulfilled" ? workerResult.value : null;
  const attendant = attendantResult.status === "fulfilled" ? attendantResult.value : null;
  const workerData = worker?.data as { numbers?: Array<{ id: string; status: string; connected: boolean; today?: number; limit?: number; lastError?: string | null }>; paused?: boolean; campaigns?: unknown[] } | undefined;
  const numbers = workerData?.numbers || [];
  const connected = numbers.filter((number) => number.connected).length;
  const warnings: string[] = [];

  if (!worker) warnings.push("Worker não respondeu");
  else if (numbers.length === 0) warnings.push("Nenhum chip configurado");
  else if (connected < numbers.length) warnings.push(`${numbers.length - connected} chip(s) desconectado(s)`);
  if (!ATTENDANT_URL) warnings.push("Atendente não configurado");
  else if (!attendant) warnings.push("Atendente não respondeu");

  const overall = !worker || !attendant
    ? "offline"
    : warnings.length > 0
      ? "degraded"
      : "healthy";

  return NextResponse.json({
    overall,
    checkedAt: new Date().toISOString(),
    panel: { status: "healthy" },
    worker: {
      status: worker ? (connected === numbers.length && numbers.length > 0 ? "healthy" : "degraded") : "offline",
      latencyMs: worker?.latencyMs ?? null,
      paused: workerData?.paused ?? false,
      campaigns: workerData?.campaigns?.length ?? 0,
    },
    numbers,
    attendant: {
      status: attendant ? "healthy" : "offline",
      configured: Boolean(ATTENDANT_URL),
      latencyMs: attendant?.latencyMs ?? null,
      url: ATTENDANT_URL || null,
      metrics: attendant?.data ?? null,
    },
    warnings,
  });
}
