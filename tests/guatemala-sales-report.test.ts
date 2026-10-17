import { describe, expect, it } from "vitest";
import {
  chargedTotalForDisplay,
  guatemalaSalesRange,
  saleFallsInRange,
  summarizeChargedSales,
  type ReportSale,
} from "@/lib/markets/guatemala-sales-report";

function sale(partial: Partial<ReportSale> & Pick<ReportSale, "chargedPriceGtq" | "soldAt">): ReportSale {
  return {
    sku: "3002",
    title: "Playera de prueba",
    publishedPriceGtq: "25.00",
    isTest: false,
    ...partial,
  };
}

describe("reportes de ventas de Guatemala", () => {
  const fridayEvening = new Date("2026-10-17T04:50:00.000Z");

  it("suma el precio cobrado y deja fuera el publicado", () => {
    const summary = summarizeChargedSales(
      [
        sale({ chargedPriceGtq: "15.00", publishedPriceGtq: "25.00", soldAt: "2026-10-16T18:00:00.000Z" }),
        sale({ sku: "A-1", chargedPriceGtq: "10.50", publishedPriceGtq: "40.00", soldAt: "2026-10-16T19:00:00.000Z" }),
      ],
      false
    );
    expect(summary.totalChargedGtq).toBe("25.50");
    expect(summary.count).toBe(2);
  });

  it("excluye pruebas por defecto y permite incluirlas sin usar el SKU como regla", () => {
    const rows = [
      sale({ sku: "3002", chargedPriceGtq: "15.00", soldAt: "2026-10-16T18:00:00.000Z", isTest: true }),
      sale({ sku: "3002", chargedPriceGtq: "20.00", soldAt: "2026-10-16T19:00:00.000Z", isTest: false }),
    ];
    const hidden = summarizeChargedSales(rows, false);
    expect(hidden.count).toBe(1);
    expect(hidden.totalChargedGtq).toBe("20.00");
    expect(hidden.rows[0]?.isTest).toBe(false);
    const included = summarizeChargedSales(rows, true);
    expect(included.count).toBe(2);
    expect(included.totalChargedGtq).toBe("35.00");
    expect(included.rows.some((row) => row.isTest)).toBe(true);
  });

  it("no muestra un total cuando la consulta no está lista", () => {
    expect(chargedTotalForDisplay(false, "0.00")).toBeNull();
    expect(chargedTotalForDisplay(false, null)).toBeNull();
    expect(chargedTotalForDisplay(true, "0.00")).toBe("0.00");
  });

  it("cierra el día, la semana y el mes en America/Guatemala", () => {
    const today = guatemalaSalesRange({ period: "hoy", now: fridayEvening });
    expect(today.ok && today.range.from).toBe("2026-10-16");
    expect(today.ok && today.range.to).toBe("2026-10-16");
    if (!today.ok) return;
    expect(today.range.start.toISOString()).toBe("2026-10-16T06:00:00.000Z");
    expect(today.range.end.toISOString()).toBe("2026-10-17T06:00:00.000Z");
    expect(saleFallsInRange("2026-10-17T05:59:59.000Z", today.range)).toBe(true);
    expect(saleFallsInRange("2026-10-17T06:00:00.000Z", today.range)).toBe(false);
    expect(saleFallsInRange("2026-10-16T05:59:59.000Z", today.range)).toBe(false);

    const week = guatemalaSalesRange({ period: "semana", now: fridayEvening });
    expect(week.ok && week.range.from).toBe("2026-10-12");
    expect(week.ok && week.range.to).toBe("2026-10-18");
    if (!week.ok) return;
    expect(saleFallsInRange("2026-10-12T06:00:00.000Z", week.range)).toBe(true);
    expect(saleFallsInRange("2026-10-12T05:59:59.000Z", week.range)).toBe(false);
    expect(saleFallsInRange("2026-10-19T05:59:59.000Z", week.range)).toBe(true);
    expect(saleFallsInRange("2026-10-19T06:00:00.000Z", week.range)).toBe(false);

    const month = guatemalaSalesRange({ period: "mes", now: fridayEvening });
    expect(month.ok && month.range.from).toBe("2026-10-01");
    expect(month.ok && month.range.to).toBe("2026-10-31");
    if (!month.ok) return;
    expect(saleFallsInRange("2026-10-01T06:00:00.000Z", month.range)).toBe(true);
    expect(saleFallsInRange("2026-10-01T05:59:59.000Z", month.range)).toBe(false);
    expect(saleFallsInRange("2026-11-01T05:59:59.000Z", month.range)).toBe(true);
    expect(saleFallsInRange("2026-11-01T06:00:00.000Z", month.range)).toBe(false);
  });

  it("cruza el cambio de año y respeta febrero", () => {
    const newYear = guatemalaSalesRange({ period: "semana", now: new Date("2027-01-01T18:00:00.000Z") });
    expect(newYear.ok && newYear.range.from).toBe("2026-12-28");
    expect(newYear.ok && newYear.range.to).toBe("2027-01-03");
    const february = guatemalaSalesRange({ period: "mes", now: new Date("2026-02-15T18:00:00.000Z") });
    expect(february.ok && february.range.from).toBe("2026-02-01");
    expect(february.ok && february.range.to).toBe("2026-02-28");
    const december = guatemalaSalesRange({ period: "mes", now: new Date("2026-12-31T18:00:00.000Z") });
    expect(december.ok && december.range.from).toBe("2026-12-01");
    expect(december.ok && december.range.to).toBe("2026-12-31");
  });

  it("valida el rango civil sin convertirlo a la medianoche UTC", () => {
    const range = guatemalaSalesRange({
      period: "rango",
      from: "2026-10-15",
      to: "2026-10-16",
      now: fridayEvening,
    });
    expect(range.ok).toBe(true);
    if (!range.ok) return;
    expect(range.range.start.toISOString()).toBe("2026-10-15T06:00:00.000Z");
    expect(range.range.end.toISOString()).toBe("2026-10-17T06:00:00.000Z");
    expect(guatemalaSalesRange({ period: "rango", from: "2026-10-16", to: "2026-10-15" }).ok).toBe(false);
    expect(guatemalaSalesRange({ period: "rango", from: "2026-02-31", to: "2026-03-01" }).ok).toBe(false);
  });
});
