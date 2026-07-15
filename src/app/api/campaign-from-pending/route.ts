import { NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";
import { rateLimit } from "@/lib/rate-limit";

// Cria uma campanha no worker a partir dos leads pendentes (WhatsApp,
// ainda não contatados) do pool.
export async function POST(request: Request) {
  const blocked = rateLimit(request, "wa-pending-campaign", 10, 60 * 60 * 1000);
  if (blocked) return blocked;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    const res = await workerFetch("/campaigns/from-pending", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "worker indisponível" }, { status: 502 });
  }
}
