"use client";

import { useState } from "react";
import { Search, Download, Send, X, Loader2 } from "lucide-react";
import Papa from "papaparse";
import styles from "./page.module.css";

interface Business {
  id: string;
  name: string;
  address: string;
  rating: number;
  phone: string;
  website: string;
}

export default function Home() {
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [results, setResults] = useState<Business[]>([]);
  const [loading, setLoading] = useState(false);
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
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: `${niche} in ${location}` }),
      });
      const data = await res.json();
      if (data.results) {
        setResults(data.results);
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

  const handleExportCSV = () => {
    if (results.length === 0) return;
    const csv = Papa.unparse(results);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `empresas_${niche}_${location}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
              placeholder="Ex: Barbearia, Salão de Beleza, Petshop..."
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
            Buscar
          </button>
        </form>
      </section>

      {results.length > 0 && (
        <section className="glass-panel" style={{ padding: "2rem" }}>
          <div className={styles.resultsHeader}>
            <h2 className={styles.subtitle}>
              {results.length} empresas encontradas
            </h2>
            <div className={styles.actions}>
              <button className="btn-secondary" onClick={handleExportCSV}>
                <Download size={18} style={{ marginRight: 8, display: "inline" }} />
                Exportar CSV
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
                    <td className={styles.td}>{biz.phone || "-"}</td>
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
