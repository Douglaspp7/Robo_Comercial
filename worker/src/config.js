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

  // Cota diária de envios POR CHIP (proteção anti-ban). Ao atingir, para até o
  // dia virar. 60 é um padrão moderado (2 chips = 120/dia). Cold outreach é
  // arriscado: ≤60 conservador; 60-100 só em chip aquecido com boa taxa de
  // resposta; >100 risco alto. Escale com MAIS CHIPS antes de subir por chip.
  dailyLimit: num(process.env.WA_DAILY_LIMIT, 60),

  // Aquecimento: nos primeiros dias de um número novo, limita ainda mais e sobe
  // gradual até a cota. Ex.: "15,25,40,55" = 15 no 1º dia de uso, 25 no 2º, 40
  // no 3º, 55 no 4º, depois dailyLimit. Chip novo queima fácil — não pule isto.
  warmupRamp: (process.env.WA_WARMUP_RAMP || "15,25,40,55")
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

  // URL do painel Next (que tem as chaves Google/Instagram) — usada pelo
  // agendador para rodar a busca sozinho. No Pi/Render o painel é local.
  panelUrl: (process.env.PANEL_URL || "http://localhost:3000").replace(/\/$/, ""),

  // Janela de horário de envio (hora local, 0-23). Ex.: "9-19" só envia das
  // 9h às 19h. Vazio = 24h. Cadência humana: não parecer robô de madrugada.
  sendWindow: parseWindow(process.env.WA_SEND_WINDOW),

  // Teto de envios por hora, POR número (0 = sem teto). Suaviza picos.
  maxPerHour: num(process.env.WA_MAX_PER_HOUR, 0),

  // Não recontatar o mesmo número entre campanhas dentro de N dias
  // (0 = permite recontato sempre). Ex.: 30 = pula quem já recebeu nos últimos
  // 30 dias, em qualquer campanha.
  recontactDays: num(process.env.WA_RECONTACT_DAYS, 0),

  // Palavras que, recebidas de um contato, o removem da lista (opt-out).
  optoutKeywords: (process.env.WA_OPTOUT_KEYWORDS ||
    "sair,parar,pare,cancelar,stop,descadastrar,remover")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Rodapé opcional anexado a cada mensagem (ex.: "Responda SAIR para não
  // receber."). Vazio = não anexa.
  optoutFooter: (process.env.WA_OPTOUT_FOOTER || "").trim(),

  // ── Atendente (cópia do Zapien que vende Zapien) ────────────────────────
  // URL do atendente que recebe as RESPOSTAS dos leads e as responde pelo mesmo
  // chip. Vazio = worker só dispara + opt-out (comportamento atual). Setado =
  // o worker vira gateway e encaminha toda resposta (que não for opt-out) para
  // ATTENDANT_URL/inbound. O atendente devolve a resposta chamando POST /send.
  attendantUrl: (process.env.ATTENDANT_URL || "").replace(/\/$/, ""),
  // Segredo que o worker envia ao atendente (header x-worker-token) ao
  // encaminhar uma resposta. O atendente valida com o mesmo valor.
  attendantToken: process.env.ATTENDANT_TOKEN || "",

  // Resumo diário operacional enviado ao WhatsApp do administrador.
  // Telefone vazio desativa. Horário local do Raspberry Pi no formato HH:MM.
  adminSummaryPhone: (process.env.ADMIN_SUMMARY_PHONE || "").replace(/\D/g, ""),
  adminSummaryTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(process.env.ADMIN_SUMMARY_TIME || "")
    ? process.env.ADMIN_SUMMARY_TIME
    : "20:00",
};

/** "9-19" -> { start: 9, end: 19 }; vazio/ inválido -> null (24h). */
function parseWindow(raw) {
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec((raw || "").trim());
  if (!m) return null;
  const start = Math.max(0, Math.min(23, Number(m[1])));
  const end = Math.max(1, Math.min(24, Number(m[2])));
  return end > start ? { start, end } : null;
}

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
