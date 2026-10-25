"use client";

import { useEffect, useRef, useState } from "react";
import { accessHeaders } from "@/lib/api-client";
import { isOwnerAccessFailure, ownerAccessMessage } from "@/lib/owner-access-messages";
import { OwnerAccess, useOwnerAccessLost } from "@/app/OwnerAccess";

interface RelinkResponse {
  ok?: boolean;
  code?: string;
  error?: string;
  updated?: number;
  missing?: number;
  review?: number;
}

export default function EbayLinksPage() {
  return (
    <main className="wrap">
      <header>
        <h1>Vínculos de eBay</h1>
        <p>
          Cuando un anuncio se republica, esta página busca la publicación activa con el mismo SKU y actualiza el Item
          ID del artículo que ya existe.
        </p>
      </header>
      <OwnerAccess>
        <RelinkPanel />
      </OwnerAccess>
    </main>
  );
}

function RelinkPanel() {
  const onAccessLost = useOwnerAccessLost();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [ebayNote, setEbayNote] = useState("Comprobando la conexión de eBay…");
  const [result, setResult] = useState<RelinkResponse | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/ebay/status?workMode=store", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { configured?: boolean; connected?: boolean };
        if (!response.ok) {
          setEbayNote("No se pudo comprobar la conexión de eBay. El acceso del propietario sigue activo.");
          return;
        }
        if (!body.configured) {
          setEbayNote("eBay no está configurado en este entorno. El acceso del propietario sigue activo.");
          return;
        }
        setEbayNote(
          body.connected
            ? "eBay está conectado. El acceso del propietario sigue activo."
            : "eBay no está conectado. Conecta la cuenta en la página principal. El acceso del propietario sigue activo."
        );
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setEbayNote("No se pudo comprobar la conexión de eBay. El acceso del propietario sigue activo.");
      });
    return () => controller.abort();
  }, []);

  async function updateLinks() {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setError("");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 50000);
    try {
      const response = await fetch("/api/ebay/relink", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...accessHeaders() },
        body: "{}",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const body = (await response.json()) as RelinkResponse;
      if (isOwnerAccessFailure(response.status, body.code)) {
        setResult(null);
        onAccessLost(ownerAccessMessage(response.status, body.code));
        return;
      }
      if (body.code === "EBAY_DISCONNECTED") {
        setResult(null);
        setEbayNote(
          body.error ||
            "eBay no está conectado. Conecta la cuenta y vuelve a intentar. El acceso del propietario sigue activo."
        );
        return;
      }
      if (!response.ok || !body.ok) {
        setResult(null);
        setError(body.error || "No se pudieron actualizar los vínculos de eBay.");
        return;
      }
      setResult(body);
    } catch (reason) {
      setResult(null);
      setError(
        reason instanceof DOMException && reason.name === "AbortError"
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
    <section className="panel">
      <p>Acceso del propietario activo.</p>
      <p role="status">{ebayNote}</p>
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
  );
}
