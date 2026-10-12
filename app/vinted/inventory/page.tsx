"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import { parseInventoryImport, VINTED_SYNC_BATCH_LIMIT, VINTED_SYNC_PILOT_LIMIT } from "@/lib/vinted/inventory-match";

interface InventoryItem {
  vintedItemId: string;
  title: string;
  url: string;
  sku: string;
  suggestedSku: string;
  status: "verified" | "review" | "unmatched";
  detail: string;
  syncedAt: string;
}

interface Counts {
  collected: number;
  identified: number;
  review: number;
  unmatched: number;
}

const EMPTY_COUNTS: Counts = { collected: 0, identified: 0, review: 0, unmatched: 0 };

export default function VintedInventoryPage() {
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [importAll, setImportAll] = useState(false);

  const load = useCallback(async (search: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await apiGet(`/api/vinted/inventory?q=${encodeURIComponent(search)}`);
      const body = (await response.json()) as { ok?: boolean; error?: string; counts?: Counts; items?: InventoryItem[] };
      if (!response.ok || !body.ok) {
        setError(body.error || "No se pudo leer el inventario.");
        return;
      }
      setCounts(body.counts || EMPTY_COUNTS);
      setItems(body.items || []);
    } catch {
      setError("No se pudo leer el inventario.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  async function importFile(file: File) {
    setNotice("");
    setError("");
    const parsed = parseInventoryImport(await file.text());
    const batchSize = importAll ? VINTED_SYNC_BATCH_LIMIT : VINTED_SYNC_PILOT_LIMIT;
    const slice = importAll ? parsed : parsed.slice(0, VINTED_SYNC_PILOT_LIMIT);
    if (!slice.length) {
      setError("El archivo no tiene publicaciones de Vinted con URL.");
      return;
    }
    let received = 0;
    for (let index = 0; index < slice.length; index += batchSize) {
      const items = slice.slice(index, index + batchSize);
      const response = await apiPost("/api/vinted/inventory/sync", {
        items,
        confirmFullSync: items.length > VINTED_SYNC_PILOT_LIMIT,
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; received?: number };
      if (!response.ok || !body.ok) {
        setError(body.error || "No se pudo importar el archivo.");
        return;
      }
      received += body.received ?? items.length;
    }
    const skipped = parsed.length - slice.length;
    setNotice(
      `Importadas ${received} publicaciones.${skipped ? ` Quedaron ${skipped} fuera de esta prueba de ${VINTED_SYNC_PILOT_LIMIT}.` : ""} No se modificó ningún anuncio en Vinted.`
    );
    await load(query);
  }

  async function confirm(item: InventoryItem) {
    const sku = window.prompt("SKU de eBay para esta publicación", item.suggestedSku || "");
    if (!sku?.trim()) return;
    const response = await apiPost("/api/vinted/inventory/confirm", {
      vintedItemId: item.vintedItemId,
      sku: sku.trim(),
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo confirmar.");
      return;
    }
    await load(query);
  }

  return (
    <main className="wrap">
      <header className="masthead">
        <span className="logo-mark" aria-hidden="true">
          🛍️
        </span>
        <div>
          <h1>Inventario Vinted</h1>
          <p>Asocia publicaciones activas de Vinted con el SKU de eBay. No edita ni retira anuncios.</p>
        </div>
      </header>
      <section className="policy-counts" aria-label="Resumen">
        <p className="policy-count">Recopiladas: {counts.collected}</p>
        <p className="policy-count">Identificadas: {counts.identified}</p>
        <p className="policy-count">Pendientes de revisión: {counts.review}</p>
        <p className="policy-count">Sin coincidencia: {counts.unmatched}</p>
      </section>
      <div className="post-all-bar">
        <a className="btn btn-primary" href="#sincronizar">
          Iniciar una nueva sincronización
        </a>
        <a className="btn btn-ghost" href="/vinted">
          Cola de Vinted
        </a>
      </div>
      <section id="sincronizar">
        <h2>Sincronizar</h2>
        <p>
          Abre tu perfil de Vinted y usa “Sincronizar inventario Vinted” en la extensión V2. La primera pasada
          recoge {VINTED_SYNC_PILOT_LIMIT} publicaciones y se puede reanudar. Si el perfil no se puede leer, importa
          un archivo CSV o JSON con título, URL e ID.
        </p>
        <label>
          <input type="checkbox" checked={importAll} onChange={(event) => setImportAll(event.target.checked)} />{" "}
          Importar el archivo completo en un lote de hasta 50
        </label>
        <p>
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.target.value = "";
            }}
          />
        </p>
      </section>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load(query);
        }}
      >
        <label>
          Buscar por SKU o título{" "}
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>{" "}
        <button className="btn btn-ghost" type="submit">
          Buscar
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p>{notice}</p> : null}
      {loading ? <p>Cargando…</p> : null}
      <div className="policy-table-wrap">
        <table className="policy-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Título</th>
              <th>Estado</th>
              <th>Vinted</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.vintedItemId}>
                <td>{item.sku || item.suggestedSku || "—"}</td>
                <td>{item.title || "Sin título"}</td>
                <td>{item.status === "verified" ? "Identificado" : item.status === "review" ? "Revisión" : "Sin coincidencia"}</td>
                <td>
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    Abrir
                  </a>
                </td>
                <td>
                  {item.status !== "verified" ? (
                    <button className="btn btn-ghost" type="button" onClick={() => void confirm(item)}>
                      Confirmar SKU
                    </button>
                  ) : (
                    "Verificado"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
