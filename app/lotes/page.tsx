"use client";

import { useEffect, useState } from "react";
import { OwnerAccess } from "@/app/OwnerAccess";
import { accessHeaders } from "@/lib/api-client";
import { centsToInput, centsToUsd } from "@/lib/usa-lots/money";

interface LotRow {
  id: string;
  name: string;
  purchasedOn: string;
  purchaseCents: number;
  extraCents: number;
  sellableCount: number | null;
  guatemalaPieces?: number;
  guatemalaShippingCents?: number;
}

interface OpenSale {
  id: string;
  sku: string;
  title: string;
  ebayItemId: string;
  orderId: string;
  platform?: string;
}

interface SaleRow {
  id: string;
  platform?: string;
  sku: string;
  title: string;
  ebayItemId: string;
  soldAt: string;
  itemCents: number | null;
  buyerShippingCents: number | null;
  feeCents: number | null;
  sellerShippingCents: number | null;
  unitCostCents: number | null;
  profitCents: number | null;
  label: string;
  missing: string[];
  cancelled: boolean;
}

interface Detail {
  lot: LotRow;
  report: {
    investedCents: number;
    registered: number;
    published: number;
    sold: number;
    transferred: number;
    remaining: number | null;
    remainingEstimated: boolean;
    soldProfitCents: number | null;
    soldProfitProvisional: boolean;
    recoveredCents: number | null;
    recoveredProvisional: boolean;
    investmentLeftCents: number | null;
    surplusCents: number | null;
    unsoldCostCents: number | null;
    pending: string[];
    averageUnitCents: number | null;
    averageDisplayCents: number | null;
    pendingAssignCents: number | null;
    usPieces: number | null;
    linkedTransfers: number;
    guatemalaPieces: number;
    guatemalaShippingCents: number;
    guatemalaShippingUnitCents: number | null;
  };
  items: { id: string; sku: string; ebayItemId: string; title: string; unitCostCents: number | null; costEstimated: boolean; disposition: string }[];
  sales: SaleRow[];
}

