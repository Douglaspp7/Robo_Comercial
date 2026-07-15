import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config, billingEnabled } from './config.js';
import './db.js'; // inicializa o banco
import { webhookRouter, startInboundRecovery } from './webhook.js';
import { apiRouter } from './api.js';
import { requireAuth, requireAdmin } from './auth.js';
import { constructEvent, handleStripeEvent } from './billing.js';
import { startFollowUpScheduler } from './followup.js';
import { startDailySummaryScheduler } from './daily-summary.js';
import { startRepurchaseNoticeScheduler } from './repurchase-notify.js';
import { startBlingSyncScheduler } from './bling-sync.js';
import { startNuvemshopSyncScheduler } from './nuvemshop-sync.js';
// Tray removida da UI por ora (ver public/settings.html) — módulo em
// src/tray.js/tray-sync.js continua pronto, só não é mais iniciado aqui.
import { aiQueue, queueLimits } from './queue.js';
import { sendText, sendTemplate } from './whatsapp.js';
import { registerAlertSender, sendAlert, getRecentAlerts } from './alerts.js';
import { startUploadTmpSweep } from './upload.js';
import { startOutboundWorker, registerHandler, outboundMetrics } from './outbound-queue.js';
import { productWaitlistQueries } from './db.js';
import { knowledgeHealthMetrics, startKnowledgeWorker } from './knowledge/worker.js';
import { startMetaHealthScheduler, metaHealthAggregates } from './meta-health.js';
import { startAutomationWorker, automationHealthMetrics } from './automations/worker.js';
import { startConversionWorker } from './meta-capi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const app = express();

// Trust Render's reverse proxy so req.ip reflects the real client IP.
// Required for IP-based rate limiting (login/signup) to work correctly.
app.set('trust proxy', 1);

// --- Compressão (gzip/brotli) ---
// Reduz o tráfego em ~70% para HTML/CSS/JS. Imagens já vêm comprimidas
// (JPG/PNG/WebP), então o middleware pula sozinho. threshold:1024 evita
// gastar CPU comprimindo respostas pequenas (JSON de <1KB).
app.use(compression({ threshold: 1024 }));

// --- Security headers ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"], // inline onclick/onchange handlers in HTML pages
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Rate limiters are in ./limiters.js, imported by api.js

// IMPORTANTE: os webhooks precisam do corpo CRU (raw) para validar assinaturas.
// Por isso ficam ANTES do express.json().

// Raw body para verificação de assinatura Meta — somente no path exato /webhook.
// Outros paths como /webhook/evolution usam express.json() normalmente.
app.use((req, res, next) => {
  if (req.path === '/webhook' && req.method === 'POST') {
    express.raw({ type: 'application/json' })(req, res, (err) => {
      if (err) return next(err);
      req.rawBody = req.body;
      next();
    });
  } else {
    next();
  }
});

// Raw body for Stripe webhook
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!billingEnabled) return res.sendStatus(400);
  try {
    const event = constructEvent(req.body, req.headers['stripe-signature']);
    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// JSON for everything else (1mb limit)
app.use(express.json({ limit: '1mb' }));

app.use(cookieParser(config.sessionSecret));

// Healthcheck — inclui métricas AGREGADAS da fila de IA para visibilidade de
// saturação sem ferramenta externa (nenhum dado pessoal, nem ids de tenant).
// Se pending/oldest_wait_ms crescerem muito, o servidor está sob pressão
// (picos de webhook ou IA/WhatsApp lentos).
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptime_s: Math.round(process.uptime()),
    ai_queue: aiQueue.metrics(),
    outbound_queue: outboundMetrics(),
    knowledge: knowledgeHealthMetrics(),
    meta_health: metaHealthAggregates(),
    automations: automationHealthMetrics(),
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    alerts_recent: getRecentAlerts(),
  });
});

// Webhook do WhatsApp e API
app.use('/', webhookRouter);
app.use('/', apiRouter);

// Paginas protegidas: exigem login.
app.get(
  ['/dashboard.html', '/onboarding.html', '/settings.html', '/avisos.html', '/vendas.html', '/integrations.html', '/automations.html', '/plans.html', '/agenda.html'],
  requireAuth,
  (_req, _res, next) => next(),
);
// Pagina de admin: exige login + admin.
app.get('/admin.html', requireAuth, requireAdmin, (_req, _res, next) => next());

