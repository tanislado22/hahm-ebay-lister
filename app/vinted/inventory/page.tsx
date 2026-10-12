"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import { parseInventoryImport, VINTED_SYNC_BATCH_LIMIT, VINTED_SYNC_PILOT_LIMIT } from "@/lib/vinted/inventory-match";

interface InventoryItem {
  vintedItemId: string;
  title: string;
  url: string;
  photoUrl: string;
  sku: string;
  listedSku: string;
  suggestedSku: string;
  status: "verified" | "review" | "unmatched";
  detail: string;
  duplicateStatus: "" | "suspected" | "confirmed" | "dismissed";
  soldStatus: "" | "pending_removal" | "review" | "withdrawn" | "not_sold";
  soldPlatform: string;
  soldAt: string;
  soldDetail: string;
}

interface DuplicateGroup {
  reason: "sku" | "title-photo";
  itemIds: string[];
}

interface Counts {
  collected: number;
  identified: number;
  duplicates: number;
  soldPending: number;
  needsReview: number;
  reviewed: number;
}

type View = "all" | "identified" | "duplicates" | "sold" | "review" | "reviewed";

const EMPTY_COUNTS: Counts = {
  collected: 0,
  identified: 0,
  duplicates: 0,
  soldPending: 0,
  needsReview: 0,
  reviewed: 0,
};

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "all", label: "Todas" },
  { id: "identified", label: "Identificadas" },
  { id: "duplicates", label: "Posibles duplicados" },
  { id: "sold", label: "Vendidos pendientes" },
  { id: "review", label: "Sin SKU o revisión" },
  { id: "reviewed", label: "Ya revisadas" },
];

function platformLabel(platform: string): string {
  if (platform === "ebay") return "eBay";
  if (platform === "depop") return "Depop";
  if (platform === "poshmark") return "Poshmark";
  return platform || "—";
}

function saleDate(value: string): string {
  if (!value) return "Fecha no disponible";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Fecha no disponible";
  return parsed.toLocaleString();
}

function needsReview(item: InventoryItem): boolean {
  return item.status !== "verified" || item.soldStatus === "review";
}

