"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { guatemalaRequest } from "../request";
import { formatGuatemalaMoment } from "@/lib/markets/guatemala";
import { formatStoredQuetzales } from "@/lib/markets/guatemala-inventory";
import type { InventoryPhoto } from "@/lib/markets/guatemala-inventory";
import {
  chargedTotalForDisplay,
  parseSalesReportPeriod,
  soldGarmentLabel,
  type SalesReportPeriod,
} from "@/lib/markets/guatemala-sales-report";
import "../inventario/inventory.css";
import "./report.css";

interface ReportSale {
  itemId: string;
  sku: string;
  title: string;
  publishedPriceGtq: string;
  chargedPriceGtq: string;
  soldAt: string;
  isTest: boolean;
  cover: InventoryPhoto | null;
}

interface ReportPayload {
  timezone: string;
  fromLabel: string;
  toLabel: string;
  count: number;
  totalChargedGtq: string;
  sales: ReportSale[];
}

const PERIODS: { id: SalesReportPeriod; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "semana", label: "Esta semana" },
  { id: "mes", label: "Este mes" },
  { id: "rango", label: "Rango" },
];

function photoSource(photo: InventoryPhoto): string {
  return `data:${photo.mediaType};base64,${photo.data}`;
}

export function SalesReportScreen({
  lockedClientId,
  basePath = "/guatemala/reportes",
  inventoryPath = "/guatemala/inventario",
}: {
  lockedClientId?: string;
  basePath?: string;
  inventoryPath?: string;
} = {}) {
  const params = useSearchParams();
  const router = useRouter();
  const staffMode = Boolean(lockedClientId);
  const clientId = lockedClientId || params.get("clientId") || "";
  function storeRequest(path: string, body?: unknown) {
    return guatemalaRequest(path, body, staffMode ? { actor: "encargado" } : undefined);
  }
  const period = parseSalesReportPeriod(params.get("periodo"));
  const from = params.get("desde") ?? "";
  const to = params.get("hasta") ?? "";
  const includeTests = params.get("incluirPruebas") === "1";
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();

    async function load(signal: AbortSignal) {
      if (!clientId) {
        setReport(null);
        setError("Selecciona Tienda Guatemala para ver sus reportes.");
        setLoading(false);
        return;
      }
      if (period === "rango" && (!from || !to)) {
        setReport(null);
        setError("");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      setReport(null);
      try {
        const search = new URLSearchParams({
          clientId,
          periodo: period,
          incluirPruebas: includeTests ? "1" : "0",
        });
        if (period === "rango") {
          search.set("desde", from);
          search.set("hasta", to);
        }
        const response = await storeRequest(`/api/markets/guatemala/reports?${search.toString()}`);
        const body = (await response.json()) as ReportPayload & { ok?: boolean; error?: string };
        if (signal.aborted) return;
        if (!response.ok || !body.ok) {
          setReport(null);
          setError(body.error || "No se pudieron cargar los reportes de ventas.");
          return;
        }
        setReport(body);
      } catch {
        if (!signal.aborted) {
          setReport(null);
          setError("No se pudieron cargar los reportes de ventas.");
        }
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
  }, [clientId, period, from, to, includeTests]);

  function update(next: { periodo?: SalesReportPeriod; desde?: string; hasta?: string; incluirPruebas?: boolean }) {
    const search = new URLSearchParams({
      periodo: next.periodo ?? period,
      incluirPruebas: (next.incluirPruebas ?? includeTests) ? "1" : "0",
    });
    if (!staffMode) search.set("clientId", clientId);
    const nextFrom = next.desde ?? from;
    const nextTo = next.hasta ?? to;
    if (nextFrom) search.set("desde", nextFrom);
    if (nextTo) search.set("hasta", nextTo);
    router.replace(`${basePath}?${search.toString()}`);
  }

  const chargedTotal = report ? chargedTotalForDisplay(true, report.totalChargedGtq) : null;

  return (
    <main className="wrap gt-inventory gt-report">
      <header>
        <h1>Reportes de ventas</h1>
        <p>Ventas guardadas de Tienda Guatemala. El total usa el precio cobrado.</p>
      </header>
      <section className="panel">
        <div className="gt-inventory-filters" role="group" aria-label="Período">
          {PERIODS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="gt-filter"
              aria-pressed={period === option.id}
              onClick={() => update({ periodo: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
        {period === "rango" ? (
          <div className="gt-report-range">
            <label>
              Desde
              <input type="date" value={from} onChange={(event) => update({ desde: event.target.value })} />
            </label>
            <label>
              Hasta
              <input type="date" value={to} onChange={(event) => update({ hasta: event.target.value })} />
            </label>
          </div>
        ) : null}
        <label className="gt-report-tests">
          <input
            type="checkbox"
            checked={includeTests}
            onChange={(event) => update({ incluirPruebas: event.target.checked })}
          />
          Incluir pruebas
        </label>
        {error ? (
          <p className="note note-error" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? <p>Cargando reportes…</p> : null}
        {report ? (
          <>
            <p className="gt-report-dates">
              Consultado: {report.fromLabel} al {report.toLabel}. Zona horaria {report.timezone}.
            </p>
            <p className="gt-inventory-count">{soldGarmentLabel(report.count)}</p>
            {chargedTotal ? <p className="gt-report-total">Total cobrado {formatStoredQuetzales(chargedTotal)}</p> : null}
            <p className="gt-report-note">Este importe suma el precio cobrado, no el publicado. No es ganancia.</p>
            {report.sales.length === 0 ? <p>No hay ventas en este período.</p> : null}
            <div className="gt-inventory-list">
              {report.sales.map((sale) => (
                <a
                  key={`${sale.itemId}-${sale.soldAt}`}
                  className="gt-inventory-card"
                  href={
                    staffMode
                      ? `${inventoryPath}?item=${encodeURIComponent(sale.itemId)}&estado=vendidas`
                      : `${inventoryPath}?clientId=${encodeURIComponent(clientId)}&item=${encodeURIComponent(sale.itemId)}&estado=vendidas`
                  }
                >
                  {sale.cover ? (
                    <img src={photoSource(sale.cover)} alt="" />
                  ) : (
                    <span className="gt-inventory-photo-fallback">Sin foto</span>
                  )}
                  <span>
                    <p className="gt-inventory-sku">SKU {sale.sku}</p>
                    <h2>{sale.title || "Prenda sin título"}</h2>
                    {sale.isTest ? <span className="gt-test-badge">Prueba</span> : null}
                    <p className="gt-sold-for">Vendido por {formatStoredQuetzales(sale.chargedPriceGtq)}</p>
                    <p className="gt-inventory-meta">
                      Precio publicado {formatStoredQuetzales(sale.publishedPriceGtq)}
                    </p>
                    <p className="gt-inventory-meta">{formatGuatemalaMoment(sale.soldAt)}</p>
                  </span>
                </a>
              ))}
            </div>
          </>
        ) : null}
        <div className="gt-inventory-actions">
          <a
            className="btn btn-ghost"
            href={staffMode ? inventoryPath : `${inventoryPath}?clientId=${encodeURIComponent(clientId)}`}
          >
            Volver al inventario
          </a>
        </div>
      </section>
    </main>
  );
}