// Landing servida direto em '/': o express.static do diretório xlander
// vem antes do publicDir para que '/' entregue xlander/index.html (via
// autoindex) e para que os assets relativos do HTML da landing
// (img/foo.png, css/foo.css) resolvam sem precisar do prefixo /xlander/
// na barra de endereços. A URL antiga /xlander/ continua funcionando pelo
// static do publicDir logo abaixo.
//
// Cache-Control: assets versionados pelo build (?v=<hash> — ver
// scripts/build-assets.mjs) recebem cache longo e imutável: quando o
// conteúdo muda, o hash muda e o browser busca a URL nova. Assets sem hash
// (imagens, fonts) ficam com cache curto de 1 dia. HTML nunca é cacheado
// (para copies novos aparecerem imediatamente).
const staticOpts = {
  setHeaders(res, path) {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    const hasVersionHash = /[?&]v=[0-9a-f]{8}(&|$)/.test(res.req?.originalUrl || '');
    if (hasVersionHash) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/\.(jpg|jpeg|png|webp|svg|gif|ico|mp4|webm|mov|woff2?|ttf|eot|css|js)$/i.test(path)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
};
app.use(express.static(join(publicDir, 'xlander'), staticOpts));
// Arquivos estaticos (paginas do painel).
app.use(express.static(publicDir, staticOpts));

// Error handler
app.use((err, req, res, _next) => {
  if (err.validation) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

app.listen(config.port, () => {
  console.log(`Zapien rodando em ${config.appUrl} (porta ${config.port})`);
  console.log(`Modelo de IA: ${config.anthropic.model}`);
  console.log(`Billing: ${billingEnabled ? 'ativo' : 'desativado'}`);
  startFollowUpScheduler();
  startDailySummaryScheduler();
  startRepurchaseNoticeScheduler();
  startBlingSyncScheduler();
  startNuvemshopSyncScheduler();
  startInboundRecovery();
  startUploadTmpSweep();
  startKnowledgeWorker();
  startMetaHealthScheduler();
  startAutomationWorker();
  startConversionWorker();

  // Fila persistente de envios em massa. Cada tipo (campaign, restock, ...)
  // tem um handler simples que só chama a integração — o worker cuida de
  // concorrência, retentativa, backoff e reinício.
  registerHandler('campaign', async ({ tenant, item, jobPayload }) => {
    const { template_nome, template_idioma, variaveis } = jobPayload || {};
    return sendTemplate(tenant, item.destination, template_nome, template_idioma, variaveis || []);
  });
  // Templates disparados por automações: mesma fila persistente e o mesmo
  // envio de template das campanhas (retry/backoff/429 no outbound worker).
  registerHandler('automation_template', async ({ tenant, item, jobPayload }) => {
    const { template_nome, template_idioma, variaveis } = jobPayload || {};
    return sendTemplate(tenant, item.destination, template_nome, template_idioma || 'pt_BR', variaveis || []);
  });
  registerHandler('restock', async ({ tenant, item, jobPayload, payload }) => {
    const result = await sendText(tenant, item.destination, jobPayload?.mensagem || 'Produto disponível 🎉');
    // Marca a linha original da lista de espera para não avisar de novo.
    if (payload?.waiter_id) {
      try { productWaitlistQueries.markNotified.run(Number(payload.waiter_id)); } catch {}
    }
    return result;
  });
  startOutboundWorker();

  // Canal de alerta: envia via WhatsApp da plataforma (sendText direto, fora da fila).
  registerAlertSender((phone, text) => sendText(null, phone, text));

  // Jobs recusados por limite da fila (global/por tenant) geram alerta
  // operacional — sem dados pessoais, só o motivo e agregados.
  aiQueue.onReject = (reason) => {
    const m = aiQueue.metrics();
    sendAlert('queue', `fila de IA recusou job (${reason}) — backlog=${m.pending}, maior fila de tenant=${m.largest_tenant_queue}, espera máx=${Math.round(m.oldest_wait_ms / 1000)}s.`);
  };

  // Monitor de fila: alerta quando o backlog passa do limite (saturação) ou
  // quando o job mais antigo espera além de AI_QUEUE_MAX_WAIT_MS. O throttle
  // do módulo de alertas evita repetição. unref() p/ não segurar o processo.
  const QUEUE_ALERT_THRESHOLD = Number(process.env.QUEUE_ALERT_THRESHOLD) || 50;
  setInterval(() => {
    const m = aiQueue.metrics();
    if (m.pending >= QUEUE_ALERT_THRESHOLD || m.oldest_wait_ms >= queueLimits.maxWaitMs) {
      sendAlert('queue', `${m.pending} atendimentos na fila (limite: ${QUEUE_ALERT_THRESHOLD}), ${m.tenants_waiting} loja(s) aguardando, maior fila de tenant=${m.largest_tenant_queue}, espera máx=${Math.round(m.oldest_wait_ms / 1000)}s. Respostas podem estar atrasando.`);
    }
  }, 30 * 1000).unref();
});
