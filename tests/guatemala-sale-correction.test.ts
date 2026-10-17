import { describe, expect, it } from "vitest";
import { applyGuatemalaSale } from "@/lib/markets/guatemala-inventory";
import {
  applySaleCorrection,
  effectiveChargedPrice,
  type CorrectableSale,
  type CorrectionBook,
} from "@/lib/markets/guatemala-sale-correction";
import { decideGuatemalaAccess } from "@/lib/markets/guatemala-staff";
import { summarizeChargedSales } from "@/lib/markets/guatemala-sales-report";

const photo = { id: "photo", mediaType: "image/jpeg", data: "foto" };
const now = new Date("2026-10-17T15:00:00.000Z");

function sale(partial: Partial<CorrectableSale> = {}): CorrectableSale {
  return {
    id: "sale-nueva",
    itemId: "prenda-nueva",
    clientId: "tienda",
    sku: "4100",
    publishedPriceGtq: "40.00",
    chargedPriceGtq: "20.00",
    soldAt: "2026-10-17T14:00:00.000Z",
    soldByRole: "encargado",
    soldByAccountId: "cuenta-1",
    soldByUsername: "ana",
    isTest: false,
    currentChargedPriceGtq: null,
    voidedAt: null,
    corrections: [],
    ...partial,
  };
}

function book(): CorrectionBook {
  const prueba1 = sale({
    id: "sale-prueba1",
    itemId: "prenda-prueba1",
    sku: "prueba1",
    chargedPriceGtq: "20.00",
    publishedPriceGtq: "40.00",
    soldAt: "2026-10-17T09:22:40.000Z",
    soldByRole: "propietario",
    soldByUsername: null,
    isTest: true,
  });
  const sku3002 = sale({
    id: "sale-3002",
    itemId: "prenda-3002",
    sku: "3002",
    chargedPriceGtq: "15.00",
    publishedPriceGtq: "30.00",
    isTest: true,
    soldByRole: null,
    soldByUsername: null,
  });
  return {
    items: [
      { id: "prenda-3001", clientId: "tienda", sku: "3001", priceGtq: "40.00", status: "disponible", photos: [photo] },
      { id: "prenda-3002", clientId: "tienda", sku: "3002", priceGtq: "30.00", status: "vendida", photos: [photo] },
      { id: "prenda-prueba1", clientId: "tienda", sku: "prueba1", priceGtq: "40.00", status: "vendida", photos: [photo] },
      { id: "prenda-nueva", clientId: "tienda", sku: "4100", priceGtq: "40.00", status: "vendida", photos: [photo] },
    ],
    sales: [sku3002, prueba1, sale()],
  };
}

