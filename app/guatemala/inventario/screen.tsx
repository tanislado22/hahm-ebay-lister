"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { guatemalaRequest } from "../request";
import { formatGuatemalaMoment } from "@/lib/markets/guatemala";
import {
  availableGarmentLabel,
  formatStoredQuetzales,
  guatemalaConditionLabel,
  guatemalaInventoryStatusLabel,
  inventoryListFilter,
  quetzalPriceText,
  type InventoryListFilter,
  type InventoryPhoto,
} from "@/lib/markets/guatemala-inventory";
import "./inventory.css";

interface SaleCorrectionInfo {
  id: string;
  action: "corregir" | "anular";
  previousChargedPriceGtq: string;
  newChargedPriceGtq: string | null;
  reason: string;
  createdAt: string;
  actorRole: "propietario";
  actorUsername: string | null;
}

interface SaleInfo {
  id?: string;
  sku: string;
  publishedPriceGtq: string;
  chargedPriceGtq: string;
  originalChargedPriceGtq?: string;
  soldAt: string;
  isTest?: boolean;
  voidedAt?: string | null;
  soldByRole?: "propietario" | "encargado" | null;
  soldByUsername?: string | null;
  corrections?: SaleCorrectionInfo[];
}

interface ListItem {
  id: string;
  sku: string;
  title: string;
  size: string;
  priceGtq: string;
  status: string;
  cover: InventoryPhoto | null;
  chargedPriceGtq?: string | null;
  publishedPriceGtq?: string | null;
  saleIsTest?: boolean;
}

interface DetailItem extends ListItem {
  description: string;
  brand: string;
  condition: string;
  photos: InventoryPhoto[];
  sale?: SaleInfo | null;
}

function photoSource(photo: InventoryPhoto): string {
  return `data:${photo.mediaType};base64,${photo.data}`;
}

