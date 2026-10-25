"use client";

import { useState } from "react";
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

  async function updateLinks() {
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/ebay/relink", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...accessHeaders() },
        body: "{}",
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = (await response.json()) as RelinkResponse;
      if (isAccessCodeChallenge(response.status, body.code)) {
        setResult(null);
        setError("Esta herramienta usa el acceso del propietario que ya guardó la página principal en este navegador.");
        return;
      }
      if (!response.ok || !body.ok) {
        setResult(null);
        setError(body.error || "No se pudieron actualizar los vínculos de eBay.");
        return;
      }
      setResult(body);
    } catch {
      setResult(null);
      setError("No se pudieron actualizar los vínculos de eBay.");
    } finally {
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