describe("correcciones de ventas de Tienda Guatemala", () => {
  it("corrige el precio, conserva el autor original y suma el importe nuevo", () => {
    const original = book();
    const untouched3002 = original.sales[0];
    const untouchedPrueba1 = original.sales[1];
    const first = applySaleCorrection(original, {
      owner: true,
      clientId: "tienda",
      itemId: "prenda-nueva",
      action: "corregir",
      correctionId: "corr-1",
      reason: "Se cobró menos en caja",
      chargedPrice: "18",
      expectedChargedPrice: "20.00",
      now,
      actor: { role: "propietario", accountId: null, username: null },
    });
    expect(first.result.ok).toBe(true);
    if (!first.result.ok) return;
    expect(first.result.sale.chargedPriceGtq).toBe("20.00");
    expect(effectiveChargedPrice(first.result.sale)).toBe("18.00");
    expect(first.result.sale.soldByUsername).toBe("ana");
    expect(first.result.sale.soldByRole).toBe("encargado");
    expect(first.result.sale.isTest).toBe(false);
    expect(first.result.sale.corrections).toEqual([
      expect.objectContaining({
        previousChargedPriceGtq: "20.00",
        newChargedPriceGtq: "18.00",
        reason: "Se cobró menos en caja",
        actorRole: "propietario",
      }),
    ]);
    expect(first.book.sales[0]).toBe(untouched3002);
    expect(first.book.sales[1]).toBe(untouchedPrueba1);
    expect(first.book.items.find((item) => item.sku === "3001")?.status).toBe("disponible");

    const repeated = applySaleCorrection(first.book, {
      owner: true,
      clientId: "tienda",
      itemId: "prenda-nueva",
      action: "corregir",
      correctionId: "corr-1",
      reason: "Se cobró menos en caja",
      chargedPrice: "18",
      expectedChargedPrice: "20.00",
      now,
    });
    expect(repeated.book).toBe(first.book);
    expect(repeated.result.ok && repeated.result.replayed).toBe(true);
    expect(first.book.sales.find((entry) => entry.sku === "4100")?.corrections).toHaveLength(1);

    const stale = applySaleCorrection(first.book, {
      owner: true,
      clientId: "tienda",
      itemId: "prenda-nueva",
      action: "corregir",
      correctionId: "corr-2",
      reason: "Otro intento",
      chargedPrice: "10",
      expectedChargedPrice: "20.00",
      now,
    });
    expect(stale.book).toBe(first.book);
    expect(stale.result).toMatchObject({ ok: false, status: 409 });

    const summary = summarizeChargedSales(
      [
        {
          sku: "4100",
          title: "Nueva",
          publishedPriceGtq: "40.00",
          chargedPriceGtq: effectiveChargedPrice(first.result.sale),
          soldAt: first.result.sale.soldAt,
          isTest: first.result.sale.isTest,
        },
        {
          sku: "prueba1",
          title: "Prueba",
          publishedPriceGtq: "40.00",
          chargedPriceGtq: "20.00",
          soldAt: untouchedPrueba1.soldAt,
          isTest: true,
        },
      ],
      false
    );
    expect(summary.totalChargedGtq).toBe("18.00");
    expect(summary.rows.some((row) => row.sku === "prueba1")).toBe(false);
  });

  it("anula la venta, la saca del reporte y permite vender la prenda otra vez", () => {
    const original = book();
    const voided = applySaleCorrection(original, {
      owner: true,
      clientId: "tienda",
      itemId: "prenda-nueva",
      action: "anular",
      correctionId: "anul-1",
      reason: "Se registró por error",
      expectedChargedPrice: "20.00",
      now,
      actor: { role: "propietario", accountId: null, username: null },
    });
    expect(voided.result.ok).toBe(true);
    if (!voided.result.ok) return;
    expect(voided.result.sale.voidedAt).toBe(now.toISOString());
    expect(voided.result.sale.chargedPriceGtq).toBe("20.00");
    expect(voided.result.sale.soldByUsername).toBe("ana");
    expect(voided.book.items.find((item) => item.sku === "4100")?.status).toBe("disponible");
    expect(voided.book.sales.filter((entry) => entry.sku === "4100")).toHaveLength(1);
    expect(
      summarizeChargedSales(
        [
          {
            sku: "4100",
            title: "Nueva",
            publishedPriceGtq: "40.00",
            chargedPriceGtq: "20.00",
            soldAt: voided.result.sale.soldAt,
            isTest: false,
            voided: true,
          },
        ],
        true
      ).count
    ).toBe(0);

    const resold = applyGuatemalaSale(voided.book, {
      clientId: "tienda",
      itemId: "prenda-nueva",
      chargedPrice: "22",
      clientAllowed: true,
      now: new Date("2026-10-17T16:00:00.000Z"),
      soldBy: { role: "encargado", accountId: "cuenta-1", username: "ana" },
    });
    expect(resold.result.ok).toBe(true);
    expect(resold.book.sales.filter((entry) => entry.itemId === "prenda-nueva")).toHaveLength(2);
    expect(resold.book.sales.find((entry) => entry.voidedAt)?.chargedPriceGtq).toBe("20.00");
    const conflict = applySaleCorrection(resold.book as CorrectionBook, {
      owner: true,
      clientId: "tienda",
      itemId: "prenda-nueva",
      action: "anular",
      correctionId: "anul-vieja",
      reason: "Intento sobre la venta anulada",
      expectedChargedPrice: "20.00",
      now,
    });
    expect(conflict.result.ok).toBe(false);
    expect(conflict.book.sales.find((entry) => entry.voidedAt)?.corrections).toHaveLength(1);
  });

  it("niega la corrección al encargado aunque también tenga el acceso del propietario", () => {
    const original = book();
    const denied = applySaleCorrection(original, {
      owner: false,
      clientId: "tienda",
      itemId: "prenda-nueva",
      action: "anular",
      correctionId: "anul-staff",
      reason: "No debería poder",
      expectedChargedPrice: "20.00",
      actor: { role: "encargado", accountId: "cuenta-1", username: "ana" },
    });
    expect(denied.book).toBe(original);
    expect(denied.result).toMatchObject({ ok: false, status: 403 });
    expect(
      decideGuatemalaAccess({
        owner: true,
        staffPanel: true,
        account: {
          id: "cuenta-1",
          clientId: "tienda",
          username: "ana",
          active: true,
          sessionGeneration: 1,
          deactivatedAt: null,
        },
        session: {
          accountId: "cuenta-1",
          sessionGeneration: 1,
          expiresAt: "2026-10-31T00:00:00.000Z",
        },
        requestedClientId: "tienda",
        action: "correct",
        now,
      })
    ).toMatchObject({ ok: false, status: 403 });
  });
});
