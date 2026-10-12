"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import { ebayItemUrl } from "@/lib/vinted/card-text";
import { parseInventoryImport, VINTED_SYNC_PILOT_LIMIT } from "@/lib/vinted/inventory-match";

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
  ebayItemId: string;
  reviewedAt: string;
  candidates: EbayCandidate[];
}

interface EbayCandidate {
  sku: string;
  title: string;
  ebayItemId: string;
  photoUrl: string;
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
  pending: number;
  possible: number;
  unmatched: number;
  identifyRemaining: number;
  confirmed: number;
}

type View = "all" | "pending" | "reviewed" | "identified" | "possible" | "none" | "duplicates" | "sold";

const EMPTY_COUNTS: Counts = {
  collected: 0,
  identified: 0,
  duplicates: 0,
  soldPending: 0,
  needsReview: 0,
  reviewed: 0,
  pending: 0,
  possible: 0,
  unmatched: 0,
  identifyRemaining: 0,
  confirmed: 0,
};

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "all", label: "Todas" },
  { id: "pending", label: "Pendientes" },
  { id: "reviewed", label: "Revisados" },
  { id: "identified", label: "Identificados" },
  { id: "possible", label: "Posible coincidencia" },
  { id: "none", label: "Sin coincidencia" },
  { id: "duplicates", label: "Posibles duplicados" },
  { id: "sold", label: "Vendidos pendientes" },
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

function matchLabel(item: InventoryItem): string {
  if (item.status === "verified") return "Identificado";
  if (item.status === "review") return "Posible coincidencia";
  return "Sin coincidencia";
}

