"use client";

import { useEffect, useState } from "react";
import { OwnerAccess } from "@/app/OwnerAccess";
import { accessHeaders } from "@/lib/api-client";
import { centsToUsd } from "@/lib/usa-lots/money";

interface LotRow {
  id: string;
  name: string;
  purchasedOn: string;
  purchaseCents: number;
  extraCents: number;
  sellableCount: number | null;
}

interface OpenSale {
  id: string;
  sku: string;
  title: string;
  ebayItemId: string;
  orderId: string;
}

interface SaleRow {
  id: string;
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
    const data = await response.json() as { ok?: boolean; error?: string; lots?: LotRow[]; open?: { unassigned: OpenSale[]; unmatched: OpenSale[] }; status?: { lines: string[] }; detail?: Detail | null };
    if (!response.ok || !data.ok) {
      setError(data.error || "No se pudieron leer los lotes.");
      return;
    }
    setLots(data.lots || []);
    setOpenSales(data.open || { unassigned: [], unmatched: [] });
    setStatusLines(data.status?.lines || []);
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
        const data = await response.json() as { ok?: boolean; error?: string; saved?: number; retryable?: boolean };
        if (data.retryable) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }
        if (!data.ok) {
          setError(data.error || "La sincronización manual no pudo continuar.");
          break;
        }
        setMessage(`Respaldo manual: se leyeron ${data.saved ?? 0} líneas. La tarea programada sigue sin necesidad de dejar esta página abierta.`);
        break;
      }
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
        <div className="result-actions">
          {lots.map((lot) => (
            <button key={lot.id} type="button" className={selected === lot.id ? "btn btn-primary" : "btn btn-ghost"} onClick={() => { setSelected(lot.id); void load(lot.id); }}>
              {lot.name}
            </button>
          ))}
        </div>
      </section>
      {detail ? (
        <section className="panel">
          <h2>{detail.lot.name}</h2>
          <p>{detail.lot.purchasedOn} · compra {centsToUsd(detail.lot.purchaseCents)} · gastos {centsToUsd(detail.lot.extraCents)} · moneda USD</p>
          <p>Total invertido: {centsToUsd(detail.report.investedCents)}</p>
          <p>Registrados: {detail.report.registered}. Publicados: {detail.report.published}. Vendidos: {detail.report.sold}. Trasladados: {detail.report.transferred}. Restantes: {detail.report.remaining == null ? "conteo incompleto" : detail.report.remaining}{detail.report.remainingEstimated ? " (estimado)" : ""}.</p>
          <p>{detail.report.soldProfitProvisional ? "Ganancia provisional" : "Ganancia"} de lo vendido: {centsToUsd(detail.report.soldProfitCents)}. Este número resta el costo de las unidades vendidas una sola vez.</p>
          <p>Dinero recuperado neto de gastos de venta: {centsToUsd(detail.report.recoveredCents)}{detail.report.recoveredProvisional ? " (provisional)" : ""}. No resta otra vez el costo del lote.</p>
          <p>{detail.report.surplusCents != null ? `Excedente recuperado: ${centsToUsd(detail.report.surplusCents)}.` : `Inversión pendiente de recuperar: ${centsToUsd(detail.report.investmentLeftCents)}.`}</p>
          <p>Costo del inventario restante: {centsToUsd(detail.report.unsoldCostCents)}</p>
          {detail.report.pending.length > 0 ? <ul>{detail.report.pending.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          <button type="button" className="btn btn-ghost" onClick={() => void post({ action: "average", lotId: detail.lot.id }).then((ok) => { if (ok) void load(detail.lot.id); })}>Repartir promedio</button>
          <p className="note">El promedio solo cambia artículos sin costo manual y sin una venta ya registrada. Si el conteo está incompleto, el costo queda estimado.</p>
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
              </li>
            ))}
          </ul>
          <h3>Ventas del lote</h3>
          {detail.sales.length === 0 ? <p>Todavía no hay ventas identificadas en este lote.</p> : null}
          {detail.sales.map((sale) => (
            <p key={sale.id}>
              {sale.soldAt.slice(0, 10)} · SKU {sale.sku || "sin SKU"} · {sale.title} · final {centsToUsd(sale.itemCents)} · envío cobrado {centsToUsd(sale.buyerShippingCents)} · comisión {centsToUsd(sale.feeCents)} · envío pagado {centsToUsd(sale.sellerShippingCents)} · costo {centsToUsd(sale.unitCostCents)} · {sale.label} {centsToUsd(sale.profitCents)}
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
          <p key={sale.id}>{sale.orderId} · SKU {sale.sku || "sin SKU"} · anuncio {sale.ebayItemId || "sin número"} · {sale.title}</p>
        ))}
      </section>
    </main>
  );
}
