/**
 * Medição first-party do Zapien — sem cookies de terceiros, sem consentimento
 * necessário (nenhum dado pessoal é coletado):
 *
 *  - window.zapienTrack(nome, props) envia eventos de conversão para
 *    POST /api/events via sendBeacon (não bloqueia navegação);
 *  - UTMs (source/medium/campaign/content/term) + referrer + path de entrada
 *    são capturados na primeira visita e persistidos em localStorage por 30
 *    dias, viajando junto com cada evento (inclusive signup — atribuição);
 *  - id de sessão ANÔNIMO (uuid aleatório em sessionStorage) só para agrupar
 *    eventos da mesma visita;
 *  - Core Web Vitals (LCP, CLS, INP) são agregados e enviados uma única vez
 *    quando a página é ocultada.
 *
 * NUNCA coletar: conteúdo de conversa, telefone, CPF/CNPJ, senha, token.
 */
(function () {
  'use strict';

  var UTM_KEY = 'zapien_utm';
  var UTM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  function safeGet(store, key) {
    try { return store.getItem(key); } catch (e) { return null; }
  }
  function safeSet(store, key, value) {
    try { store.setItem(key, value); } catch (e) { /* Safari privado */ }
  }

  // --- Sessão anônima ---
  function sessionId() {
    var id = safeGet(sessionStorage, 'zapien_sid');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
      safeSet(sessionStorage, 'zapien_sid', id);
    }
    return id;
  }

  // --- Captura de UTMs (primeira visita ganha; expira em 30 dias) ---
  function captureUtms() {
    var params = new URLSearchParams(window.location.search);
    var utm = {};
    var has = false;
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
      var v = params.get(k);
      if (v) { utm[k] = String(v).slice(0, 120); has = true; }
    });
    if (has) {
      utm.referrer = String(document.referrer || '').slice(0, 300);
      utm.landing_path = window.location.pathname;
      utm.at = Date.now();
      safeSet(localStorage, UTM_KEY, JSON.stringify(utm));
      return utm;
    }
    var stored = safeGet(localStorage, UTM_KEY);
    if (!stored) return null;
    try {
      var parsed = JSON.parse(stored);
      if (Date.now() - (parsed.at || 0) > UTM_TTL_MS) return null;
      return parsed;
    } catch (e) { return null; }
  }

  var utms = captureUtms();

  function send(payload) {
    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: body, keepalive: true,
      }).catch(function () { /* medição nunca quebra a página */ });
    }
  }

  window.zapienTrack = function (name, props) {
    if (!name) return;
    send({
      name: String(name).slice(0, 40),
      props: props || undefined,
      sid: sessionId(),
      path: window.location.pathname,
      referrer: String(document.referrer || '').slice(0, 300),
      utm: utms || undefined,
    });
  };

  // --- Core Web Vitals (agregados, enviados uma vez ao ocultar a página) ---
  var vitals = { lcp: null, cls: 0, inp: null };
  var vitalsSent = false;
  if ('PerformanceObserver' in window) {
    try {
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        var last = entries[entries.length - 1];
        if (last) vitals.lcp = Math.round(last.startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) { /* navegador sem suporte */ }
    try {
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          if (!entry.hadRecentInput) vitals.cls += entry.value;
        });
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) { /* navegador sem suporte */ }
    try {
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          var dur = Math.round(entry.duration);
          if (vitals.inp === null || dur > vitals.inp) vitals.inp = dur;
        });
      }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
    } catch (e) { /* navegador sem suporte */ }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden' || vitalsSent) return;
    if (vitals.lcp === null && vitals.inp === null && vitals.cls === 0) return;
    vitalsSent = true;
    send({
      name: 'web_vitals',
      sid: sessionId(),
      path: window.location.pathname,
      props: {
        lcp_ms: vitals.lcp,
        cls: Math.round(vitals.cls * 1000) / 1000,
        inp_ms: vitals.inp,
      },
    });
  });
})();
