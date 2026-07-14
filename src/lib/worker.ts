// Helper server-side para falar com o worker de disparo (mantém o token fora
// do navegador). Usado pelas rotas /api/plan, /api/leads, etc.
const WORKER_URL = (process.env.WORKER_URL || "http://localhost:8787").replace(
  /\/$/,
  ""
);
const WORKER_TOKEN = process.env.WORKER_API_TOKEN || "";

export async function workerFetch(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  if (WORKER_TOKEN) headers["x-worker-token"] = WORKER_TOKEN;
  return fetch(`${WORKER_URL}${path}`, { ...init, headers, cache: "no-store" });
}
