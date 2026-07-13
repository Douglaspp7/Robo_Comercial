"use client";

import { useState, useEffect } from "react";
import { Search, Loader2, Download, Send, X, MessageCircle, SkipForward, Pause, Play } from "lucide-react";
import * as XLSX from "xlsx";
import styles from "./page.module.css";

interface Business {
  id: string;
  name: string;
  address: string;
  rating: number;
  phone: string;
  website: string;
  email?: string;
}

// Estado do worker de disparo na nuvem (Pi), lido de GET /api/wa-campaign.
interface CloudCampaign {
  id: number;
  name: string;
  status: string; // active | paused | done
  created_at: number;
  total: number;
  sent: number | null;
  pending: number | null;
  failed: number | null;
  invalid: number | null;
}
interface CloudStatus {
  wa: {
    status: string;
    connected: boolean;
    qr: string | null;
    me: string | null;
    lastError: string | null;
  };
  paused: boolean;
  today: number;
  limit: number;
  campaigns: CloudCampaign[];
  error?: string;
}

const getWaNumber = (phone: string): string | null => {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, "");
  if (clean.length >= 10) {
    // Adiciona DDI do Brasil (55) se não houver
    return clean.startsWith("55") ? clean : `55${clean}`;
  }
  return null;
};

const getWaLink = (phone: string) => {
  const num = getWaNumber(phone);
  return num ? `https://wa.me/${num}` : null;
};

// Monta o link wa.me já com a mensagem personalizada (substitui {nome}) + URL do app
const buildWaMessageLink = (
  biz: { name: string; phone: string },
  message: string,
  appUrl: string
): string | null => {
  const num = getWaNumber(biz.phone);
  if (!num) return null;
  let text = (message || "").replace(/\{nome\}/gi, biz.name || "");
  if (appUrl.trim()) {
    text = `${text}\n\n${appUrl.trim()}`;
  }
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
};