export default function VintedInventoryPage() {
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [identifying, setIdentifying] = useState(false);
  const identifyRun = useRef(false);
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
      };
      if (!response.ok || !body.ok) {
        setError(body.error || "No se pudo leer el inventario.");
        return;
      }
      setCounts(body.counts || EMPTY_COUNTS);
      setItems(body.items || []);
      setGroups(body.groups || []);
    } catch {
      setError("No se pudo leer el inventario.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  async function identify(loop: boolean, restart = false) {
    identifyRun.current = loop;
    setIdentifying(true);
    setError("");
    let reset = restart;
    try {
      do {
        const response = await apiPost("/api/vinted/inventory/identify", { restart: reset });
        reset = false;
        const body = (await response.json()) as {
          ok?: boolean;
          error?: string;
          done?: boolean;
          processed?: number;
          catalogSize?: number;
        };
        if (!response.ok || !body.ok) {
          setError(body.error || "No se pudo identificar este lote.");
          break;
        }
        if (body.catalogSize) {
          setNotice(`Comparando con ${body.catalogSize} publicaciones activas de tu cuenta de eBay.`);
        }
        await load(query);
        if (body.done || body.processed === 0) break;
      } while (identifyRun.current);
    } catch {
      setError("No se pudo identificar este lote.");
    } finally {
      identifyRun.current = false;
      setIdentifying(false);
    }
  }

  const byId = useMemo(() => new Map(items.map((item) => [item.vintedItemId, item])), [items]);

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (view === "pending") return !item.reviewedAt;
      if (view === "reviewed") return Boolean(item.reviewedAt);
      if (view === "identified") return item.status === "verified";
      if (view === "possible") return item.status === "review";
      if (view === "none") return item.status === "unmatched";
      if (view === "duplicates") return item.duplicateStatus === "suspected" || item.duplicateStatus === "confirmed";
      if (view === "sold") return item.soldStatus === "pending_removal";
      return true;
    });
  }, [items, view]);

  const visibleGroups = useMemo(() => {
    const allowed = new Set(visible.map((item) => item.vintedItemId));
    return groups.filter((group) => group.itemIds.some((id) => allowed.has(id)));
  }, [groups, visible]);

  async function importFile(file: File) {
    setNotice("");
    setError("");
    const parsed = parseInventoryImport(await file.text());
    const batchSize = VINTED_SYNC_PILOT_LIMIT;
    const slice = parsed.slice(0, VINTED_SYNC_PILOT_LIMIT);
    if (!slice.length) {
      setError("El archivo no tiene publicaciones de Vinted con URL.");
      return;
    }
    let received = 0;
    for (let index = 0; index < slice.length; index += batchSize) {
      const batch = slice.slice(index, index + batchSize);
      const response = await apiPost("/api/vinted/inventory/sync", {
        items: batch,
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

  async function review(
    item: InventoryItem,
    action: "confirm_duplicate" | "not_duplicate" | "withdrawn" | "not_sold" | "mark_reviewed" | "set_ebay_item" | "reject_suggestion",
    relatedIds: string[],
    ebayItemId = ""
  ) {
    setError("");
    const response = await apiPost("/api/vinted/inventory/review", {
      vintedItemId: item.vintedItemId,
      action,
      relatedIds,
      ebayItemId,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo guardar la revisión.");
      return;
    }
    await load(query);
  }

  async function correctEbay(item: InventoryItem) {
    const value = window.prompt("Item ID del anuncio original de eBay", item.ebayItemId || "");
    if (!value?.trim()) return;
    await review(item, "set_ebay_item", [], value.trim());
  }

  function directEbayLink(itemId: string) {
    const direct = itemId ? ebayItemUrl(itemId) : null;
    if (!direct) return null;
    return (
      <a href={direct} target="_blank" rel="noopener noreferrer">
        Open in eBay
      </a>
    );
  }

  function ebayLink(item: InventoryItem) {
    if (item.status !== "verified") return <span>Sin publicación confirmada</span>;
    return directEbayLink(item.ebayItemId) || <span>Sin Item ID de eBay</span>;
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
          <h1>Vinted Inventory</h1>
          <p>Asocia publicaciones activas de Vinted con el SKU de eBay. No edita ni retira anuncios.</p>
        </div>
      </header>
      <section className="policy-counts" aria-label="Resumen">
        <p className="policy-count">Total: {counts.collected}</p>
        <p className="policy-count">Analizados: {Math.max(0, counts.collected - counts.identifyRemaining)}</p>
        <p className="policy-count">Identificados: {counts.identified}</p>
        <p className="policy-count">Confirmados manualmente: {counts.confirmed}</p>
        <p className="policy-count">Posibles coincidencias: {counts.possible}</p>
        <p className="policy-count">Sin coincidencia: {counts.unmatched}</p>
        <p className="policy-count">Pendientes: {counts.pending}</p>
        <p className="policy-count">Revisados: {counts.reviewed}</p>
        <p className="policy-count">Posibles duplicados: {counts.duplicates}</p>
        <p className="policy-count">Vendidos pendientes de retirar: {counts.soldPending}</p>
      </section>
      <div className="post-all-bar">
        <a className="btn btn-primary" href="#sincronizar">
          Iniciar una nueva sincronización
        </a>
        <button className="btn btn-primary" type="button" onClick={() => void identify(true)} disabled={identifying || loading || (counts.collected > 0 && counts.identifyRemaining === 0)}>
          Identificar SKU automáticamente
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => void identify(true, true)} disabled={identifying || loading || counts.collected === 0}>
          Volver a identificar
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => { identifyRun.current = false; }} disabled={!identifying}>
          Pausar
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => void identify(true)} disabled={identifying || loading || counts.identifyRemaining === 0}>
          Continuar
        </button>
        <a className="btn btn-ghost" href="/vinted">
          Cola de Vinted
        </a>
      </div>
      <p>
        Progreso: {Math.max(0, counts.collected - counts.identifyRemaining)} de {counts.collected}. Quedan {counts.identifyRemaining} sin pasar por esta identificación. El avance queda guardado; puedes cerrar la página y continuar después. No se borran publicaciones ni SKU ya confirmados.
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.max(counts.collected, 1)}
        aria-valuenow={Math.max(0, counts.collected - counts.identifyRemaining)}
        style={{ height: 10, background: "#e7e1d8", borderRadius: 999, overflow: "hidden", marginBottom: 16 }}
      >
        <div
          style={{
            height: "100%",
            width: `${counts.collected ? ((counts.collected - counts.identifyRemaining) / counts.collected) * 100 : 0}%`,
            background: "#2f6f4e",
          }}
        />
      </div>
      <section id="sincronizar">
        <h2>Sincronizar</h2>
        <p>
          Abre tu perfil de Vinted con la extensión 2.2.0. “Sincronizar 30” continúa el recorrido guardado.
          “Reiniciar recorrido” vuelve al primer artículo y no borra registros ni revisiones. Cada archivo importa
          como máximo {VINTED_SYNC_PILOT_LIMIT} publicaciones.
        </p>
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
        <p>El precio solo aparece si el registro guardado lo trae. Estos artículos se leen de la tabla existente; esta página no vuelve a importarlos.</p>
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
                          Open in Vinted
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
                      <td>{item.status === "verified" && item.sku ? item.sku : "—"}</td>
                      <td>{platformLabel(item.soldPlatform)}</td>
                      <td>{saleDate(item.soldAt)}</td>
                      <td>
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          Open in Vinted
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
              <th>Título de Vinted</th>
              <th>Precio</th>
              <th>SKU</th>
              <th>Item ID de eBay</th>
              <th>Coincidencia</th>
              <th>Candidatos de tu eBay</th>
              <th>Enlaces</th>
              <th>Revisión</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.vintedItemId}>
                <td>{photo(item)}</td>
                <td>
                  {item.title || "Sin título"}
                  {item.soldStatus === "pending_removal" ? <p>Vendido — pendiente de retirar</p> : null}
                  {item.duplicateStatus === "suspected" || item.duplicateStatus === "confirmed" ? <p>Duplicado</p> : null}
                </td>
                <td>—</td>
                <td>
                  {item.status === "verified" && item.sku ? item.sku : "—"}
                  {item.status !== "verified" && item.suggestedSku ? <p>Sugerido: {item.suggestedSku}</p> : null}
                </td>
                <td>{item.ebayItemId || "—"}</td>
                <td>
                  {matchLabel(item)}
                  <p>{item.reviewedAt ? "Revisado" : "Pendiente de revisión"}</p>
                  {item.detail ? <p>{item.detail}</p> : null}
                </td>
                <td>
                  {item.status === "verified" ? (
                    "Asociación confirmada"
                  ) : item.candidates?.length ? (
                    item.candidates.map((candidate) => (
                      <div key={`${candidate.ebayItemId}-${candidate.sku}`} style={{ marginBottom: 8 }}>
                        {candidate.photoUrl ? (
                          <img src={candidate.photoUrl} alt="" width={48} height={48} style={{ objectFit: "cover" }} />
                        ) : null}
                        <div>{candidate.title || "Sin título"}</div>
                        <div>SKU {candidate.sku || "—"}</div>
                        {directEbayLink(candidate.ebayItemId)}
                      </div>
                    ))
                  ) : (
                    "Ningún candidato de tu cuenta"
                  )}
                </td>
                <td>
                  <p>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      Open in Vinted
                    </a>
                  </p>
                  <p>{ebayLink(item)}</p>
                </td>
                <td>
                  {item.reviewedAt ? (
                    "Revisado"
                  ) : (
                    <button className="btn btn-ghost" type="button" onClick={() => void review(item, "mark_reviewed", [])}>
                      Marcar como revisado
                    </button>
                  )}
                  <p>
                    <button className="btn btn-ghost" type="button" onClick={() => void correctEbay(item)}>
                      Corregir Item ID
                    </button>
                  </p>
                  {item.status !== "verified" ? (
                    <p>
                      <button className="btn btn-ghost" type="button" onClick={() => void confirm(item)}>
                        Confirmar SKU
                      </button>
                    </p>
                  ) : null}
                  {item.status === "review" && item.suggestedSku ? (
                    <p>
                      Candidato eBay: {item.suggestedSku}
                      <br />
                      <button className="btn btn-ghost" type="button" onClick={() => void confirm(item)}>
                        Confirmar asociación
                      </button>{" "}
                      <button className="btn btn-ghost" type="button" onClick={() => void review(item, "reject_suggestion", [])}>
                        Rechazar
                      </button>
                    </p>
                  ) : null}
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
