"use client";

import { useRef, useState } from "react";
import { accessHeaders, isAccessCodeChallenge } from "@/lib/api-client";

interface RelinkResponse {
  ok?: boolean;
  code?: string;
  error?: string;
  updated?: number;
  missing?: number;
  review?: number;
}

export default function EbayLinksPage() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RelinkResponse | null>(null);
  const runningRef = useRef(false);

  async function updateLinks() {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setError("");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 50000);
    const headers = accessHeaders();
    try {
      const response = await fetch("/api/ebay/relink", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: "{}",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const body = (await response.json()) as RelinkResponse;
      if (isAccessCodeChallenge(response.status, body.code)) {
        setResult(null);
        setError(
          headers["x-app-secret"]
            ? "El acceso guardado no autorizó esta acción. La pantalla sigue disponible."
            : "Abre la página principal en este navegador para preparar el acceso del propietario. La pantalla sigue disponible."
        );
        return;
      }
      if (!response.ok || !body.ok) {
        setResult(null);
        setError(body.error || "No se pudieron actualizar los vínculos de eBay.");
        return;
      }
      setResult(body);
    } catch (error) {
      setResult(null);
      setError(
        error instanceof DOMException && error.name === "AbortError"
          ? "La actualización no terminó a tiempo. La pantalla sigue disponible y puedes volver a intentar."
          : "No se pudieron actualizar los vínculos de eBay."
      );
    } finally {
      window.clearTimeout(timer);
      runningRef.current = false;
      setRunning(false);
    }
  }

  return (
    <main className="wrap">
      <header>
        <h1>Vínculos de eBay</h1>
        <p>
          Cuando un anuncio se republica, esta página busca la publicación activa con el mismo SKU y actualiza el Item
          ID del artículo que ya existe.
        </p>
      </header>
      <section className="panel">
        <button className="btn btn-primary" type="button" disabled={running} onClick={() => void updateLinks()}>
          {running ? "Actualizando…" : "Actualizar vínculos de eBay"}
        </button>
        {error ? (
          <p className="note note-error" role="alert">
            {error}
          </p>
        ) : null}
        {result ? (
          <div role="status">
            <p>Actualizados: {result.updated ?? 0}</p>
            <p>Sin coincidencia: {result.missing ?? 0}</p>
            <p>Requieren revisión: {result.review ?? 0}</p>
            <p>Puedes volver a intentar los que todavía no tengan una publicación nueva.</p>
          </div>
        ) : null}
        <p>
          <a className="btn btn-ghost" href="/">
            Volver
          </a>
        </p>
      </section>
    </main>
  );
}
