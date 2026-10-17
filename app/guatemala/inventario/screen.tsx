"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/api-client";
import {
  availableGarmentLabel,
  formatStoredQuetzales,
  guatemalaConditionLabel,
} from "@/lib/markets/guatemala-inventory";
import type { InventoryPhoto } from "@/lib/markets/guatemala-inventory";
import "./inventory.css";

interface ListItem {
  id: string;
  sku: string;
  title: string;
  size: string;
  priceGtq: string;
  status: string;
  cover: InventoryPhoto | null;
}

interface DetailItem extends ListItem {
  description: string;
  brand: string;
  condition: string;
  photos: InventoryPhoto[];
}

function photoSource(photo: InventoryPhoto): string {
  return `data:${photo.mediaType};base64,${photo.data}`;
}

export function InventoryScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const clientId = params.get("clientId") ?? "";
  const itemId = params.get("item") ?? "";
  const [query, setQuery] = useState("");
  const [available, setAvailable] = useState(0);
  const [items, setItems] = useState<ListItem[]>([]);
  const [detail, setDetail] = useState<DetailItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load(signal: AbortSignal) {
      if (!clientId) {
        setError("Selecciona Tienda Guatemala para ver su inventario.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        if (itemId) {
          const response = await apiGet(
            `/api/markets/guatemala/inventory/${encodeURIComponent(itemId)}?clientId=${encodeURIComponent(clientId)}`
          );
          const body = (await response.json()) as { ok?: boolean; error?: string; item?: DetailItem };
          if (signal.aborted) return;
          if (!response.ok || !body.ok || !body.item) {
            setDetail(null);
            setError(body.error || "No se pudo abrir la prenda.");
          } else {
            setDetail(body.item);
          }
        } else {
          const response = await apiGet(
            `/api/markets/guatemala/inventory?clientId=${encodeURIComponent(clientId)}&q=${encodeURIComponent(query)}`
          );
          const body = (await response.json()) as {
            ok?: boolean;
            error?: string;
            available?: number;
            items?: ListItem[];
          };
          if (signal.aborted) return;
          if (!response.ok || !body.ok) {
            setItems([]);
            setError(body.error || "No se pudo cargar el inventario.");
          } else {
            setAvailable(body.available ?? 0);
            setItems(body.items ?? []);
          }
        }
      } catch {
        if (!signal.aborted) setError("No se pudo cargar el inventario.");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }

    const timer = window.setTimeout(() => {
      void load(controller.signal);
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [clientId, itemId, query]);

  function openItem(id: string) {
    const next = new URLSearchParams({ clientId, item: id });
    router.push(`/guatemala/inventario?${next.toString()}`);
  }

  function backToList() {
    const next = new URLSearchParams({ clientId });
    router.push(`/guatemala/inventario?${next.toString()}`);
  }

  return (
    <main className="wrap gt-inventory">
      <header>
        <h1>Inventario</h1>
        <p>Prendas de Tienda Guatemala guardadas en el servidor.</p>
      </header>

      {error ? (
        <p className="note note-error" role="alert">
          {error}
        </p>
      ) : null}

      {itemId ? (
        <section className="panel gt-inventory-detail" aria-labelledby="inventory-detail-heading">
          {loading ? <p>Cargando prenda…</p> : null}
          {detail ? (
            <>
              <div className="gt-inventory-photos">
                {detail.photos.map((photo) => (
                  <img key={photo.id} src={photoSource(photo)} alt={detail.title || detail.sku} />
                ))}
              </div>
              <h2 id="inventory-detail-heading">{detail.title || "Prenda sin título"}</h2>
              <p className="gt-inventory-sku">SKU {detail.sku}</p>
              <span className="gt-inventory-status">Disponible</span>
              <dl className="gt-inventory-facts">
                <div>
                  <dt>Precio</dt>
                  <dd>{formatStoredQuetzales(detail.priceGtq)}</dd>
                </div>
                <div>
                  <dt>Talla</dt>
                  <dd>{detail.size || "—"}</dd>
                </div>
                <div>
                  <dt>Marca</dt>
                  <dd>{detail.brand || "—"}</dd>
                </div>
                <div>
                  <dt>Condición</dt>
                  <dd>{guatemalaConditionLabel(detail.condition) || "—"}</dd>
                </div>
              </dl>
              {detail.description ? <p>{detail.description}</p> : null}
            </>
          ) : null}
          <div className="gt-inventory-actions">
            <button type="button" className="btn btn-primary" onClick={backToList}>
              Volver al inventario
            </button>
            <a className="btn btn-ghost" href="/">
              Volver a las prendas
            </a>
          </div>
        </section>
      ) : (
        <section className="panel" aria-labelledby="inventory-list-heading">
          <div className="gt-inventory-toolbar">
            <h2 id="inventory-list-heading" className="gt-inventory-count">
              {availableGarmentLabel(available)}
            </h2>
            <label className="gt-inventory-search">
              Buscar
              <input
                type="text"
                inputMode="text"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="SKU o título"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          {loading ? <p>Cargando inventario…</p> : null}
          {!loading && items.length === 0 ? (
            <p>
              {query.trim()
                ? "Ninguna prenda coincide con la búsqueda."
                : "Todavía no hay prendas en el inventario."}
            </p>
          ) : null}
          <div className="gt-inventory-list">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="gt-inventory-card"
                onClick={() => openItem(item.id)}
              >
                {item.cover ? (
                  <img src={photoSource(item.cover)} alt="" />
                ) : (
                  <span className="gt-inventory-photo-fallback">Sin foto</span>
                )}
                <span>
                  <p className="gt-inventory-sku">SKU {item.sku}</p>
                  <h2>{item.title || "Prenda sin título"}</h2>
                  <p className="gt-inventory-meta">
                    {item.size ? `Talla ${item.size} · ` : ""}
                    {formatStoredQuetzales(item.priceGtq)}
                  </p>
                  <span className="gt-inventory-status">Disponible</span>
                </span>
              </button>
            ))}
          </div>
          <div className="gt-inventory-actions">
            <a className="btn btn-ghost" href="/">
              Volver a las prendas
            </a>
          </div>
        </section>
      )}
    </main>
  );
}
