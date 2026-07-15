"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./page.module.css";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const setupMissing = params.get("setup") === "1";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível entrar");
      const next = params.get("next");
      window.location.href = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.brand}>Robo Comercial</div>
        <h1>Acesso administrativo</h1>
        <p>Área exclusiva para a prospecção do Zapien.</p>
        {setupMissing && (
          <div className={styles.setup}>
            Configure PANEL_ADMIN_EMAIL, PANEL_ADMIN_PASSWORD e PANEL_SESSION_SECRET no servidor.
          </div>
        )}
        <label>
          E-mail
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Senha
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className={styles.error}>{error}</div>}
        <button type="submit" disabled={loading || setupMissing}>
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className={styles.page}>Carregando…</main>}>
      <LoginForm />
    </Suspense>
  );
}
