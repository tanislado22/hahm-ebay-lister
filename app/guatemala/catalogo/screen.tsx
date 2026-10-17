"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatStoredQuetzales } from "@/lib/markets/guatemala-inventory";
import {
  catalogEmptyMessage,
  GUATEMALA_CATALOG_MESSAGES,
  type PublicCatalogCard,
  type PublicCatalogDetail,
} from "@/lib/markets/guatemala-catalog";
import "./catalog.css";

function photoSource(photo: { mediaType: string; data: string }): string {
  return `data:${photo.mediaType};base64,${photo.data}`;
}

export function CatalogScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const itemId = params.get("prenda") ?? "";
  const query = params.get("q") ?? "";
  const [draft, setDraft] = useState(query);
  const [items, setItems] = useState<PublicCatalogCard[] | null>(null);
  const [detail, setDetail] = useState<PublicCatalogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(query);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void load(controller.signal);
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };

    async function load(signal: AbortSignal) {
      setLoading(true);
      setError("");
      try {
        if (itemId) {
          const response = await fetch(`/api/markets/guatemala/catalog/${encodeURIComponent(itemId)}`, {
            cache: "no-store",
            signal,
          });
          const body = (await response.json()) as { ok?: boolean; error?: string; item?: PublicCatalogDetail };
          if (signal.aborted) return;
          if (!response.ok || !body.ok || !body.item) {
            setDetail(null);
            setError(body.error || GUATEMALA_CATALOG_MESSAGES.detailFailed);
            return;
          }
          setDetail(body.item);
        } else {
          const response = await fetch(`/api/markets/guatemala/catalog?q=${encodeURIComponent(query)}`, {
            cache: "no-store",
            signal,
          });
          const body = (await response.json()) as { ok?: boolean; error?: string; items?: PublicCatalogCard[] };
          if (signal.aborted) return;
          if (!response.ok || !body.ok || !body.items) {
            setItems(null);
            setError(body.error || GUATEMALA_CATALOG_MESSAGES.loadFailed);
            return;
          }
          setItems(body.items);
        }
      } catch {
        if (signal.aborted) return;
        setItems(null);
        setDetail(null);
        setError(itemId ? GUATEMALA_CATALOG_MESSAGES.detailFailed : GUATEMALA_CATALOG_MESSAGES.loadFailed);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
  }, [itemId, query]);

  function openCatalog(next: { q?: string; prenda?: string }) {
    const search = new URLSearchParams();
    const text = next.q ?? "";
    if (text) search.set("q", text);
    if (next.prenda) search.set("prenda", next.prenda);
    const suffix = search.toString();
    router.push(suffix ? `/guatemala/catalogo?${suffix}` : "/guatemala/catalogo");
  }

  return (
    <main className="wrap gt-catalog">
      <header>
        <h1>Tienda Guatemala</h1>
        <p>Catálogo de prendas disponibles.</p>
      </header>
      {error ? <p className="note note-error" role="alert">{error}</p> : null}
      {itemId ? (
        <section className="panel gt-catalog-detail" aria-labelledby="catalog-detail-heading">
          {loading ? <p>Cargando prenda…</p> : null}
          {detail ? (
            <>
              <div className="gt-catalog-photos">
                {detail.photos.length > 0 ? (
                  detail.photos.map((photo) => (
                    <img key={photo.id} src={photoSource(photo)} alt={detail.title || detail.sku} />
                  ))
                ) : (
                  <span className="gt-catalog-photo-fallback">Sin foto</span>
                )}
              </div>
              <h2 id="catalog-detail-heading">{detail.title || "Prenda sin título"}</h2>
              <p className="gt-catalog-price">{formatStoredQuetzales(detail.priceGtq)}</p>
              <p className="gt-catalog-meta">{detail.size ? `Talla ${detail.size}` : "Sin talla"}</p>
              <p className="gt-catalog-meta">SKU {detail.sku}</p>
              {detail.description ? <p className="gt-catalog-description">{detail.description}</p> : null}
            </>
          ) : null}
          <div className="gt-catalog-actions">
            <button type="button" className="btn btn-primary" onClick={() => openCatalog({ q: query })}>
              Volver al catálogo
            </button>
          </div>
        </section>
      ) : (
        <section className="panel" aria-labelledby="catalog-list-heading">
          <form
            className="gt-catalog-search"
            onSubmit={(event) => {
              event.preventDefault();
              openCatalog({ q: draft.trim() });
            }}
          >
            <label htmlFor="catalog-search">Buscar</label>
            <input
              id="catalog-search"
              type="text"
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Título o SKU"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </form>
          <h2 id="catalog-list-heading" className="gt-catalog-count">
            {items ? (items.length === 1 ? "1 prenda disponible" : `${items.length} prendas disponibles`) : "Catálogo"}
          </h2>
          {loading ? <p>Cargando catálogo…</p> : null}
          {!loading && !error && items && items.length === 0 ? <p>{catalogEmptyMessage(query)}</p> : null}
          <div className="gt-catalog-list">
            {(items ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                className="gt-catalog-card"
                onClick={() => openCatalog({ q: query, prenda: item.id })}
              >
                {item.cover ? (
                  <img src={photoSource(item.cover)} alt="" />
                ) : (
                  <span className="gt-catalog-photo-fallback">Sin foto</span>
                )}
                <span>
                  <h2>{item.title || "Prenda sin título"}</h2>
                  <p className="gt-catalog-meta">{item.size ? `Talla ${item.size}` : "Sin talla"}</p>
                  <p className="gt-catalog-price">{formatStoredQuetzales(item.priceGtq)}</p>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