export default function VintedInventoryPage() {
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [importAll, setImportAll] = useState(false);

  const load = useCallback(async (search: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await apiGet(`/api/vinted/inventory?q=${encodeURIComponent(search)}`);
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        counts?: Counts;
        items?: InventoryItem[];
        groups?: DuplicateGroup[];
        reviewedIds?: string[];
      };
      if (!response.ok || !body.ok) {
        setError(body.error || "No se pudo leer el inventario.");
        return;
      }
      setCounts(body.counts || EMPTY_COUNTS);
      setItems(body.items || []);
      setGroups(body.groups || []);
      setReviewedIds(body.reviewedIds || []);
    } catch {
      setError("No se pudo leer el inventario.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  const reviewed = useMemo(() => new Set(reviewedIds), [reviewedIds]);
  const byId = useMemo(() => new Map(items.map((item) => [item.vintedItemId, item])), [items]);

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (view === "identified") return item.status === "verified";
      if (view === "duplicates") return item.duplicateStatus === "suspected" || item.duplicateStatus === "confirmed";
      if (view === "sold") return item.soldStatus === "pending_removal";
      if (view === "review") return needsReview(item);
      if (view === "reviewed") return reviewed.has(item.vintedItemId);
      return true;
    });
  }, [items, reviewed, view]);

  const visibleGroups = useMemo(() => {
    const allowed = new Set(visible.map((item) => item.vintedItemId));
    return groups.filter((group) => group.itemIds.some((id) => allowed.has(id)));
  }, [groups, visible]);

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
      const batch = slice.slice(index, index + batchSize);
      const response = await apiPost("/api/vinted/inventory/sync", {
        items: batch,
        confirmFullSync: batch.length > VINTED_SYNC_PILOT_LIMIT,
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; received?: number };
      if (!response.ok || !body.ok) {
        setError(body.error || "No se pudo importar el archivo.");
        return;
      }
      received += body.received ?? batch.length;
    }
    const skipped = parsed.length - slice.length;
    setNotice(
      `Importadas ${received} publicaciones.${skipped ? ` Quedaron ${skipped} fuera de esta prueba de ${VINTED_SYNC_PILOT_LIMIT}.` : ""} No se modificó ningún anuncio en Vinted.`
    );
    await load(query);
  }

  async function confirm(item: InventoryItem) {
    const sku = window.prompt("SKU de eBay para esta publicación", item.suggestedSku || item.listedSku || "");
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

  async function review(item: InventoryItem, action: "confirm_duplicate" | "not_duplicate" | "withdrawn" | "not_sold", relatedIds: string[]) {
    setError("");
    const response = await apiPost("/api/vinted/inventory/review", {
      vintedItemId: item.vintedItemId,
      action,
      relatedIds,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo guardar la revisión.");
      return;
    }
    await load(query);
  }

  function photo(item: InventoryItem) {
    if (!item.photoUrl) return null;
    return <img src={item.photoUrl} alt="" width={72} height={72} style={{ objectFit: "cover" }} />;
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
        <p className="policy-count">Posibles duplicados: {counts.duplicates}</p>
        <p className="policy-count">Vendidos pendientes de retirar: {counts.soldPending}</p>
        <p className="policy-count">Sin SKU o pendientes de revisión: {counts.needsReview}</p>
        <p className="policy-count">Ya revisadas: {counts.reviewed}</p>
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
          Abre tu perfil de Vinted y usa “Sincronizar inventario Vinted” en la extensión V2.1.1. Cada pasada
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
      <div className="post-all-bar" role="tablist" aria-label="Filtros">
        {VIEWS.map((option) => (
          <button
            key={option.id}
            className={view === option.id ? "btn btn-primary" : "btn btn-ghost"}
            type="button"
            onClick={() => setView(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p>{notice}</p> : null}
      {loading ? <p>Cargando…</p> : null}

      {view === "all" || view === "duplicates" ? (
        <section>
          <h2>Posibles duplicados</h2>
          {visibleGroups.length === 0 ? <p>No hay grupos duplicados en esta vista.</p> : null}
          {visibleGroups.map((group) => {
            const members = group.itemIds.map((id) => byId.get(id)).filter((item): item is InventoryItem => Boolean(item));
            return (
              <article key={group.itemIds.join("-")} className="policy-table-wrap">
                <p>{group.reason === "sku" ? "Mismo SKU" : "Mismo título y misma fotografía"}</p>
                <div className="post-all-bar">
                  {members.map((item) => (
                    <div key={item.vintedItemId}>
                      {photo(item)}
                      <p>{item.title || "Sin título"}</p>
                      <p>SKU: {item.sku || item.listedSku || "—"}</p>
                      <p>{item.duplicateStatus === "confirmed" ? "Duplicado confirmado" : "Pendiente de revisión"}</p>
                      <p>
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          Abrir en Vinted
                        </a>
                      </p>
                      <button className="btn btn-ghost" type="button" onClick={() => void review(item, "confirm_duplicate", group.itemIds)}>
                        Son duplicados
                      </button>{" "}
                      <button className="btn btn-ghost" type="button" onClick={() => void review(item, "not_duplicate", group.itemIds)}>
                        Son artículos diferentes
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {view === "all" || view === "sold" ? (
        <section>
          <h2>Vendidos — pendiente de retirar</h2>
          {visible.filter((item) => item.soldStatus === "pending_removal").length === 0 ? (
            <p>No hay publicaciones activas con una venta confirmada.</p>
          ) : null}
          <div className="policy-table-wrap">
            <table className="policy-table">
              <thead>
                <tr>
                  <th>Foto</th>
                  <th>Título</th>
                  <th>SKU</th>
                  <th>Venta</th>
                  <th>Fecha</th>
                  <th>Vinted</th>
                </tr>
              </thead>
              <tbody>
                {visible
                  .filter((item) => item.soldStatus === "pending_removal")
                  .map((item) => (
                    <tr key={item.vintedItemId}>
                      <td>{photo(item)}</td>
                      <td>{item.title || "Sin título"}</td>
                      <td>{item.sku || "—"}</td>
                      <td>{platformLabel(item.soldPlatform)}</td>
                      <td>{saleDate(item.soldAt)}</td>
                      <td>
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          Abrir en Vinted
                        </a>
                        <p>
                          <button className="btn btn-ghost" type="button" onClick={() => void review(item, "withdrawn", [])}>
                            Retirado de Vinted
                          </button>
                        </p>
                        <p>
                          <button className="btn btn-ghost" type="button" onClick={() => void review(item, "not_sold", [])}>
                            No es esta venta
                          </button>
                        </p>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="policy-table-wrap">
        <table className="policy-table">
          <thead>
            <tr>
              <th>Foto</th>
              <th>SKU</th>
              <th>Título</th>
              <th>Estado</th>
              <th>Vinted</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.vintedItemId}>
                <td>{photo(item)}</td>
                <td>{item.sku || item.listedSku || item.suggestedSku || "—"}</td>
                <td>
                  {item.title || "Sin título"}
                  {item.soldStatus === "pending_removal" ? <p>Vendido — pendiente de retirar</p> : null}
                  {item.duplicateStatus === "suspected" || item.duplicateStatus === "confirmed" ? <p>Duplicado</p> : null}
                  {needsReview(item) ? <p>Pendiente de revisión</p> : null}
                </td>
                <td>{item.status === "verified" ? "Identificado" : item.status === "review" ? "Revisión" : "Sin coincidencia"}</td>
                <td>
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    Abrir en Vinted
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
                  {item.soldStatus === "pending_removal" ? (
                    <p>
                      <button className="btn btn-ghost" type="button" onClick={() => void review(item, "withdrawn", [])}>
                        Retirado de Vinted
                      </button>
                    </p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
