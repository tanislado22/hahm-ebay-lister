"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import { ebayItemUrl } from "@/lib/vinted/card-text";
import { rejectOneCandidate } from "@/lib/vinted/candidate-rejection";
import { duplicateGroupsWithoutArchived } from "@/lib/vinted/inventory-archive";
import { parseInventoryImport, VINTED_SYNC_PILOT_LIMIT } from "@/lib/vinted/inventory-match";
import { anchorElementId, keepWorkingOrder, listScrollHold, readDocumentScroll, writeDocumentScroll, type ListScrollHold } from "@/lib/vinted/list-scroll";

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
  archivedAt: string;
  vintedPresence: "" | "active" | "removed" | "unverified";
}

interface EbayCandidate {
  sku: string;
  title: string;
  ebayItemId: string;
  photoUrl: string;
}

interface DuplicateGroup {
  reason: "same-listing" | "sku" | "title-photo";
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
  archived: number;
}

type View = "all" | "pending" | "reviewed" | "identified" | "possible" | "none" | "duplicates" | "sold" | "archived";

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
  archived: 0,
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
  { id: "archived", label: "Archivados" },
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
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<string | null>(null);
  const [syncingDuplicates, setSyncingDuplicates] = useState(false);
  const identifyRun = useRef(false);
  const pendingAnchor = useRef<ListScrollHold | null>(null);
  const restoreTimers = useRef<number[]>([]);
  const load = useCallback(async (search: string, mode: "full" | "quiet" = "full") => {
    if (mode === "full") setLoading(true);
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
        if (mode === "quiet") pendingAnchor.current = null;
        setError(body.error || "No se pudo leer el inventario.");
        return;
      }
      const incoming = body.items || [];
      setCounts(body.counts || EMPTY_COUNTS);
      setItems((current) => (mode === "quiet" && current.length ? keepWorkingOrder(current, incoming) : incoming));
      setGroups(body.groups || []);
      if (mode === "quiet") window.setTimeout(() => {
        pendingAnchor.current = null;
      }, 500);
    } catch {
      if (mode === "quiet") pendingAnchor.current = null;
      setError("No se pudo leer el inventario.");
    } finally {
      if (mode === "full") setLoading(false);
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
      if (item.archivedAt) return view === "archived";
      if (view === "archived") return false;
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

  const visibleCardIds = useMemo(() => {
    const sold = view === "all" || view === "sold" ? visible.filter((item) => item.soldStatus === "pending_removal") : [];
    const rest = view === "all" || view === "sold" ? visible.filter((item) => item.soldStatus !== "pending_removal") : visible;
    return [...sold, ...rest].map((item) => item.vintedItemId);
  }, [visible, view]);

  function clearRestores() {
    for (const timer of restoreTimers.current) window.clearTimeout(timer);
    restoreTimers.current = [];
  }

  function restorePlace() {
    const hold = pendingAnchor.current;
    if (!hold) return;
    if (Math.abs(readDocumentScroll() - hold.scrollTop) > 1) writeDocumentScroll(hold.scrollTop);
  }

  function rememberPlace(itemId: string) {
    if (pendingAnchor.current) return;
    pendingAnchor.current = listScrollHold(visibleCardIds, itemId, readDocumentScroll());
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  useLayoutEffect(() => {
    if (!pendingAnchor.current) return;
    restorePlace();
    clearRestores();
    restoreTimers.current = [0, 50, 150, 400].map((delay) => window.setTimeout(restorePlace, delay));
    return () => clearRestores();
  }, [items]);

  const visibleGroups = useMemo(() => {
    const archivedIds = items.filter((item) => item.archivedAt).map((item) => item.vintedItemId);
    const allowed = new Set(visible.map((item) => item.vintedItemId));
    return duplicateGroupsWithoutArchived(groups, archivedIds).filter((group) => group.itemIds.some((id) => allowed.has(id)));
  }, [groups, items, visible]);

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

  async function review(
    item: InventoryItem,
    action: "confirm_duplicate" | "not_duplicate" | "withdrawn" | "not_sold" | "mark_reviewed" | "set_ebay_item" | "reject_suggestion" | "archive" | "restore" | "mark_removed" | "drop_removed",
    relatedIds: string[],
    ebayItemId = "",
    sku = ""
  ) {
    setError("");
    rememberPlace(item.vintedItemId);
    const response = await apiPost("/api/vinted/inventory/review", {
      vintedItemId: item.vintedItemId,
      action,
      relatedIds,
      ebayItemId,
      sku,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      pendingAnchor.current = null;
      setError(body.error || "No se pudo guardar la revisión.");
      return;
    }
    await load(query, "quiet");
  }

  async function correctEbay(item: InventoryItem) {
    const value = window.prompt("Item ID del anuncio original de eBay", item.ebayItemId || "");
    if (!value?.trim()) return;
    await review(item, "set_ebay_item", [], value.trim());
  }

  async function confirmSku(item: InventoryItem, sku: string, ebayItemId = "") {
    const wanted = sku.trim();
    if (!wanted) return;
    rememberPlace(item.vintedItemId);
    const response = await apiPost("/api/vinted/inventory/confirm", {
      vintedItemId: item.vintedItemId,
      sku: wanted,
      ebayItemId,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      pendingAnchor.current = null;
      setError(body.error || "No se pudo confirmar.");
      return;
    }
    await load(query, "quiet");
  }

  function confirm(item: InventoryItem) {
    const sku = window.prompt("SKU de eBay para esta publicación", item.suggestedSku || item.listedSku || "");
    if (!sku?.trim()) return;
    void confirmSku(item, sku);
  }

  async function rejectCandidate(item: InventoryItem, candidate: { sku: string; ebayItemId: string }) {
    setError("");
    rememberPlace(item.vintedItemId);
    setItems((current) =>
      current.map((row) => {
        if (row.vintedItemId !== item.vintedItemId || row.status === "verified") return row;
        const result = rejectOneCandidate(
          {
            vintedItemId: row.vintedItemId,
            sku: row.sku,
            suggestedSku: row.suggestedSku,
            ebayItemId: row.ebayItemId,
            matchStatus: row.status,
            detail: row.detail,
            candidates: row.candidates,
            rejected: [],
          },
          candidate
        );
        if (!result.ok) return row;
        const status = result.row.matchStatus === "review" ? "review" : "unmatched";
        return {
          ...row,
          sku: result.row.sku,
          suggestedSku: result.row.suggestedSku,
          ebayItemId: result.row.ebayItemId,
          status,
          detail: result.row.detail,
          candidates: result.row.candidates,
        };
      })
    );
    const response = await apiPost("/api/vinted/inventory/review", {
      vintedItemId: item.vintedItemId,
      action: "reject_suggestion",
      relatedIds: [],
      ebayItemId: candidate.ebayItemId,
      sku: candidate.sku,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      pendingAnchor.current = null;
      setError(body.error || "No se pudo rechazar la coincidencia.");
    }
    await load(query, "quiet");
  }

  async function archive(item: InventoryItem) {
    setPendingDelete(null);
    setError("");
    rememberPlace(item.vintedItemId);
    setItems((current) => current.map((row) => (row.vintedItemId === item.vintedItemId ? { ...row, archivedAt: new Date().toISOString() } : row)));
    const response = await apiPost("/api/vinted/inventory/review", {
      vintedItemId: item.vintedItemId,
      action: "archive",
      relatedIds: [],
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      setError(body.error || "No se pudo archivar el artículo.");
    }
    await load(query, "quiet");
  }

  function deleteActions(item: InventoryItem) {
    if (item.archivedAt) {
      return (
        <button className="btn btn-ghost" type="button" onClick={() => void review(item, "restore", [])}>
          Restaurar
        </button>
      );
    }
    if (pendingDelete === item.vintedItemId) {
      return (
        <div className="vinted-delete-confirm" role="alertdialog" aria-label="Confirmar eliminación">
          <p>¿Estás seguro de que deseas eliminar este artículo de Vinted Inventory?</p>
          <div className="vinted-card-actions">
            <button className="btn btn-ghost" type="button" onClick={() => setPendingDelete(null)}>
              Cancelar
            </button>
            <button className="btn btn-delete" type="button" onClick={() => void archive(item)}>
              Sí, eliminar
            </button>
          </div>
        </div>
      );
    }
    return (
      <button className="btn btn-delete" type="button" onClick={() => setPendingDelete(item.vintedItemId)}>
        Eliminar
      </button>
    );
  }

  async function syncDuplicates() {
    setSyncingDuplicates(true);
    setError("");
    setNotice("");
    const since = new Date().toISOString();
    const totals = { checked: 0, active: 0, removed: 0, unverified: 0 };
    try {
      for (let round = 0; round < 20; round += 1) {
        const response = await apiPost("/api/vinted/inventory/presence", { since });
        const body = (await response.json()) as {
          ok?: boolean;
          error?: string;
          checked?: number;
          active?: number;
          removed?: number;
          unverified?: number;
          remaining?: number;
        };
        if (!response.ok || !body.ok) {
          setError(body.error || "No se pudo comprobar el estado en Vinted. No se eliminó ningún registro.");
          break;
        }
        totals.checked += body.checked || 0;
        totals.active += body.active || 0;
        totals.removed += body.removed || 0;
        totals.unverified += body.unverified || 0;
        if (!body.checked || !body.remaining) break;
      }
      setNotice(
        `Comprobadas ${totals.checked}. Activas: ${totals.active}. Eliminadas en Vinted: ${totals.removed}. Sin verificar: ${totals.unverified}. Solo se retiró el registro interno de las eliminadas confirmadas.`
      );
    } catch {
      setError("No se pudo comprobar el estado en Vinted. No se eliminó ningún registro.");
    } finally {
      setSyncingDuplicates(false);
      await load(query);
    }
  }

  async function dropRemoved(item: InventoryItem) {
    setPendingDrop(null);
    setError("");
    rememberPlace(item.vintedItemId);
    setItems((current) => current.map((row) => (row.vintedItemId === item.vintedItemId ? { ...row, archivedAt: new Date().toISOString() } : row)));
    await review(item, "drop_removed", []);
  }

  function presenceLabel(item: InventoryItem): string {
    if (item.vintedPresence === "active") return "🟢 Activo en Vinted";
    if (item.vintedPresence === "removed") return "🔴 Eliminado en Vinted";
    return "🟡 Sin verificar";
  }

  function groupReason(reason: DuplicateGroup["reason"]): string {
    if (reason === "same-listing") return "Misma publicación de Vinted: el ID coincide";
    if (reason === "sku") return "Mismo SKU: comprueba si son dos publicaciones del mismo artículo";
    return "Mismo título y misma fotografía: comprueba si son el mismo artículo";
  }

  function photoFrame(src: string, className: string) {
    if (!src) return <span className={`${className} is-empty`} aria-hidden="true" />;
    return <img className={className} src={src} alt="" />;
  }

  function itemCard(item: InventoryItem) {
    const confirmedSku = item.status === "verified" && item.sku ? item.sku : "";
    const suggestedSku = item.status === "verified" ? "" : item.suggestedSku;
    const savedEbay = ebayItemUrl(item.ebayItemId);
    const candidates = item.status === "verified" ? [] : item.candidates || [];
    return (
      <article className="vinted-card" key={item.vintedItemId} id={anchorElementId(item.vintedItemId)}>
        <div className="vinted-card-main">
          {photoFrame(item.photoUrl, "vinted-card-photo")}
          <div className="vinted-card-body">
            <h3>{item.title || "Sin título"}</h3>
            <p className="vinted-sku-confirmed">{confirmedSku ? `SKU ${confirmedSku}` : "SKU sin confirmar"}</p>
            {suggestedSku ? <p className="vinted-sku-suggested">SKU sugerido: {suggestedSku}</p> : null}
            <p className="vinted-card-status">{matchLabel(item)}</p>
            {item.soldStatus === "pending_removal" ? <p>Vendido en {platformLabel(item.soldPlatform)} — {saleDate(item.soldAt)}</p> : null}
            {item.duplicateStatus === "suspected" || item.duplicateStatus === "confirmed" ? <p>Duplicado</p> : null}
            <p>{item.reviewedAt ? "Revisado" : "Pendiente de revisión"}</p>
            {item.detail ? <p className="vinted-card-detail">{item.detail}</p> : null}
            {savedEbay ? <p className="vinted-item-id">Item ID {item.ebayItemId}</p> : null}
            <div className="vinted-card-actions">
              <a className="btn btn-ghost" href={item.url} target="_blank" rel="noopener noreferrer">
                Abrir en Vinted
              </a>
              {savedEbay ? (
                <a className="btn btn-ghost" href={savedEbay} target="_blank" rel="noopener noreferrer">
                  Abrir en eBay
                </a>
              ) : null}
              {item.reviewedAt ? null : (
                <button className="btn btn-ghost" type="button" onClick={() => void review(item, "mark_reviewed", [])}>
                  Marcar como revisado
                </button>
              )}
              <button className="btn btn-ghost" type="button" onClick={() => void correctEbay(item)}>
                Corregir Item ID
              </button>
              {item.status !== "verified" ? (
                <button className="btn btn-ghost" type="button" onClick={() => confirm(item)}>
                  Confirmar SKU
                </button>
              ) : null}
              {item.status !== "verified" && suggestedSku && candidates.length === 0 ? (
                <>
                  <button className="btn btn-ghost" type="button" onClick={() => void confirmSku(item, suggestedSku, item.ebayItemId)}>
                    Confirmar asociación
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={() => void rejectCandidate(item, { sku: suggestedSku, ebayItemId: "" })}>
                    Rechazar
                  </button>
                </>
              ) : null}
              {item.soldStatus === "pending_removal" ? (
                <>
                  <button className="btn btn-ghost" type="button" onClick={() => void review(item, "withdrawn", [])}>
                    Retirado de Vinted
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={() => void review(item, "not_sold", [])}>
                    No es esta venta
                  </button>
                </>
              ) : null}
              {deleteActions(item)}
            </div>
          </div>
        </div>
        {item.status !== "verified" ? (
          <div className="vinted-candidates">
            <h4>Posibles coincidencias en tu eBay</h4>
            {candidates.length === 0 ? <p>Ningún candidato de tu cuenta.</p> : null}
            {candidates.map((candidate) => {
              const ebay = ebayItemUrl(candidate.ebayItemId);
              return (
                <div className="vinted-candidate" key={`${item.vintedItemId}-${candidate.ebayItemId}-${candidate.sku}`}>
                  {photoFrame(candidate.photoUrl, "vinted-candidate-photo")}
                  <div>
                    <p className="vinted-candidate-title">{candidate.title || "Sin título"}</p>
                    <p className="vinted-sku-suggested">SKU sugerido: {candidate.sku || "—"}</p>
                    <div className="vinted-card-actions">
                      {ebay ? (
                        <a className="btn btn-ghost" href={ebay} target="_blank" rel="noopener noreferrer">
                          Abrir en eBay
                        </a>
                      ) : (
                        <span>Sin Item ID de eBay</span>
                      )}
                      {candidate.sku ? (
                        <button className="btn btn-ghost" type="button" onClick={() => void confirmSku(item, candidate.sku, candidate.ebayItemId)}>
                          Confirmar asociación
                        </button>
                      ) : null}
                      <button className="btn btn-ghost" type="button" onClick={() => void rejectCandidate(item, candidate)}>
                        Rechazar
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <main
      className="wrap vinted-inventory-page"
      onPointerDown={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("button")) event.preventDefault();
      }}
    >
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
        <p className="policy-count">Archivados: {counts.archived}</p>
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
          <p>Cada publicación se distingue por su ID y su URL. El mismo SKU no basta para tratarlas como duplicadas.</p>
          <button className="btn btn-primary" type="button" onClick={() => void syncDuplicates()} disabled={syncingDuplicates}>
            {syncingDuplicates ? "Comprobando Vinted…" : "Sincronizar con Vinted"}
          </button>
          {visibleGroups.length === 0 ? <p>No hay grupos duplicados en esta vista.</p> : null}
          {visibleGroups.map((group) => {
            const members = group.itemIds.map((id) => byId.get(id)).filter((item): item is InventoryItem => {
              if (!item) return false;
              return !item.archivedAt;
            });
            if (members.length < 2) return null;
            const skuText = (item: InventoryItem) => (item.status === "verified" && item.sku ? item.sku : item.sku || item.listedSku || "Sin SKU");
            return (
              <article key={group.itemIds.join("-")} className="vinted-card">
                <p>{groupReason(group.reason)}</p>
                <div className="vinted-candidates">
                  {members.map((item) => (
                    <div className="vinted-candidate" key={item.vintedItemId}>
                      {photoFrame(item.photoUrl, "vinted-candidate-photo")}
                      <div>
                        <p className="vinted-candidate-title">{item.title || "Sin título"}</p>
                        <p className="vinted-sku-confirmed">SKU {skuText(item)}</p>
                        <p>ID {item.vintedItemId}</p>
                        <p className="vinted-card-detail">{item.url}</p>
                        <p>{presenceLabel(item)}</p>
                        {item.duplicateStatus === "confirmed" ? <p>🔵 Duplicado confirmado</p> : null}
                        <div className="vinted-card-actions">
                          <a className="btn btn-ghost" href={item.url} target="_blank" rel="noopener noreferrer">
                            Abrir en Vinted
                          </a>
                          {group.reason === "same-listing" ? null : (
                            <>
                              <button className="btn btn-ghost" type="button" onClick={() => void review(item, "confirm_duplicate", group.itemIds)}>
                                Son duplicados
                              </button>
                              <button className="btn btn-ghost" type="button" onClick={() => void review(item, "not_duplicate", group.itemIds)}>
                                Son artículos diferentes
                              </button>
                            </>
                          )}
                          {item.vintedPresence === "removed" ? null : (
                            <button className="btn btn-ghost" type="button" onClick={() => void review(item, "mark_removed", [])}>
                              Marcar como eliminada en Vinted
                            </button>
                          )}
                          {item.vintedPresence === "removed" && pendingDrop === item.vintedItemId ? (
                            <div className="vinted-delete-confirm" role="alertdialog" aria-label="Quitar registro interno">
                              <p>¿Quitar solo el registro interno de {item.title || "esta publicación"} (ID {item.vintedItemId}, SKU {skuText(item)})? No se elimina la publicación en Vinted ni otros artículos.</p>
                              <div className="vinted-card-actions">
                                <button className="btn btn-ghost" type="button" onClick={() => setPendingDrop(null)}>
                                  Cancelar
                                </button>
                                <button className="btn btn-delete" type="button" onClick={() => void dropRemoved(item)}>
                                  Quitar registro eliminado
                                </button>
                              </div>
                            </div>
                          ) : item.vintedPresence === "removed" ? (
                            <button className="btn btn-delete" type="button" onClick={() => setPendingDrop(item.vintedItemId)}>
                              Quitar registro eliminado
                            </button>
                          ) : null}
                          {deleteActions(item)}
                        </div>
                      </div>
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
          ) : (
            <div className="vinted-card-list">
              {visible.filter((item) => item.soldStatus === "pending_removal").map((item) => itemCard(item))}
            </div>
          )}
        </section>
      ) : null}

      <div className="vinted-card-list">
        {visible.length === 0 && !loading ? <p>No hay artículos en esta vista.</p> : null}
        {(view === "all" || view === "sold" ? visible.filter((item) => item.soldStatus !== "pending_removal") : visible).map((item) => itemCard(item))}
      </div>
    </main>
  );
}
