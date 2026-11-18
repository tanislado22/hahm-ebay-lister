"use client";

import { useState } from "react";

const UNREADABLE_PHOTO = "No se pudo leer esa foto. Prueba con otra.";

type StoreRequest = (path: string, body?: unknown) => Promise<Response>;

interface PhotoMatch {
  id: string;
  sku: string;
  size: string;
  lotLabel: string;
  published: boolean;
  photo: { mediaType: string; data: string };
}

export function PhotoSearchPanel({
  clientId,
  request,
  onOpen,
}: {
  clientId: string;
  request: StoreRequest;
  onOpen: (id: string) => void;
}) {
  const [photo, setPhoto] = useState<{ mediaType: string; data: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [matches, setMatches] = useState<PhotoMatch[]>([]);
  const [copied, setCopied] = useState("");

  async function choose(file: File | undefined) {
    if (!file) return;
    const next = await readSearchPhoto(file);
    if (!next) {
      setError(UNREADABLE_PHOTO);
      return;
    }
    setPhoto(next);
    setError("");
    setMessage("");
    setMatches([]);
    setCopied("");
  }

  async function search() {
    if (!photo || busy) return;
    setBusy(true);
    setError("");
    setCopied("");
    try {
      const response = await request("/api/markets/guatemala/inventory/buscar-foto", {
        clientId,
        photo: { mediaType: photo.mediaType, data: photo.data },
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; message?: string; matches?: PhotoMatch[] };
      if (!response.ok || !body.ok) {
        setMatches([]);
        setMessage("");
        setError(body.error || UNREADABLE_PHOTO);
        return;
      }
      setMatches(body.matches ?? []);
      setMessage(body.message || "");
    } catch {
      setError(UNREADABLE_PHOTO);
    } finally {
      setBusy(false);
    }
  }

  async function copySku(sku: string) {
    try {
      await navigator.clipboard.writeText(sku);
      setCopied(sku);
      setError("");
    } catch {
      setCopied("");
      setError(`No se pudo copiar. El SKU es ${sku}.`);
    }
  }

  return (
    <section className="gt-sale-box gt-expense-form" aria-labelledby="photo-search-heading">
      <h3 id="photo-search-heading">Buscar prenda por foto</h3>
      <p className="gt-expense-note">
        Si la etiqueta se perdió, toma una foto nueva. Se compara con las prendas que ya tienen foto, de todos los lotes, incluidas las que siguen sin publicar.
      </p>
      <div className="gt-inventory-actions">
        <label className="btn btn-primary">
          Tomar foto
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void choose(file);
            }}
          />
        </label>
        <label className="btn">
          Elegir imagen
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void choose(file);
            }}
          />
        </label>
      </div>
      {photo ? (
        <div className="gt-photo-search-preview">
          <img src={`data:${photo.mediaType};base64,${photo.data}`} alt="Foto nueva para buscar la prenda" />
        </div>
      ) : null}
      <div className="gt-inventory-actions">
        <button type="button" className="btn btn-primary" disabled={!photo || busy} onClick={() => void search()}>
          {busy ? "Buscando…" : "Buscar coincidencias"}
        </button>
      </div>
      {error ? (
        <p className="note note-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p>{message}</p> : null}
      {matches.length ? (
        <ul className="gt-photo-search-results">
          {matches.map((match) => (
            <li key={match.id}>
              <img src={`data:${match.photo.mediaType};base64,${match.photo.data}`} alt="" />
              <p>
                SKU <strong>{match.sku}</strong>
              </p>
              <p>{match.lotLabel}</p>
              {match.size.trim() ? <p>Talla {match.size.trim()}</p> : null}
              {match.published ? null : <p>Sin publicar</p>}
              <div className="gt-inventory-actions">
                <button type="button" className="btn" onClick={() => void copySku(match.sku)}>
                  {copied === match.sku ? "SKU copiado" : "Copiar SKU"}
                </button>
                <button type="button" className="btn btn-primary" onClick={() => onOpen(match.id)}>
                  Abrir ficha
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

async function readSearchPhoto(file: File): Promise<{ mediaType: string; data: string } | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const max = 960;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const url = canvas.toDataURL("image/jpeg", 0.72);
    const data = url.split(",")[1] ?? "";
    if (!data) return null;
    return { mediaType: "image/jpeg", data };
  } catch {
    return null;
  }
}