export default function LotsPage() {
  const [workMode, setWorkMode] = useState("store");
  const [clientId, setClientId] = useState("");
  const [lots, setLots] = useState<LotRow[]>([]);
  const [openSales, setOpenSales] = useState<{ unassigned: OpenSale[]; unmatched: OpenSale[] }>({ unassigned: [], unmatched: [] });
  const [statusLines, setStatusLines] = useState<string[]>([]);
  const [marketplaceLines, setMarketplaceLines] = useState<string[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [name, setName] = useState("");
  const [purchasedOn, setPurchasedOn] = useState("");
  const [purchase, setPurchase] = useState("");
  const [extra, setExtra] = useState("0");
  const [sellableCount, setSellableCount] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editPurchase, setEditPurchase] = useState("");
  const [editExtra, setEditExtra] = useState("");
  const [editCount, setEditCount] = useState("");
  const [gtPieces, setGtPieces] = useState("");
  const [gtShipping, setGtShipping] = useState("0.00");

  const account = () => {
    const params = new URLSearchParams();
    if (workMode === "client" && clientId) {
      params.set("workMode", "client");
      params.set("clientId", clientId);
    }
    return params;
  };

  const load = async (lotId = selected) => {
    const params = account();
    if (lotId) params.set("lotId", lotId);
    const response = await fetch(`/api/lotes?${params.toString()}`, { cache: "no-store", headers: accessHeaders() });
    const data = await response.json() as { ok?: boolean; error?: string; lots?: LotRow[]; open?: { unassigned: OpenSale[]; unmatched: OpenSale[] }; status?: { lines: string[] }; detail?: Detail | null; marketplace?: string[] };
    if (!response.ok || !data.ok) {
      setError(data.error || "No se pudieron leer los lotes.");
      return;
    }
    setLots(data.lots || []);
    setOpenSales(data.open || { unassigned: [], unmatched: [] });
    setStatusLines(data.status?.lines || []);
    setMarketplaceLines(Array.isArray(data.marketplace) ? data.marketplace : []);
    setDetail(data.detail || null);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("workMode") === "client" ? "client" : "store";
    setWorkMode(mode);
    setClientId(params.get("clientId") || "");
  }, []);

  useEffect(() => {
    void load("");
  }, [workMode, clientId]);

  useEffect(() => {
    if (!detail) return;
    setGtPieces(detail.lot.guatemalaPieces ? String(detail.lot.guatemalaPieces) : "");
    setGtShipping(centsToInput(detail.lot.guatemalaShippingCents ?? 0));
  }, [detail]);

  const openEdit = (lot: LotRow) => {
    setEditingId(lot.id);
    setEditName(lot.name);
    setEditDate(lot.purchasedOn);
    setEditPurchase(centsToInput(lot.purchaseCents));
    setEditExtra(centsToInput(lot.extraCents));
    setEditCount(lot.sellableCount == null ? "" : String(lot.sellableCount));
    setError("");
    setMessage("");
  };

  const post = async (body: Record<string, unknown>) => {
    setError("");
    setMessage("");
    const response = await fetch("/api/lotes", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...accessHeaders() },
      body: JSON.stringify({ ...body, workMode, clientId: clientId || null }),
    });
    const data = await response.json() as { ok?: boolean; error?: string; message?: string };
    if (!response.ok || data.ok === false) {
      setError(data.error || "No se pudo guardar.");
      return false;
    }
    if (data.message) setMessage(data.message);
    return true;
  };

  const sync = async () => {
    setSyncing(true);
    setError("");
    setMessage("");
    try {
      for (let step = 0; step < 8; step += 1) {
        const response = await fetch("/api/lotes/sincronizar", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...accessHeaders() },
          body: JSON.stringify({ workMode, clientId: clientId || null }),
        });
        const data = await response.json() as { ok?: boolean; error?: string; saved?: number; linked?: number; retryable?: boolean };
        if (data.retryable) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }
        if (!data.ok) {
          setError(data.error || "La sincronización manual no pudo continuar.");
          break;
        }
        const linkedNote = data.linked ? ` Se vincularon ${data.linked} ventas que estaban sin asociar.` : "";
        setMessage(`Respaldo manual: se leyeron ${data.saved ?? 0} líneas.${linkedNote} La tarea programada sigue sin necesidad de dejar esta página abierta.`);
        break;
      }
      await load(selected);
    } finally {
      setSyncing(false);
    }
  };

  const prepareNotifications = async () => {
    setSyncing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/lotes/notificaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...accessHeaders() },
        body: JSON.stringify({ workMode, clientId: clientId || null }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; lines?: string[] };
      if (!response.ok || data.ok === false) setError(data.error || "No se pudieron preparar las notificaciones.");
      else setMessage((data.lines || []).join(" "));
      await load(selected);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main className="wrap">
      <header>
        <h1>Lotes de compra de Estados Unidos</h1>
        <p><a href="/">Área de trabajo</a>{" · "}<a href="/archivo">Archivo de artículos</a></p>
      </header>
      <OwnerAccess nextHref="/lotes" />
      <section className="panel">
        <h2 className="section-label">Sincronización de ventas</h2>
        {statusLines.map((line) => <p key={line} className="note">{line}</p>)}
        <button type="button" className="btn btn-ghost" disabled={syncing} onClick={() => void sync()}>
          {syncing ? "Leyendo ventas…" : "Actualizar ventas de eBay"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={syncing} onClick={() => void prepareNotifications()}>
          Preparar notificaciones de eBay
        </button>
        <p className="note">Registrar venta está dentro del lote que abras, en cada prenda que no esté apartada para Guatemala, debajo de Guardar costo. Ventas por vincular está al final de esta página.</p>
        <h3>Avisos de Poshmark y Depop</h3>
        {marketplaceLines.length === 0 ? <p>Leyendo avisos…</p> : marketplaceLines.map((line) => <p key={line} className="note" role="status">{line}</p>)}
        {message ? <p className="note" role="status">{message}</p> : null}
        {error ? <p className="note note-error" role="alert">{error}</p> : null}
      </section>
      <section className="panel">
        <h2 className="section-label">Nuevo lote</h2>
        <form className="archive-search" onSubmit={(event) => {
          event.preventDefault();
          void post({ action: "create", name, purchasedOn, purchase, extra, sellableCount }).then((ok) => { if (ok) void load(selected); });
        }}>
          <label htmlFor="lot-name">Nombre</label>
          <input id="lot-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Compra de 1,000 libras" />
          <label htmlFor="lot-date">Fecha</label>
          <input id="lot-date" type="date" value={purchasedOn} onChange={(event) => setPurchasedOn(event.target.value)} />
          <label htmlFor="lot-purchase">Costo de compra USD</label>
          <input id="lot-purchase" value={purchase} onChange={(event) => setPurchase(event.target.value)} inputMode="decimal" />
          <label htmlFor="lot-extra">Gastos adicionales USD</label>
          <input id="lot-extra" value={extra} onChange={(event) => setExtra(event.target.value)} inputMode="decimal" />
          <label htmlFor="lot-count">Piezas vendibles, si ya las contaste</label>
          <input id="lot-count" value={sellableCount} onChange={(event) => setSellableCount(event.target.value)} inputMode="numeric" />
          <button type="submit" className="btn btn-primary">Crear lote</button>
        </form>
        <div className="lot-list">
          {lots.map((lot) => (
            <div key={lot.id} className="lot-row">
              <button type="button" className={selected === lot.id ? "btn btn-primary" : "btn btn-ghost"} onClick={() => { setSelected(lot.id); void load(lot.id); }}>
                {lot.name}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => openEdit(lot)}>Editar lote</button>
              {editingId === lot.id ? (
                <form className="archive-search lot-edit" onSubmit={(event) => {
                  event.preventDefault();
                  void post({
                    action: "update",
                    lotId: lot.id,
                    name: editName,
                    purchasedOn: editDate,
                    purchase: editPurchase,
                    extra: editExtra,
                    sellableCount: editCount,
                  }).then((ok) => {
                    if (!ok) return;
                    setEditingId("");
                    setSelected(lot.id);
                    void load(lot.id);
                  });
                }}>
                  <label htmlFor={`edit-name-${lot.id}`}>Nombre</label>
                  <input id={`edit-name-${lot.id}`} value={editName} onChange={(event) => setEditName(event.target.value)} />
                  <label htmlFor={`edit-date-${lot.id}`}>Fecha</label>
                  <input id={`edit-date-${lot.id}`} type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} />
                  <label htmlFor={`edit-purchase-${lot.id}`}>Costo de compra USD</label>
                  <input id={`edit-purchase-${lot.id}`} value={editPurchase} onChange={(event) => setEditPurchase(event.target.value)} inputMode="decimal" />
                  <label htmlFor={`edit-extra-${lot.id}`}>Gastos adicionales USD</label>
                  <input id={`edit-extra-${lot.id}`} value={editExtra} onChange={(event) => setEditExtra(event.target.value)} inputMode="decimal" />
                  <label htmlFor={`edit-count-${lot.id}`}>Cantidad total de piezas vendibles</label>
                  <input id={`edit-count-${lot.id}`} value={editCount} onChange={(event) => setEditCount(event.target.value)} inputMode="numeric" />
                  <button type="submit" className="btn btn-primary">Guardar cambios</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditingId("")}>Cancelar</button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      {detail ? (
        <section className="panel">
          <h2>{detail.lot.name}</h2>
          <p>{detail.lot.purchasedOn} · compra {centsToUsd(detail.lot.purchaseCents)} · gastos {centsToUsd(detail.lot.extraCents)} · moneda USD</p>
          <p>Total invertido: {centsToUsd(detail.report.investedCents)}</p>
          {detail.report.averageDisplayCents != null && detail.lot.sellableCount ? (
            <p>
              Costo promedio: {detail.report.averageDisplayCents * detail.lot.sellableCount === detail.report.investedCents ? "" : "aproximadamente "}
              {centsToUsd(detail.report.averageDisplayCents)} por prenda ({centsToUsd(detail.report.investedCents)} ÷ {detail.lot.sellableCount}).
            </p>
          ) : null}
          {detail.report.usPieces != null ? (
            <p>Para Estados Unidos: {detail.report.usPieces} prendas. El envío a Guatemala no aumenta su costo.</p>
          ) : null}
          {detail.report.transferred > 0 ? (
            <p>
              Para Guatemala: {detail.report.transferred} prendas. Conservan su parte del costo original.
              {detail.report.guatemalaShippingCents > 0 ? ` El envío de ${centsToUsd(detail.report.guatemalaShippingCents)} corresponde solo a esas prendas.` : ""}
            </p>
          ) : null}
          {detail.report.linkedTransfers > 0 && (detail.lot.guatemalaPieces ?? 0) > 0 ? (
            <p>Los {detail.report.linkedTransfers} artículos apartados están dentro de las piezas destinadas a Guatemala y no se descuentan otra vez.</p>
          ) : null}
          <p>Registrados: {detail.report.registered}. Publicados: {detail.report.published}. Vendidos: {detail.report.sold}. Destinados a Guatemala: {detail.report.transferred}. Restantes en Estados Unidos: {detail.report.remaining == null ? "conteo incompleto" : detail.report.remaining}{detail.report.remainingEstimated ? " (estimado)" : ""}.</p>
          <p>{detail.report.soldProfitProvisional ? "Ganancia provisional" : "Ganancia"} de lo vendido: {centsToUsd(detail.report.soldProfitCents)}. Este número resta el costo de las unidades vendidas una sola vez.</p>
          <p>Dinero recuperado neto de gastos de venta: {centsToUsd(detail.report.recoveredCents)}{detail.report.recoveredProvisional ? " (provisional)" : ""}. No resta otra vez el costo del lote.</p>
          <p>{detail.report.surplusCents != null ? `Excedente recuperado: ${centsToUsd(detail.report.surplusCents)}${detail.report.recoveredProvisional ? " (provisional)" : ""}.` : `Inversión pendiente de recuperar: ${centsToUsd(detail.report.investmentLeftCents)}${detail.report.recoveredProvisional ? " (provisional)" : ""}.`}</p>
          <p>Costo del inventario restante: {centsToUsd(detail.report.unsoldCostCents)}</p>
          {detail.report.pending.length > 0 ? <ul>{detail.report.pending.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          <form className="archive-search" onSubmit={(event) => {
            event.preventDefault();
            void post({ action: "guatemala", lotId: detail.lot.id, pieces: gtPieces, shipping: gtShipping }).then((ok) => { if (ok) void load(detail.lot.id); });
          }}>
            <h3>Destinar piezas a Guatemala</h3>
            <p className="note">Registra el número de piezas sin crear un artículo por cada una. Siguen dentro del total vendible y conservan su parte del costo de este lote. El envío a Guatemala no se carga a las prendas que quedan en Estados Unidos.</p>
            <label htmlFor="gt-pieces">Piezas destinadas a Guatemala</label>
            <input id="gt-pieces" value={gtPieces} onChange={(event) => setGtPieces(event.target.value)} inputMode="numeric" placeholder="770" />
            <label htmlFor="gt-shipping">Envío a Guatemala USD</label>
            <input id="gt-shipping" value={gtShipping} onChange={(event) => setGtShipping(event.target.value)} inputMode="decimal" />
            <button type="submit" className="btn btn-primary">Guardar piezas para Guatemala</button>
          </form>
          <button type="button" className="btn btn-ghost" onClick={() => void post({ action: "average", lotId: detail.lot.id }).then((ok) => { if (ok) void load(detail.lot.id); })}>Repartir promedio</button>
          <p className="note">El promedio usa el total vendible, incluidas las piezas destinadas a Guatemala. No cambia un costo manual ni el costo ya guardado en una venta. El envío a Guatemala no entra en las prendas de Estados Unidos.</p>
          <p className="note">Apartar un artículo no lo quita del total vendible ni pasa su costo a las demás prendas. Si ya registraste un número de piezas para Guatemala, ese artículo cuenta dentro de ese número.</p>
          <p className="note">Poshmark y Depop no envían el precio ni la comisión. El correo solo avisa la venta. Regístrala en la ficha, con el enlace si lo tienes, para que entre en este lote. Si esa prenda ya se vendió por otra vía, no se cuenta otra vez.</p>
          {detail.items.length === 0 ? <p className="note">Este lote no tiene prendas registradas una por una, por eso no aparece Registrar venta.</p> : null}
          <ul>
            {detail.items.map((item) => (
              <li key={item.id}>
                {item.sku || "sin SKU"} · {item.ebayItemId || "sin anuncio"} · {item.title || "Sin título"} · costo {item.costEstimated ? "estimado " : ""}{centsToUsd(item.unitCostCents)}
                {item.disposition === "guatemala-transfer" ? " · apartado para Guatemala" : ""}
                <form onSubmit={(event) => {
                  event.preventDefault();
                  const cost = new FormData(event.currentTarget).get("cost");
                  void post({ action: "cost", itemId: item.id, cost }).then((ok) => { if (ok) void load(detail.lot.id); });
                }}>
                  <input name="cost" placeholder="Costo manual USD" />
                  <button type="submit" className="btn btn-ghost">Guardar costo</button>
                  <button type="button" className="btn btn-ghost" onClick={() => void post({ action: "transfer", itemId: item.id }).then((ok) => { if (ok) void load(detail.lot.id); })}>Apartar para Guatemala</button>
                </form>
                {item.disposition !== "guatemala-transfer" ? (
                  <form onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void post({
                      action: "marketplace",
                      itemId: item.id,
                      platform: form.get("platform"),
                      price: form.get("price"),
                      fee: form.get("fee"),
                      buyerShipping: form.get("buyerShipping"),
                      sellerShipping: form.get("sellerShipping"),
                      listingUrl: form.get("listingUrl"),
                    }).then((ok) => { if (ok) void load(detail.lot.id); });
                  }}>
                    <select name="platform" aria-label={`Plataforma de la venta ${item.sku || item.title}`}>
                      <option value="poshmark">Poshmark</option>
                      <option value="depop">Depop</option>
                    </select>
                    <input name="price" aria-label="Precio USD" placeholder="Precio USD" />
                    <input name="fee" aria-label="Comisión USD" placeholder="Comisión USD" />
                    <input name="buyerShipping" aria-label="Envío cobrado USD" placeholder="Envío cobrado USD" />
                    <input name="sellerShipping" aria-label="Envío pagado USD" placeholder="Envío pagado USD" />
                    <input name="listingUrl" aria-label="Enlace de la publicación" placeholder="Enlace de la publicación" />
                    <button type="submit" className="btn btn-ghost">Registrar venta</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          <h3>Ventas del lote</h3>
          {detail.sales.length === 0 ? <p>Todavía no hay ventas identificadas en este lote.</p> : null}
          {detail.sales.map((sale) => (
            <p key={sale.id}>
              {sale.soldAt.slice(0, 10)} · {sale.platform === "poshmark" ? "Poshmark" : sale.platform === "depop" ? "Depop" : "eBay"} · SKU {sale.sku || "sin SKU"} · {sale.title} · final {centsToUsd(sale.itemCents)} · envío cobrado {centsToUsd(sale.buyerShippingCents)} · comisión {centsToUsd(sale.feeCents)} · envío pagado {centsToUsd(sale.sellerShippingCents)} · costo {centsToUsd(sale.unitCostCents)} · {sale.label} {centsToUsd(sale.profitCents)}
              {sale.cancelled ? " · cancelada" : ""}
              {sale.missing.length ? ` · falta: ${sale.missing.join(", ")}` : ""}
            </p>
          ))}
        </section>
      ) : null}
      <section className="panel">
        <h2>Ventas sin lote</h2>
        {openSales.unassigned.length === 0 ? <p>No hay ventas identificadas sin lote.</p> : null}
        {openSales.unassigned.map((sale) => (
          <p key={sale.id}>{sale.sku || "sin SKU"} · {sale.ebayItemId} · {sale.title}
            <select defaultValue="" onChange={(event) => { if (event.target.value) void post({ action: "correct", saleId: sale.id, lotId: event.target.value, itemId: "" }).then((ok) => { if (ok) void load(selected); }); }}>
              <option value="">Asignar a un lote</option>
              {lots.map((lot) => <option key={lot.id} value={lot.id}>{lot.name}</option>)}
            </select>
          </p>
        ))}
        <h2>Ventas por vincular</h2>
        {openSales.unmatched.length === 0 ? <p>No hay ventas sin artículo identificado.</p> : null}
        {openSales.unmatched.map((sale) => (
          <p key={sale.id}>{sale.platform === "poshmark" ? "Poshmark" : sale.platform === "depop" ? "Depop" : "eBay"} · {sale.orderId} · SKU {sale.sku || "sin SKU"} · anuncio {sale.ebayItemId || "sin número"} · {sale.title}</p>
        ))}
      </section>
    </main>
  );
}
