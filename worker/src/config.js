/**
 * Configuração do worker de disparo — tudo por variável de ambiente com
 * padrões seguros. Os padrões espelham a lógica que hoje vive no navegador
 * (cota diária 40, intervalo aleatório 30–90s) para não mudar o comportamento
 * de segurança ao migrar do AutoHotkey para o servidor.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export const config = {
  // Onde persistir os dados (sobrevive a reboot do Pi).
  dataDir: process.env.WORKER_DATA_DIR || path.join(ROOT, "data"),
  // Sessão do WhatsApp (credenciais do dispositivo vinculado).
  authDir: process.env.WORKER_AUTH_DIR || path.join(ROOT, "data", "auth"),
  dbPath: process.env.WORKER_DB_PATH || path.join(ROOT, "data", "worker.db"),

  // Porta da API HTTP que o painel (Next) usa para criar campanha / ver status.
  port: num(process.env.WORKER_PORT, 8787),
  // Token simples para proteger a API (o painel envia no header x-worker-token).
  apiToken: process.env.WORKER_API_TOKEN || "",

  // Cadência humana entre envios (segundos). Aleatório em [min, max].
  minDelaySec: num(process.env.WA_MIN_DELAY_SEC, 30),
  maxDelaySec: num(process.env.WA_MAX_DELAY_SEC, 90),

  // Cota diária de envios (proteção anti-ban). Ao atingir, para até o dia virar.
  dailyLimit: num(process.env.WA_DAILY_LIMIT, 40),

  // Aquecimento: nos primeiros dias de um número novo, limita ainda mais.
  // Ex.: "5,10,20" = 5 no 1º dia de uso, 10 no 2º, 20 no 3º, depois dailyLimit.
  warmupRamp: (process.env.WA_WARMUP_RAMP || "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0),

  // Tentativas por contato antes de marcar falha definitiva.
  maxAttempts: num(process.env.WA_MAX_ATTEMPTS, 3),

  // Pareamento por código (Pi sem tela): informe o número no formato
  // internacional só dígitos (ex.: 5511999999999) para receber um código
  // de 8 dígitos em vez de QR. Vazio = usa QR no terminal.
  pairPhone: (process.env.WA_PAIR_PHONE || "").replace(/\D/g, ""),

  // DDI padrão para números sem código de país (Brasil = 55).
  defaultCountryCode: process.env.WA_DEFAULT_DDI || "55",
};

export function randomDelaySec() {
  const { minDelaySec, maxDelaySec } = config;
  const lo = Math.min(minDelaySec, maxDelaySec);
  const hi = Math.max(minDelaySec, maxDelaySec);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}