const randomBetween = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// Persistência da campanha de WhatsApp (cota diária + histórico de enviados)
const LS_WA_DAILY = "robo_wa_daily"; // { date: "YYYY-MM-DD", count: number }
const LS_WA_LIMIT = "robo_wa_limit"; // number
const LS_WA_SENT = "robo_wa_sent"; // string[] de ids já enviados

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function Home() {
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [deepSearch, setDeepSearch] = useState(false);
  const [regionsText, setRegionsText] = useState("");
  // Fonte de leads: Google Maps (padrão) ou Instagram (perfis comerciais).
  const [source, setSource] = useState<"google" | "instagram">("google");
  const [igMode, setIgMode] = useState<"hashtag" | "profiles">("hashtag");
  const [igQuery, setIgQuery] = useState("");
  const [discoveringRegions, setDiscoveringRegions] = useState(false);
  const [results, setResults] = useState<Business[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Email Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  // WhatsApp Campaign State
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [waMessage, setWaMessage] = useState(
    "Olá {nome}! Tudo bem? Tenho um app que pode ajudar o seu negócio. Dá uma olhada:"
  );
  const [waAppUrl, setWaAppUrl] = useState("");
  const [waMinDelay, setWaMinDelay] = useState(30);
  const [waMaxDelay, setWaMaxDelay] = useState(90);
  const [waQueue, setWaQueue] = useState<Business[]>([]);
  const [waIndex, setWaIndex] = useState(0);
  const [waSentIds, setWaSentIds] = useState<Set<string>>(new Set());
  const [waRunning, setWaRunning] = useState(false);
  const [waPaused, setWaPaused] = useState(false);
  const [waCountdown, setWaCountdown] = useState(0);
  // Cota diária + histórico persistente (resume)
  const [waDailyLimit, setWaDailyLimit] = useState(40);
  const [waDailyCount, setWaDailyCount] = useState(0);
  const [waPersistSent, setWaPersistSent] = useState<Set<string>>(new Set());
  // Modo macro: cadência controlada por script externo (AutoHotkey). Atalho F2 dispara o envio.
  const [waMacroMode, setWaMacroMode] = useState(false);
  // Disparo na nuvem: envia a fila para o worker (Raspberry Pi) que dispara sozinho.
  const [cloudSending, setCloudSending] = useState(false);
  // Painel de acompanhamento do robô na nuvem (Pi).
  const [cloudPanelOpen, setCloudPanelOpen] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus | null>(null);

  const handleDiscoverRegions = async () => {
    if (!location.trim()) {
      alert("Informe a cidade antes de descobrir os bairros.");
      return;
    }
    setDiscoveringRegions(true);
    try {
      const res = await fetch("/api/regions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: location }),
      });
      const data = await res.json();
      if (data.regions && data.regions.length > 0) {
        // Mescla com o que já estiver no campo, sem duplicar
        const existing = regionsText
          .split(/[\n,]/)
          .map((r: string) => r.trim())
          .filter((r: string) => r.length > 0);
        const merged = Array.from(new Set([...existing, ...data.regions]));
        setRegionsText(merged.join("\n"));
        if (!data.strict) {
          alert(
            `Encontrei ${data.regions.length} regiões aproximadas para "${location}". Revise a lista antes de buscar.`
          );
        }
      } else {
        alert(
          "Não consegui descobrir bairros automaticamente para essa cidade. Tente digitar manualmente."
        );
      }
    } catch (err) {
      console.error(err);
      alert("Falha ao descobrir os bairros.");
    } finally {
      setDiscoveringRegions(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    // Fonte Instagram: fluxo próprio (por hashtag ou por lista de perfis).
    if (source === "instagram") {
      if (!igQuery.trim()) return;
      setLoading(true);
      setNextPageToken(null);
      try {
        const res = await fetch("/api/instagram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: igMode, query: igQuery }),
        });
        const data = await res.json();
        if (data.results) {
          setResults((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const newUnique = data.results.filter(
              (r: Business) => !existingIds.has(r.id)
            );
            return [...prev, ...newUnique];
          });
          if (data.results.length === 0) {
            alert(
              "Nenhum contato público encontrado. Tente outra hashtag ou perfis " +
                "comerciais que tenham WhatsApp/telefone na bio."
            );
          }
        } else {
          alert("Erro no Instagram: " + (data.error || "Desconhecido"));
        }
      } catch (err) {
        console.error(err);
        alert("Falha ao consultar o Instagram.");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!niche || !location) return;

    setLoading(true);
    setNextPageToken(null);
    // Removemos o setResults([]) para que ele não apague a lista atual

    // Bairros/regiões: um por linha (ou separados por vírgula)
    const regions = regionsText
      .split(/[\n,]/)
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `${niche} in ${location}`,
          deep: deepSearch,
          regions: deepSearch ? regions : undefined,
        }),
      });
      const data = await res.json();
      if (data.results) {
        // Agora ele soma os resultados novos com os antigos que já estão na tela
        setResults((prev) => {
          // Filtra duplicatas pelo ID (caso pesquise a mesma coisa sem querer)
          const existingIds = new Set(prev.map(p => p.id));
          const newUnique = data.results.filter((r: Business) => !existingIds.has(r.id));
          return [...prev, ...newUnique];
        });
        setNextPageToken(data.nextPageToken);
      } else {
        alert("Erro ao buscar resultados: " + (data.error || "Desconhecido"));
      }
    } catch (err) {
      console.error(err);
      alert("Falha na conexão com a API.");
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (!niche || !location || !nextPageToken) return;

    setLoadingMore(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          query: `${niche} in ${location}`,
          pageToken: nextPageToken
        }),
      });
      const data = await res.json();
      if (data.results) {
        setResults((prev) => {
          const existingIds = new Set(prev.map(p => p.id));
          const newUnique = data.results.filter((r: Business) => !existingIds.has(r.id));
          return [...prev, ...newUnique];
        });
        setNextPageToken(data.nextPageToken);
      } else {
        alert("Erro ao buscar mais resultados: " + (data.error || "Desconhecido"));
      }
    } catch (err) {
      console.error(err);
      alert("Falha na conexão com a API.");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleExportExcel = () => {
    if (results.length === 0) return;
    
    const formattedData = results.map(biz => ({
      "ID Interno": biz.id,
      "Nome": biz.name,
      "Canal": getWaLink(biz.phone) ? "WhatsApp" : biz.email ? "E-mail" : "Sem contato",
      "Endereço": biz.address,
      "Avaliação": biz.rating || "",
      "Telefone": biz.phone || "",
      "Link WhatsApp": getWaLink(biz.phone) || "",
      "E-mail": biz.email || "",
      "Website": biz.website || ""
    }));

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Empresas");
    XLSX.writeFile(workbook, `empresas_${niche || "lista"}_${location || "exportada"}.xlsx`);
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: "binary" });
        const wsname = workbook.SheetNames[0];
        const ws = workbook.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        
        const parsedData = data.map((row: any) => ({
          id: row["ID Interno"] || String(Math.random()),
          name: row["Nome"] || "",
          address: row["Endereço"] || "",
          rating: row["Avaliação"] || 0,
          phone: row["Telefone"] || "",
          email: row["E-mail"] || "",
          website: row["Website"] || ""
        })) as Business[];

        setResults((prev) => {
          const existingIds = new Set(prev.map(p => p.id));
          const newUnique = parsedData.filter((r) => r.id && !existingIds.has(r.id));
          return [...prev, ...newUnique];
        });
        setNextPageToken(null);
        alert("Planilha importada e adicionada à tabela com sucesso!");
      } catch (err) {
        console.error(err);
        alert("Erro ao ler o arquivo Excel.");
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleClear = () => {
    if (confirm("Tem certeza que deseja limpar a lista inteira?")) {
      setResults([]);
      setNextPageToken(null);
      setSelectedIds(new Set());
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const selectAll = () => {
    if (selectedIds.size === results.length) {
      setSelectedIds(newSet => new Set());
    } else {
      setSelectedIds(new Set(results.map((r) => r.id)));
    }
  };

  const handleSendEmails = async () => {
    if (selectedIds.size === 0) return alert("Selecione pelo menos um contato.");
    if (!emailSubject || !emailBody) return alert("Preencha o assunto e a mensagem.");

    setEmailLoading(true);
    // Filtrar apenas as empresas selecionadas
    const targets = results.filter((r) => selectedIds.has(r.id));

    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets, subject: emailSubject, body: emailBody }),
      });
      const data = await res.json();
      if (data.success) {
        alert(
          `E-mails enviados: ${data.sent}.` +
            (data.skipped ? `\n${data.skipped} pulado(s) por não ter e-mail.` : "") +
            (data.errors ? `\n${data.errors.length} com erro.` : "")
        );
        setIsModalOpen(false);
      } else {
        alert("Erro ao enviar: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Falha ao enviar e-mails.");
    } finally {
      setEmailLoading(false);
    }
  };

  // ---------------------------------------------------------------
  // CAMPANHA DE WHATSAPP (wa.me semi-automático, cadência aleatória)
  // ---------------------------------------------------------------

  // Cronômetro da cadência: decrementa enquanto a campanha estiver ativa e não pausada.
  useEffect(() => {
    if (!waRunning || waPaused) return;
    const id = setInterval(() => {
      setWaCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [waRunning, waPaused]);

  // Carrega cota/histórico do localStorage ao iniciar (reseta a contagem se virou o dia).
  useEffect(() => {
    try {
      const today = todayStr();
      const rawDaily = localStorage.getItem(LS_WA_DAILY);
      if (rawDaily) {
        const d = JSON.parse(rawDaily);
        if (d.date === today) {
          setWaDailyCount(d.count || 0);
        } else {
          localStorage.setItem(LS_WA_DAILY, JSON.stringify({ date: today, count: 0 }));
          setWaDailyCount(0);
        }
      }
      const rawLimit = localStorage.getItem(LS_WA_LIMIT);
      if (rawLimit) setWaDailyLimit(Number(rawLimit) || 40);
      const rawSent = localStorage.getItem(LS_WA_SENT);
      if (rawSent) setWaPersistSent(new Set(JSON.parse(rawSent)));
    } catch (e) {
      console.error("Falha ao ler campanha salva:", e);
    }
  }, []);

  // Persiste o limite diário sempre que ele mudar.
  useEffect(() => {
    try {
      localStorage.setItem(LS_WA_LIMIT, String(waDailyLimit));
    } catch {}
  }, [waDailyLimit]);

  const quotaReached = waDailyCount >= waDailyLimit;

  // Atalho de teclado F2: dispara o envio do contato atual (para macro/AutoHotkey).
  useEffect(() => {
    if (!isWaModalOpen || !waRunning) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F2") return;
      e.preventDefault();
      const ready = !waPaused && !quotaReached && waIndex < waQueue.length;
      if (ready && (waMacroMode || waCountdown === 0)) {
        sendCurrentWa();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWaModalOpen, waRunning, waPaused, quotaReached, waIndex, waCountdown, waMacroMode]);

  const openWaCampaign = () => {
    const targets = results.filter((r) => selectedIds.has(r.id) && getWaNumber(r.phone));
    if (targets.length === 0) {
      return alert("Nenhum dos contatos selecionados tem um telefone válido para WhatsApp.");
    }
    // Resume: pula quem já foi enviado em campanhas anteriores
    const remaining = targets.filter((r) => !waPersistSent.has(r.id));
    const already = targets.length - remaining.length;
    if (remaining.length === 0) {
      return alert(
        `Todos os ${targets.length} contatos selecionados já foram enviados antes. ` +
          "Use 'Limpar histórico' se quiser enviar novamente."
      );
    }
    if (already > 0) {
      alert(`${already} contato(s) já enviados anteriormente foram pulados (resume).`);
    }
    setWaQueue(remaining);
    setWaIndex(0);
    setWaSentIds(new Set());
    setWaRunning(false);
    setWaPaused(false);
    setWaCountdown(0);
    setIsWaModalOpen(true);
  };

  // Registra um envio: incrementa a cota diária e grava no histórico persistente.
  const recordSent = (id: string) => {
    const today = todayStr();
    setWaDailyCount((c) => {
      const nc = c + 1;
      try {
        localStorage.setItem(LS_WA_DAILY, JSON.stringify({ date: today, count: nc }));
      } catch {}
      return nc;
    });
    setWaPersistSent((prev) => {
      const ns = new Set(prev).add(id);
      try {
        localStorage.setItem(LS_WA_SENT, JSON.stringify([...ns]));
      } catch {}
      return ns;
    });
  };

  const clearWaHistory = () => {
    if (!confirm("Limpar o histórico de enviados? Os contatos poderão ser enviados novamente.")) return;
    setWaPersistSent(new Set());
    try {
      localStorage.removeItem(LS_WA_SENT);
    } catch {}
  };

  const resetWaQuota = () => {
    setWaDailyCount(0);
    try {
      localStorage.setItem(LS_WA_DAILY, JSON.stringify({ date: todayStr(), count: 0 }));
    } catch {}
  };

  const startWaCampaign = () => {
    if (waMinDelay > waMaxDelay) {
      return alert("O intervalo mínimo não pode ser maior que o máximo.");
    }
    if (!waMessage.trim()) {
      return alert("Escreva a mensagem padrão antes de iniciar.");
    }
    setWaRunning(true);
    setWaPaused(false);
    setWaCountdown(0); // o primeiro contato fica disponível imediatamente
  };

  // Bipe sonoro via Web Audio (sem arquivo). type: "done" | "warn"
  const playBeep = (type: "done" | "warn") => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const notes = type === "done" ? [660, 880] : [400, 300];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.value = 0.12;
        const start = ctx.currentTime + i * 0.18;
        osc.start(start);
        osc.stop(start + 0.16);
      });
      setTimeout(() => ctx.close(), 600);
    } catch {
      // navegador sem suporte / bloqueio de áudio: ignora silenciosamente
    }
  };

  const advanceWaQueue = () => {
    setWaIndex((prev) => {
      const next = prev + 1;
      if (next >= waQueue.length) {
        setWaRunning(false);
        playBeep("done"); // fim da campanha
      } else if (waMacroMode) {
        // No modo macro o script externo controla a cadência: libera imediatamente.
        setWaCountdown(0);
      } else {
        // Próximo só libera após um intervalo aleatório (humanizado)
        setWaCountdown(randomBetween(waMinDelay, waMaxDelay));
      }
      return next;
    });
  };

  const sendCurrentWa = () => {
    if (quotaReached) {
      playBeep("warn");
      return alert(`Cota diária atingida (${waDailyCount}/${waDailyLimit}). Continue amanhã.`);
    }
    const biz = waQueue[waIndex];
    if (!biz) return;
    const link = buildWaMessageLink(biz, waMessage, waAppUrl);
    if (link) {
      window.open(link, "_blank", "noopener,noreferrer");
      setWaSentIds((prev) => new Set(prev).add(biz.id));
      recordSent(biz.id);
    }
    advanceWaQueue();
  };

  const skipCurrentWa = () => {
    advanceWaQueue();
  };

  // Envia a fila para o worker na nuvem (Pi), que dispara sozinho 24/7
  // respeitando cota/intervalos do servidor. Não abre wa.me no navegador.
  const sendCloudCampaign = async () => {
    if (!waMessage.trim()) {
      return alert("Escreva a mensagem padrão antes de disparar.");
    }
    if (waQueue.length === 0) {
      return alert("Nenhum contato com WhatsApp válido na fila.");
    }
    if (
      !confirm(
        `Enviar ${waQueue.length} contato(s) pelo robô na nuvem (Pi)?\n\n` +
          "O worker dispara aos poucos, sozinho, respeitando a cota diária e os " +
          "intervalos configurados no servidor — você não precisa ficar clicando."
      )
    ) {
      return;
    }
    setCloudSending(true);
    try {
      const res = await fetch("/api/wa-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Campanha ${new Date().toLocaleDateString("pt-BR")}`,
          message: waMessage,
          app_url: waAppUrl,
          contacts: waQueue.map((b) => ({
            id: b.id,
            name: b.name,
            phone: b.phone,
          })),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(
          "Campanha enviada para o robô na nuvem! ✅\n" +
            `${data.added} contato(s) na fila` +
            (data.ignored ? `, ${data.ignored} já existiam (ignorados).` : ".") +
            "\n\nO Pi vai disparar aos poucos, sozinho. Pode fechar o app."
        );
        setIsWaModalOpen(false);
      } else {
        alert(
          "Não foi possível enviar para a nuvem: " +
            (data.error || `erro ${res.status}`)
        );
      }
    } catch (err) {
      console.error(err);
      alert("Falha ao falar com o robô na nuvem. Ele está ligado no Pi?");
    } finally {
      setCloudSending(false);
    }
  };

  // Lê o estado do robô na nuvem (conexão, cota e progresso das campanhas).
  const fetchCloudStatus = async () => {
    try {
      const res = await fetch("/api/wa-campaign", { cache: "no-store" });
      const data = await res.json();
      setCloudStatus(data);
    } catch {
      setCloudStatus({
        wa: { status: "offline", connected: false, qr: null, me: null, lastError: null },
        paused: false,
        today: 0,
        limit: 0,
        campaigns: [],
        error: "offline",
      });
    }
  };

  // Enquanto o painel estiver aberto, atualiza a cada 8s.
  useEffect(() => {
    if (!cloudPanelOpen) return;
    fetchCloudStatus();
    const id = setInterval(fetchCloudStatus, 8000);
    return () => clearInterval(id);
  }, [cloudPanelOpen]);

  const toggleCloudPause = async () => {
    const action = cloudStatus?.paused ? "resume" : "pause";
    try {
      await fetch("/api/wa-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      fetchCloudStatus();
    } catch {
      alert("Não consegui falar com o robô na nuvem.");
    }
  };

  const cloudCampaignAction = async (id: number, action: string) => {
    if (
      action === "cancel" &&
      !confirm("Cancelar esta campanha? Os contatos pendentes não serão enviados.")
    ) {
      return;
    }
    try {
      await fetch("/api/wa-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: id, action }),
      });
      fetchCloudStatus();
    } catch {
      alert("Não consegui falar com o robô na nuvem.");
    }
  };

  const stopWaCampaign = () => {
    setWaRunning(false);
    setWaPaused(false);
    setWaCountdown(0);
  };

  // Cor/rótulo do indicador de conexão do robô na nuvem.
  const waConn = cloudStatus?.wa;
  const cloudConnMeta =
    !cloudStatus || cloudStatus.error || waConn?.status === "offline"
      ? { color: "#ef4444", label: "Offline — worker desligado?" }
      : waConn?.connected
      ? { color: "#22c55e", label: "Conectado" }
      : waConn?.status === "qr"
      ? { color: "#f59e0b", label: "Aguardando pareamento" }
      : { color: "#f59e0b", label: "Conectando..." };

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Robô Comercial</h1>
        <p className={styles.subtitle}>Extração oficial de leads e comunicação automatizada</p>
      </header>

      <section className="glass-panel">
        <form className={styles.searchForm} onSubmit={handleSearch}>
          {/* Seletor de fonte de leads */}
          <div style={{ flexBasis: "100%", display: "flex", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <button
              type="button"
              className={source === "google" ? "btn-primary" : "btn-secondary"}
              onClick={() => setSource("google")}
            >
              📍 Google Maps
            </button>
            <button
              type="button"
              className={source === "instagram" ? "btn-primary" : "btn-secondary"}
              onClick={() => setSource("instagram")}
            >
              📸 Instagram
            </button>
          </div>

          {source === "google" && (
            <>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Nicho de Mercado</label>
                <input
                  type="text"
                  className="input-glass"
                  placeholder="Ex: Barbearia, Salão de Beleza..."
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  required
                />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Localidade (Cidade/Estado)</label>
                <input
                  type="text"
                  className="input-glass"
                  placeholder="Ex: São Paulo, SP"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          {source === "instagram" && (
            <div style={{ flexBasis: "100%" }}>
              <div style={{ display: "flex", gap: "1rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="igmode"
                    checked={igMode === "hashtag"}
                    onChange={() => setIgMode("hashtag")}
                  />
                  Por hashtag/nicho
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="igmode"
                    checked={igMode === "profiles"}
                    onChange={() => setIgMode("profiles")}
                  />
                  Por perfis (@)
                </label>
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>
                  {igMode === "hashtag"
                    ? "Hashtag ou termo (sem #)"
                    : "Perfis comerciais (@um, @dois — separados por espaço/vírgula)"}
                </label>
                {igMode === "hashtag" ? (
                  <input
                    type="text"
                    className="input-glass"
                    placeholder="Ex: barbeariasp, petshoprj..."
                    value={igQuery}
                    onChange={(e) => setIgQuery(e.target.value)}
                  />
                ) : (
                  <textarea
                    className={styles.textareaGlass}
                    placeholder={"@barbearia.x\n@petshop.y\n@moda.z"}
                    value={igQuery}
                    onChange={(e) => setIgQuery(e.target.value)}
                    rows={3}
                  />
                )}
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted, #888)", marginTop: "0.25rem" }}>
                  Busca posts/perfis comerciais e extrai só quem tem WhatsApp/telefone
                  público. Requer a API do Instagram configurada (ver docs/INSTAGRAM.md).
                </p>
              </div>
            </div>
          )}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Search size={20} />}
            {loading && deepSearch ? "Buscando tudo..." : "Buscar"}
          </button>

          <div className={styles.inputGroup} style={{ flex: 0 }}>
            <label className={styles.label}>Ou Importe Excel</label>
            <label className="btn-secondary" style={{ cursor: "pointer", textAlign: "center", display: "inline-block" }}>
              Carregar Arquivo
              <input type="file" accept=".xlsx, .xls" style={{ display: "none" }} onChange={handleImportExcel} />
            </label>
          </div>

          {/* Busca Profunda (só no Google Maps) */}
          {source === "google" && (
          <div style={{ flexBasis: "100%", marginTop: "0.5rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={deepSearch}
                onChange={(e) => setDeepSearch(e.target.checked)}
              />
              Busca Profunda (varre todas as páginas e cobre a cidade por bairros)
            </label>

            {deepSearch && (
              <div className={styles.inputGroup} style={{ marginTop: "0.75rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <label className={styles.label}>
                    Bairros / Regiões (opcional — um por linha ou separados por vírgula)
                  </label>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleDiscoverRegions}
                    disabled={discoveringRegions}
                    style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
                  >
                    {discoveringRegions ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                    {discoveringRegions ? "Descobrindo..." : "Descobrir bairros"}
                  </button>
                </div>
                <textarea
                  className={styles.textareaGlass}
                  placeholder={"Centro\nMoema\nPinheiros\nTatuapé..."}
                  value={regionsText}
                  onChange={(e) => setRegionsText(e.target.value)}
                  rows={4}
                />
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted, #888)", marginTop: "0.25rem" }}>
                  Deixe em branco para varrer apenas a cidade (até ~60 resultados). Informe bairros para
                  cobrir muito mais da cidade. Cada bairro gera chamadas extras à API do Google.
                </p>
              </div>
            )}
          </div>
          )}
        </form>
      </section>

      {/* Painel de acompanhamento do robô na nuvem (Pi) */}
      <section className="glass-panel" style={{ padding: "1.5rem", marginTop: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <h2 className={styles.subtitle} style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: "0.6rem" }}>
            🤖 Robô na nuvem (Pi)
            {cloudPanelOpen && (
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: cloudConnMeta.color, display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: cloudConnMeta.color, display: "inline-block" }} />
                {cloudConnMeta.label}
              </span>
            )}
          </h2>
          <button className="btn-secondary" onClick={() => setCloudPanelOpen((o) => !o)}>
            {cloudPanelOpen ? "Ocultar" : "Acompanhar disparos"}
          </button>
        </div>

        {cloudPanelOpen && (
          <div style={{ marginTop: "1.25rem" }}>
            {/* Linha de estado + controle global */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.9rem" }}>
                Enviadas hoje:{" "}
                <strong>{cloudStatus?.today ?? 0}/{cloudStatus?.limit ?? 0}</strong>
                {cloudStatus?.paused && (
                  <span style={{ color: "var(--error)", marginLeft: "0.75rem", fontWeight: 600 }}>
                    ⏸ Pausado
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button className="btn-secondary" onClick={fetchCloudStatus} style={{ fontSize: "0.8rem" }}>
                  Atualizar
                </button>
                <button
                  className="btn-secondary"
                  onClick={toggleCloudPause}
                  disabled={!cloudStatus || Boolean(cloudStatus.error)}
                  style={{ fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
                >
                  {cloudStatus?.paused ? <Play size={16} /> : <Pause size={16} />}
                  {cloudStatus?.paused ? "Retomar tudo" : "Pausar tudo"}
                </button>
              </div>
            </div>

            {/* Aviso quando não está conectado */}
            {cloudStatus && !cloudStatus.wa?.connected && (
              <div style={{ fontSize: "0.85rem", color: "var(--text-muted, #888)", marginBottom: "1rem", padding: "0.75rem", background: "rgba(245,158,11,0.08)", borderRadius: "8px" }}>
                {cloudStatus.error || cloudStatus.wa?.status === "offline"
                  ? "O worker no Pi não respondeu. Confira se ele está ligado (npm start) e o WORKER_URL configurado."
                  : typeof cloudStatus.wa?.qr === "string" && cloudStatus.wa.qr.startsWith("PAIR:")
                  ? `Aguardando pareamento. Código: ${cloudStatus.wa.qr.replace("PAIR:", "")} — digite no celular do número (Aparelhos conectados › Conectar com número).`
                  : "Número ainda não conectado. Pareie no Pi com “npm run pair”."}
              </div>
            )}

            {/* Lista de campanhas */}
            {cloudStatus && cloudStatus.campaigns.length === 0 ? (
              <p style={{ fontSize: "0.9rem", color: "var(--text-muted, #888)" }}>
                Nenhuma campanha ainda. Selecione contatos e use “Disparar na nuvem (Pi)”.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {(cloudStatus?.campaigns || []).map((c) => {
                  const sent = c.sent || 0;
                  const failed = c.failed || 0;
                  const invalid = c.invalid || 0;
                  const done = sent + failed + invalid;
                  const pct = c.total > 0 ? Math.round((done / c.total) * 100) : 0;
                  return (
                    <div key={c.id} className="glass-panel" style={{ padding: "1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                        <div style={{ fontWeight: 700 }}>
                          {c.name}{" "}
                          <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--text-muted, #888)" }}>
                            ({c.status === "active" ? "ativa" : c.status === "paused" ? "pausada" : "concluída"})
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          {c.status !== "done" && (
                            <button
                              className="btn-secondary"
                              onClick={() => cloudCampaignAction(c.id, c.status === "paused" ? "resume" : "pause")}
                              style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem" }}
                            >
                              {c.status === "paused" ? "Retomar" : "Pausar"}
                            </button>
                          )}
                          {c.status !== "done" && (
                            <button
                              className="btn-secondary"
                              onClick={() => cloudCampaignAction(c.id, "cancel")}
                              style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem", color: "var(--error)", borderColor: "var(--error)" }}
                            >
                              Cancelar
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{ height: "8px", background: "rgba(255,255,255,0.1)", borderRadius: "4px", overflow: "hidden", margin: "0.6rem 0" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: "#25D366", transition: "width 0.3s" }} />
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #888)", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                        <span>✅ {sent} enviadas</span>
                        <span>⏳ {c.pending || 0} na fila</span>
                        {failed > 0 && <span style={{ color: "var(--error)" }}>⚠ {failed} falhas</span>}
                        {invalid > 0 && <span>🚫 {invalid} sem WhatsApp</span>}
                        <span>· {c.total} total</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {results.length > 0 && (
        <section className="glass-panel" style={{ padding: "2rem" }}>
          <div className={styles.resultsHeader}>
            <h2 className={styles.subtitle}>
              {results.length} empresas encontradas
            </h2>
            <div className={styles.actions}>
              <button className="btn-secondary" onClick={handleClear} style={{ color: "var(--error)", borderColor: "var(--error)" }}>
                Limpar Lista
              </button>
              <button className="btn-secondary" onClick={handleExportExcel}>
                <Download size={18} style={{ marginRight: 8, display: "inline" }} />
                Exportar Excel ({results.length})
              </button>
              <button
                className="btn-secondary"
                onClick={openWaCampaign}
                disabled={selectedIds.size === 0}
                style={{ color: "#25D366", borderColor: "#25D366", display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
              >
                <MessageCircle size={18} />
                Disparar WhatsApp ({selectedIds.size})
              </button>
              <button
                className="btn-primary"
                onClick={() => setIsModalOpen(true)}
                disabled={selectedIds.size === 0}
              >
                <Send size={18} />
                Preparar E-mails ({selectedIds.size})
              </button>
            </div>
          </div>

          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th} style={{ width: "50px" }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.size === results.length && results.length > 0}
                      onChange={selectAll}
                    />
                  </th>
                  <th className={styles.th}>Nome</th>
                  <th className={styles.th}>Canal</th>
                  <th className={styles.th}>Endereço</th>
                  <th className={styles.th}>Telefone</th>
                  <th className={styles.th}>E-mail</th>
                  <th className={styles.th}>Website</th>
                </tr>
              </thead>
              <tbody>
                {results.map((biz) => (
                  <tr key={biz.id} className={styles.tr}>
                    <td className={styles.td}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(biz.id)}
                        onChange={() => toggleSelect(biz.id)}
                      />
                    </td>
                    <td className={styles.td}>
                      <strong>{biz.name}</strong>
                      {biz.rating && (
                        <div style={{ fontSize: "0.8rem", color: "var(--accent)" }}>
                          ★ {biz.rating}
                        </div>
                      )}
                    </td>
                    <td className={styles.td}>
                      {(() => {
                        const badge = (bg: string, txt: string) => (
                          <span
                            style={{
                              background: bg,
                              color: "white",
                              padding: "3px 8px",
                              borderRadius: "999px",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {txt}
                          </span>
                        );
                        if (getWaLink(biz.phone)) return badge("#25D366", "📱 Zap");
                        if (biz.email) return badge("#3b82f6", "✉️ E-mail");
                        return (
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted, #888)" }}>
                            — sem contato
                          </span>
                        );
                      })()}
                    </td>
                    <td className={styles.td}>{biz.address}</td>
                    <td className={styles.td}>
                      {biz.phone ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {biz.phone}
                          {getWaLink(biz.phone) && (
                            <a 
                              href={getWaLink(biz.phone)!} 
                              target="_blank" 
                              rel="noreferrer"
                              style={{
                                background: "#25D366",
                                color: "white",
                                padding: "4px 8px",
                                borderRadius: "4px",
                                fontSize: "0.8rem",
                                fontWeight: "bold"
                              }}
                            >
                              WhatsApp
                            </a>
                          )}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className={styles.td}>{biz.email || "-"}</td>
                    <td className={styles.td}>
                      {biz.website ? (
                        <a href={biz.website} target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>
                          Link
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {nextPageToken && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: "2rem" }}>
              <button 
                className="btn-secondary" 
                onClick={handleLoadMore} 
                disabled={loadingMore}
                style={{ width: "200px", justifyContent: "center", display: "flex" }}
              >
                {loadingMore ? <Loader2 className="animate-spin" /> : "Carregar Mais Resultados"}
              </button>
            </div>
          )}
        </section>
      )}

      {/* Modal de E-mail */}
      {isModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={`glass-panel ${styles.modalContent}`}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Enviar Mensagem</h2>
              <button className={styles.closeButton} onClick={() => setIsModalOpen(false)}>
                <X size={24} />
              </button>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #888)", marginBottom: "1rem" }}>
              {(() => {
                const sel = results.filter((r) => selectedIds.has(r.id));
                const withEmail = sel.filter((r) => r.email).length;
                return `${withEmail} de ${sel.length} selecionado(s) têm e-mail — os demais serão pulados. Bom fallback para leads do Instagram sem WhatsApp.`;
              })()}
            </p>

            <div className={styles.inputGroup}>
              <label className={styles.label}>Assunto do E-mail</label>
              <input
                type="text"
                className="input-glass"
                placeholder="Uma oferta especial para seu negócio"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
              />
            </div>

            <div className={styles.inputGroup}>
              <label className={styles.label}>Mensagem (Use {"{nome}"} para personalizar)</label>
              <textarea
                className={styles.textareaGlass}
                placeholder="Olá {nome}, vi que sua barbearia está em destaque..."
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "1rem" }}>
              <button className="btn-secondary" onClick={() => setIsModalOpen(false)}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={handleSendEmails} disabled={emailLoading}>
                {emailLoading ? <Loader2 className="animate-spin" /> : <Send size={20} />}
                {emailLoading ? "Enviando..." : "Disparar E-mails"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Campanha WhatsApp */}
      {isWaModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={`glass-panel ${styles.modalContent}`}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                <MessageCircle size={22} style={{ display: "inline", marginRight: 8, color: "#25D366" }} />
                Disparo WhatsApp
              </h2>
              <button
                className={styles.closeButton}
                onClick={() => {
                  stopWaCampaign();
                  setIsWaModalOpen(false);
                }}
              >
                <X size={24} />
              </button>
            </div>

            {/* FASE 1: configuração */}
            {!waRunning && waIndex === 0 && (
              <>
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #888)", marginBottom: "1rem" }}>
                  {waQueue.length} contato(s) com WhatsApp válido na fila. O envio é semi-automático:
                  o app abre cada conversa já preenchida na vez certa e você dá o clique final em enviar.
                  O logo aparece no preview se a URL do app tiver Open Graph configurado.
                </p>

                <div className={styles.inputGroup}>
                  <label className={styles.label}>Mensagem padrão (use {"{nome}"} para personalizar)</label>
                  <textarea
                    className={styles.textareaGlass}
                    value={waMessage}
                    onChange={(e) => setWaMessage(e.target.value)}
                    rows={4}
                  />
                </div>

                <div className={styles.inputGroup}>
                  <label className={styles.label}>URL do app (puxa o logo no preview do link)</label>
                  <input
                    type="text"
                    className="input-glass"
                    placeholder="https://meuapp.com.br"
                    value={waAppUrl}
                    onChange={(e) => setWaAppUrl(e.target.value)}
                  />
                </div>

                <div style={{ display: "flex", gap: "1rem" }}>
                  <div className={styles.inputGroup} style={{ flex: 1 }}>
                    <label className={styles.label}>Intervalo mín. (s)</label>
                    <input
                      type="number"
                      min={5}
                      className="input-glass"
                      value={waMinDelay}
                      onChange={(e) => setWaMinDelay(Math.max(0, Number(e.target.value)))}
                    />
                  </div>
                  <div className={styles.inputGroup} style={{ flex: 1 }}>
                    <label className={styles.label}>Intervalo máx. (s)</label>
                    <input
                      type="number"
                      min={5}
                      className="input-glass"
                      value={waMaxDelay}
                      onChange={(e) => setWaMaxDelay(Math.max(0, Number(e.target.value)))}
                    />
                  </div>
                  <div className={styles.inputGroup} style={{ flex: 1 }}>
                    <label className={styles.label}>Cota diária (msgs)</label>
                    <input
                      type="number"
                      min={1}
                      className="input-glass"
                      value={waDailyLimit}
                      onChange={(e) => setWaDailyLimit(Math.max(1, Number(e.target.value)))}
                    />
                  </div>
                </div>

                <div
                  style={{
                    fontSize: "0.85rem",
                    color: quotaReached ? "var(--error)" : "var(--text-muted, #888)",
                    marginBottom: "0.5rem",
                  }}
                >
                  Enviadas hoje: {waDailyCount}/{waDailyLimit}
                  {quotaReached && " — cota atingida, continue amanhã."}
                  {" · "}
                  Histórico: {waPersistSent.size} contato(s) já enviados.
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={waMacroMode}
                    onChange={(e) => setWaMacroMode(e.target.checked)}
                  />
                  Modo macro (AutoHotkey) — a cadência é controlada pelo script externo; use o atalho <strong>F2</strong> para disparar.
                </label>

                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", marginTop: "1rem", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button className="btn-secondary" onClick={clearWaHistory} style={{ fontSize: "0.8rem" }}>
                      Limpar histórico
                    </button>
                    <button className="btn-secondary" onClick={resetWaQuota} style={{ fontSize: "0.8rem" }}>
                      Zerar cota de hoje
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  <button className="btn-secondary" onClick={() => setIsWaModalOpen(false)}>
                    Cancelar
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={sendCloudCampaign}
                    disabled={cloudSending}
                    title="Envia a fila para o worker no Raspberry Pi, que dispara sozinho 24/7"
                    style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
                  >
                    {cloudSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    {cloudSending ? "Enviando..." : "Disparar na nuvem (Pi)"}
                  </button>
                  <button
                    className="btn-primary"
                    onClick={startWaCampaign}
                    style={{ background: "#25D366", borderColor: "#25D366" }}
                  >
                    <Play size={18} /> Iniciar disparo
                  </button>
                  </div>
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted, #888)", marginTop: "0.75rem" }}>
                  <strong>Iniciar disparo</strong>: semi-automático, aqui no navegador (abre cada conversa
                  para você clicar). <strong>Disparar na nuvem (Pi)</strong>: manda a fila para o robô no
                  Raspberry Pi, que envia sozinho 24/7 — não precisa deixar o computador ligado.
                </p>
              </>
            )}

            {/* FASE 2: em andamento */}
            {waRunning && waIndex < waQueue.length && (
              <>
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
                    <span>Progresso: {waIndex} / {waQueue.length}</span>
                    <span style={{ color: quotaReached ? "var(--error)" : undefined }}>
                      Cota hoje: {waDailyCount}/{waDailyLimit}
                    </span>
                  </div>
                  <div style={{ height: "8px", background: "rgba(255,255,255,0.1)", borderRadius: "4px", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${(waIndex / waQueue.length) * 100}%`,
                        background: "#25D366",
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                </div>

                <div className="glass-panel" style={{ padding: "1rem", marginBottom: "1rem" }}>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #888)" }}>Próximo contato:</div>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{waQueue[waIndex]?.name}</div>
                  <div style={{ fontSize: "0.9rem" }}>{waQueue[waIndex]?.phone}</div>
                </div>

                {quotaReached ? (
                  <div style={{ textAlign: "center", marginBottom: "1rem", color: "var(--error)", fontWeight: 600 }}>
                    Cota diária atingida ({waDailyCount}/{waDailyLimit}). Continue amanhã ou ajuste a cota.
                  </div>
                ) : waCountdown > 0 ? (
                  <div style={{ textAlign: "center", marginBottom: "1rem" }}>
                    <div style={{ fontSize: "2rem", fontWeight: 700, color: "#25D366" }}>{waCountdown}s</div>
                    <div style={{ fontSize: "0.85rem", color: "var(--text-muted, #888)" }}>
                      {waPaused ? "Pausado" : "Aguardando intervalo (anti-spam)..."}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", marginBottom: "1rem", color: "#25D366", fontWeight: 600 }}>
                    Pronto para enviar!
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "center", gap: "1rem", flexWrap: "wrap" }}>
                  <button
                    className="btn-secondary"
                    onClick={() => setWaPaused((p) => !p)}
                    style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
                  >
                    {waPaused ? <Play size={18} /> : <Pause size={18} />}
                    {waPaused ? "Retomar" : "Pausar"}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={skipCurrentWa}
                    style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
                  >
                    <SkipForward size={18} /> Pular
                  </button>
                  <button
                    className="btn-primary"
                    onClick={sendCurrentWa}
                    disabled={waCountdown > 0 || waPaused || quotaReached}
                    style={{ background: "#25D366", borderColor: "#25D366", display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
                  >
                    <Send size={18} /> Abrir e enviar
                  </button>
                </div>

                <p style={{ textAlign: "center", fontSize: "0.8rem", color: "var(--text-muted, #888)", marginTop: "1rem" }}>
                  {waMacroMode
                    ? "Modo macro ativo: a tecla F2 dispara o envio. Deixe o AutoHotkey controlar a cadência."
                    : "Dica: a tecla F2 também dispara o envio do contato atual quando estiver pronto."}
                </p>
              </>
            )}

            {/* FASE 3: concluído */}
            {!waRunning && waIndex >= waQueue.length && waQueue.length > 0 && (
              <div style={{ textAlign: "center", padding: "1rem" }}>
                <h3 style={{ marginBottom: "0.5rem" }}>Campanha concluída! 🎉</h3>
                <p style={{ color: "var(--text-muted, #888)", marginBottom: "1.5rem" }}>
                  {waSentIds.size} de {waQueue.length} contatos processados.
                </p>
                <button className="btn-primary" onClick={() => setIsWaModalOpen(false)}>
                  Fechar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