export function InventoryScreen({
  lockedClientId,
  basePath = "/guatemala/inventario",
  reportsPath = "/guatemala/reportes",
}: {
  lockedClientId?: string;
  basePath?: string;
  reportsPath?: string;
} = {}) {
  const params = useSearchParams();
  const router = useRouter();
  const staffMode = Boolean(lockedClientId);
  const clientId = lockedClientId || params.get("clientId") || "";
  const itemId = params.get("item") ?? "";
  const filter = inventoryListFilter(params.get("estado"));
  function storeRequest(path: string, body?: unknown) {
    return guatemalaRequest(path, body, staffMode ? { actor: "encargado" } : undefined);
  }
  const [query, setQuery] = useState("");
  const [available, setAvailable] = useState(0);
  const [items, setItems] = useState<ListItem[]>([]);
  const [detail, setDetail] = useState<DetailItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saleStep, setSaleStep] = useState<"form" | "confirm" | null>(null);
  const [chargedDraft, setChargedDraft] = useState("");
  const [saleError, setSaleError] = useState("");
  const [savingSale, setSavingSale] = useState(false);
  const savingSaleRef = useRef(false);
  const [correctionStep, setCorrectionStep] = useState<"price" | "price-summary" | "void" | "void-summary" | null>(null);
  const [correctionPrice, setCorrectionPrice] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionError, setCorrectionError] = useState("");
  const [savingCorrection, setSavingCorrection] = useState(false);
  const savingCorrectionRef = useRef(false);
  const correctionIdRef = useRef("");

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
          const response = await storeRequest(
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
          const response = await storeRequest(
            `/api/markets/guatemala/inventory?clientId=${encodeURIComponent(clientId)}&q=${encodeURIComponent(query)}&estado=${encodeURIComponent(filter)}`
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
  }, [clientId, itemId, query, filter]);

  useEffect(() => {
    setSaleStep(null);
    setChargedDraft("");
    setSaleError("");
  }, [itemId]);

  function inventoryHref(next: { item?: string; estado?: InventoryListFilter }) {
    const search = new URLSearchParams({ estado: next.estado ?? filter });
    if (!staffMode) search.set("clientId", clientId);
    if (next.item) search.set("item", next.item);
    return `${basePath}?${search.toString()}`;
  }

  function openItem(id: string) {
    router.push(inventoryHref({ item: id }));
  }

  function backToList() {
    router.push(inventoryHref({}));
  }

  function chooseFilter(next: InventoryListFilter) {
    router.replace(inventoryHref({ estado: next }));
  }

  const chargedPrice = quetzalPriceText(chargedDraft);

  async function confirmSale() {
    if (!detail || !chargedPrice || savingSaleRef.current) return;
    savingSaleRef.current = true;
    setSavingSale(true);
    setSaleError("");
    try {
      const response = await storeRequest(
        `/api/markets/guatemala/inventory/${encodeURIComponent(detail.id)}/sale`,
        { clientId, chargedPrice }
      );
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        available?: number;
        item?: { sku: string; status: string; priceGtq: string; sale: SaleInfo };
      };
      if (!response.ok || !body.ok || !body.item) {
        setSaleError(body.error || "No se pudo registrar la venta.");
        if (response.status === 409) {
          setSaleStep(null);
          const again = await storeRequest(
            `/api/markets/guatemala/inventory/${encodeURIComponent(detail.id)}?clientId=${encodeURIComponent(clientId)}`
          );
          const fresh = (await again.json()) as { ok?: boolean; item?: DetailItem };
          if (again.ok && fresh.ok && fresh.item) setDetail(fresh.item);
        }
        return;
      }
      setAvailable(body.available ?? available);
      setDetail({
        ...detail,
        sku: body.item.sku,
        status: body.item.status,
        priceGtq: body.item.priceGtq,
        sale: body.item.sale,
      });
      setSaleStep(null);
    } catch {
      setSaleError("No se pudo registrar la venta.");
    } finally {
      savingSaleRef.current = false;
      setSavingSale(false);
    }
  }

  const correctedPrice = quetzalPriceText(correctionPrice);
  const reasonText = correctionReason.trim();

  function openCorrection(step: "price-summary" | "void-summary") {
    correctionIdRef.current = crypto.randomUUID();
    setCorrectionError("");
    setCorrectionStep(step);
  }

  async function submitCorrection(action: "corregir" | "anular") {
    if (!detail?.sale || savingCorrectionRef.current) return;
    if (reasonText.length < 3) {
      setCorrectionError("Escribe el motivo.");
      return;
    }
    savingCorrectionRef.current = true;
    setSavingCorrection(true);
    setCorrectionError("");
    try {
      const response = await storeRequest(
        `/api/markets/guatemala/inventory/${encodeURIComponent(detail.id)}/sale/correction`,
        {
          clientId,
          action,
          reason: reasonText,
          correctionId: correctionIdRef.current,
          expectedChargedPrice: detail.sale.chargedPriceGtq,
          chargedPrice: action === "corregir" ? correctedPrice : undefined,
        }
      );
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        available?: number;
        sale?: SaleInfo;
      };
      if (!response.ok || !body.ok || !body.sale) {
        setCorrectionError(body.error || "No se pudo guardar la corrección.");
        if (response.status === 409) {
          const again = await storeRequest(
            `/api/markets/guatemala/inventory/${encodeURIComponent(detail.id)}?clientId=${encodeURIComponent(clientId)}`
          );
          const fresh = (await again.json()) as { ok?: boolean; item?: DetailItem };
          if (again.ok && fresh.ok && fresh.item) setDetail(fresh.item);
        }
        return;
      }
      setAvailable(body.available ?? available);
      setDetail({
        ...detail,
        status: body.sale.voidedAt ? "disponible" : "vendida",
        chargedPriceGtq: body.sale.voidedAt ? null : body.sale.chargedPriceGtq,
        sale: body.sale,
      });
      setCorrectionStep(null);
      setCorrectionPrice("");
      setCorrectionReason("");
    } catch {
      setCorrectionError("No se pudo guardar la corrección.");
    } finally {
      savingCorrectionRef.current = false;
      setSavingCorrection(false);
    }
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
              <span className={`gt-inventory-status${detail.status === "vendida" ? " is-sold" : ""}`}>
                {guatemalaInventoryStatusLabel(detail.status)}
              </span>
              {detail.sale?.isTest ? <span className="gt-test-badge">Prueba</span> : null}
              <dl className="gt-inventory-facts">
                <div>
                  <dt>Precio publicado</dt>
                  <dd>{formatStoredQuetzales(detail.sale?.publishedPriceGtq || detail.priceGtq)}</dd>
                </div>
                {detail.sale ? (
                  <>
                    <div>
                      <dt>Precio cobrado</dt>
                      <dd>{formatStoredQuetzales(detail.sale.chargedPriceGtq)}</dd>
                    </div>
                    <div>
                      <dt>Vendida</dt>
                      <dd>{formatGuatemalaMoment(detail.sale.soldAt)}</dd>
                    </div>
                    {detail.sale.soldByRole === "encargado" && detail.sale.soldByUsername ? (
                      <div>
                        <dt>Registrada por</dt>
                        <dd>{detail.sale.soldByUsername}</dd>
                      </div>
                    ) : detail.sale.soldByRole === "propietario" ? (
                      <div>
                        <dt>Registrada por</dt>
                        <dd>Propietario</dd>
                      </div>
                    ) : null}
                    {detail.sale.originalChargedPriceGtq &&
                    detail.sale.originalChargedPriceGtq !== detail.sale.chargedPriceGtq ? (
                      <div>
                        <dt>Precio cobrado original</dt>
                        <dd>{formatStoredQuetzales(detail.sale.originalChargedPriceGtq)}</dd>
                      </div>
                    ) : null}
                    {detail.sale.voidedAt ? (
                      <div>
                        <dt>Venta anulada</dt>
                        <dd>{formatGuatemalaMoment(detail.sale.voidedAt)}</dd>
                      </div>
                    ) : null}
                  </>
                ) : null}
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
              {detail.sale?.corrections && detail.sale.corrections.length > 0 ? (
                <div className="gt-sale-box">
                  <h3>Historial</h3>
                  {detail.sale.corrections.map((correction) => (
                    <div key={correction.id}>
                      <p>
                        {correction.action === "anular" ? "Anulación" : "Corrección"} ·{" "}
                        {formatGuatemalaMoment(correction.createdAt)} · Propietario
                      </p>
                      <p>
                        {correction.action === "anular"
                          ? `Antes ${formatStoredQuetzales(correction.previousChargedPriceGtq)}. La venta quedó anulada.`
                          : `Antes ${formatStoredQuetzales(correction.previousChargedPriceGtq)}. Ahora ${formatStoredQuetzales(correction.newChargedPriceGtq || "")}.`}
                      </p>
                      <p>Motivo: {correction.reason}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {detail.description ? <p>{detail.description}</p> : null}
              {detail.status === "disponible" && saleStep === null ? (
                <button type="button" className="btn btn-primary gt-sale-start" onClick={() => setSaleStep("form")}>
                  Registrar venta
                </button>
              ) : null}
              {detail.status === "disponible" && saleStep === "form" ? (
                <form
                  className="gt-sale-box"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!chargedPrice) {
                      setSaleError("Escribe un precio cobrado mayor que cero.");
                      return;
                    }
                    setSaleError("");
                    setSaleStep("confirm");
                  }}
                >
                  <h3>Registrar venta</h3>
                  <p>SKU {detail.sku}</p>
                  <p>Precio publicado {formatStoredQuetzales(detail.priceGtq)}</p>
                  <label htmlFor="charged-price">Precio cobrado</label>
                  <div className="gt-sale-price">
                    <span aria-hidden="true">Q</span>
                    <input
                      id="charged-price"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder="0.00"
                      value={chargedDraft}
                      onChange={(event) => setChargedDraft(event.target.value)}
                    />
                  </div>
                  {saleError ? <p className="note note-error" role="alert">{saleError}</p> : null}
                  <div className="gt-inventory-actions">
                    <button type="submit" className="btn btn-primary">Continuar</button>
                    <button type="button" className="btn btn-ghost" onClick={() => { setSaleStep(null); setSaleError(""); }}>
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : null}
              {detail.status === "disponible" && saleStep === "confirm" && chargedPrice ? (
                <div className="gt-sale-box">
                  <h3>Resumen de la venta</h3>
                  <p>SKU {detail.sku}</p>
                  <p>Precio publicado {formatStoredQuetzales(detail.priceGtq)}</p>
                  <p>Precio cobrado {formatStoredQuetzales(chargedPrice)}</p>
                  {saleError ? <p className="note note-error" role="alert">{saleError}</p> : null}
                  <div className="gt-inventory-actions">
                    <button type="button" className="btn btn-primary" disabled={savingSale} onClick={() => void confirmSale()}>
                      {savingSale ? "Guardando…" : "Confirmar venta"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={savingSale}
                      onClick={() => {
                        setSaleStep(null);
                        setSaleError("");
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}
              {!staffMode && detail.status === "vendida" && detail.sale && !detail.sale.voidedAt && correctionStep === null ? (
                <div className="gt-inventory-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setCorrectionPrice("");
                      setCorrectionReason("");
                      setCorrectionError("");
                      setCorrectionStep("price");
                    }}
                  >
                    Corregir precio cobrado
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setCorrectionReason("");
                      setCorrectionError("");
                      setCorrectionStep("void");
                    }}
                  >
                    Anular venta
                  </button>
                </div>
              ) : null}
              {!staffMode && correctionStep === "price" ? (
                <form
                  className="gt-sale-box"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!correctedPrice) {
                      setCorrectionError("Escribe un precio cobrado mayor que cero.");
                      return;
                    }
                    if (correctedPrice === detail.sale?.chargedPriceGtq) {
                      setCorrectionError("El precio cobrado no cambió.");
                      return;
                    }
                    if (reasonText.length < 3) {
                      setCorrectionError("Escribe el motivo.");
                      return;
                    }
                    openCorrection("price-summary");
                  }}
                >
                  <h3>Corregir precio cobrado</h3>
                  <p>Precio cobrado actual {formatStoredQuetzales(detail.sale?.chargedPriceGtq || "")}</p>
                  <label htmlFor="corrected-price">Nuevo precio cobrado</label>
                  <div className="gt-sale-price">
                    <span aria-hidden="true">Q</span>
                    <input
                      id="corrected-price"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={correctionPrice}
                      onChange={(event) => setCorrectionPrice(event.target.value)}
                    />
                  </div>
                  <label htmlFor="correction-reason">Motivo</label>
                  <input
                    id="correction-reason"
                    type="text"
                    value={correctionReason}
                    onChange={(event) => setCorrectionReason(event.target.value)}
                  />
                  {correctionError ? <p className="note note-error" role="alert">{correctionError}</p> : null}
                  <div className="gt-inventory-actions">
                    <button type="submit" className="btn btn-primary">Continuar</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setCorrectionStep(null)}>
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : null}
              {!staffMode && correctionStep === "price-summary" && correctedPrice ? (
                <div className="gt-sale-box">
                  <h3>Resumen de la corrección</h3>
                  <p>SKU {detail.sku}</p>
                  <p>Precio cobrado anterior {formatStoredQuetzales(detail.sale?.chargedPriceGtq || "")}</p>
                  <p>Precio cobrado nuevo {formatStoredQuetzales(correctedPrice)}</p>
                  <p>Motivo: {reasonText}</p>
                  <p>Quién registró la venta no cambia.</p>
                  {correctionError ? <p className="note note-error" role="alert">{correctionError}</p> : null}
                  <div className="gt-inventory-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={savingCorrection}
                      onClick={() => void submitCorrection("corregir")}
                    >
                      {savingCorrection ? "Guardando…" : "Confirmar corrección"}
                    </button>
                    <button type="button" className="btn btn-ghost" disabled={savingCorrection} onClick={() => setCorrectionStep(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}
              {!staffMode && correctionStep === "void" ? (
                <form
                  className="gt-sale-box"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (reasonText.length < 3) {
                      setCorrectionError("Escribe el motivo.");
                      return;
                    }
                    openCorrection("void-summary");
                  }}
                >
                  <h3>Anular venta</h3>
                  <p>La prenda volverá a disponibles. La venta original se conserva.</p>
                  <label htmlFor="void-reason">Motivo</label>
                  <input
                    id="void-reason"
                    type="text"
                    value={correctionReason}
                    onChange={(event) => setCorrectionReason(event.target.value)}
                  />
                  {correctionError ? <p className="note note-error" role="alert">{correctionError}</p> : null}
                  <div className="gt-inventory-actions">
                    <button type="submit" className="btn btn-primary">Continuar</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setCorrectionStep(null)}>
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : null}
              {!staffMode && correctionStep === "void-summary" ? (
                <div className="gt-sale-box">
                  <h3>Resumen de la anulación</h3>
                  <p>SKU {detail.sku}</p>
                  <p>Precio cobrado {formatStoredQuetzales(detail.sale?.chargedPriceGtq || "")}</p>
                  <p>Motivo: {reasonText}</p>
                  <p>La prenda quedará disponible. Quién registró la venta no cambia.</p>
                  {correctionError ? <p className="note note-error" role="alert">{correctionError}</p> : null}
                  <div className="gt-inventory-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={savingCorrection}
                      onClick={() => void submitCorrection("anular")}
                    >
                      {savingCorrection ? "Guardando…" : "Confirmar anulación"}
                    </button>
                    <button type="button" className="btn btn-ghost" disabled={savingCorrection} onClick={() => setCorrectionStep(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          <div className="gt-inventory-actions">
            <button type="button" className="btn btn-primary" onClick={backToList}>
              Volver al inventario
            </button>
            {staffMode ? null : (
              <a className="btn btn-ghost" href="/">
                Volver a las prendas
              </a>
            )}
          </div>
        </section>
      ) : (
        <section className="panel" aria-labelledby="inventory-list-heading">
          <div className="gt-inventory-toolbar">
            <h2 id="inventory-list-heading" className="gt-inventory-count">
              {availableGarmentLabel(available)}
            </h2>
            <div className="gt-inventory-filters" role="group" aria-label="Filtrar prendas">
              {(["disponibles", "vendidas", "todas"] as InventoryListFilter[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="gt-filter"
                  aria-pressed={filter === option}
                  onClick={() => chooseFilter(option)}
                >
                  {option === "disponibles" ? "Disponibles" : option === "vendidas" ? "Vendidas" : "Todas"}
                </button>
              ))}
            </div>
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
                : filter === "vendidas"
                  ? "No hay prendas vendidas."
                  : filter === "disponibles"
                    ? "No hay prendas disponibles."
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
                  {item.status === "vendida" && item.chargedPriceGtq ? (
                    <>
                      {item.saleIsTest ? <span className="gt-test-badge">Prueba</span> : null}
                      <p className="gt-sold-for">Vendido por {formatStoredQuetzales(item.chargedPriceGtq)}</p>
                      <p className="gt-inventory-meta">
                        Precio publicado {formatStoredQuetzales(item.publishedPriceGtq || item.priceGtq)}
                      </p>
                    </>
                  ) : (
                    <p className="gt-inventory-meta">
                      {item.size ? `Talla ${item.size} · ` : ""}
                      {formatStoredQuetzales(item.priceGtq)}
                    </p>
                  )}
                  <span className={`gt-inventory-status${item.status === "vendida" ? " is-sold" : ""}`}>
                    {guatemalaInventoryStatusLabel(item.status)}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="gt-inventory-actions">
            <a className="btn btn-primary" href={staffMode ? reportsPath : `${reportsPath}?clientId=${encodeURIComponent(clientId)}`}>
              Reportes de ventas
            </a>
            {staffMode ? null : (
              <a className="btn btn-ghost" href="/">
                Volver a las prendas
              </a>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
