"use client";

import { useState } from "react";
import { Search, Loader2, Download, Send, X } from "lucide-react";
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

const getWaLink = (phone: string) => {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, "");
  if (clean.length >= 10) {
    // Adiciona DDI do Brasil (55) se não houver
    return clean.startsWith("55") ? `https://wa.me/${clean}` : `https://wa.me/55${clean}`;
  }
  return null;
};

export default function Home() {
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [deepSearch, setDeepSearch] = useState(false);
  const [regionsText, setRegionsText] = useState("");
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

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
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
        alert("E-mails enviados com sucesso!");
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

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Robô Comercial</h1>
        <p className={styles.subtitle}>Extração oficial de leads e comunicação automatizada</p>
      </header>

      <section className="glass-panel">
        <form className={styles.searchForm} onSubmit={handleSearch}>
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

          {/* Busca Profunda */}
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
                <label className={styles.label}>
                  Bairros / Regiões (opcional — um por linha ou separados por vírgula)
                </label>
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
        </form>
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
    </main>
  );
}
