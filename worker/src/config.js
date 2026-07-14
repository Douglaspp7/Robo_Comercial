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

// Diretório de dados: no Pi fica em ./data; na nuvem (Render) aponte
// WORKER_DATA_DIR para o disco persistente (ex.: /var/data). A sessão do
// WhatsApp e o SQLite derivam daqui, então um único env var move tudo.
const dataDir = process.env.WORKER_DATA_DIR || path.join(ROOT, "data");

export const config = {
  dataDir,
  // Sessão do WhatsApp (credenciais do dispositivo vinculado).
  authDir: process.env.WORKER_AUTH_DIR || path.join(dataDir, "auth"),
  dbPath: process.env.WORKER_DB_PATH || path.join(dataDir, "worker.db"),

  // Porta da API HTTP. No Render (web service) a porta vem em PORT; localmente
  // usa WORKER_PORT (ou 8787). WORKER_PORT tem prioridade se ambos existirem.
  port: num(process.env.WORKER_PORT, 0) || num(process.env.PORT, 8787),
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

/**
 * Números (chips) que o worker vai operar em paralelo.
 * WA_NUMBERS = lista separada por vírgula de telefones de pareamento (formato
 * internacional só dígitos, ex.: "5511999990001,5511999990002"). Cada um vira
 * uma sessão própria (cota e aquecimento independentes).
 *
 * Compatibilidade: se WA_NUMBERS estiver vazio, usa WA_PAIR_PHONE (1 número).
 * Se ambos vazios, sobe 1 sessão por QR (id "default").
 *
 * O id da sessão é o próprio número (ou "default"); a pasta de auth de cada
 * um fica em <authDir>/<id>.
 */
export function getNumbers() {
  const list = (process.env.WA_NUMBERS || "")
    .split(",")
    .map((s) => s.replace(/\D/g, ""))
    .filter(Boolean);
  const phones = list.length ? list : config.pairPhone ? [config.pairPhone] : [];
  if (phones.length === 0) return [{ id: "default", pairPhone: "" }];
  // Dedup preservando ordem.
  return [...new Set(phones)].map((p) => ({ id: p, pairPhone: p }));
}
