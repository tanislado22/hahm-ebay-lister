import { describe, expect, it } from "vitest";
import { applyGuatemalaSale, type SaleBook } from "@/lib/markets/guatemala-inventory";
import { acceptedSaleUpdate } from "@/lib/markets/guatemala-pwa";
import { summarizeChargedSales, type ReportSale } from "@/lib/markets/guatemala-sales-report";
import {
  SALE_PAYMENT_MESSAGES,
  changeDueLabel,
  prepareSalePayment,
  saleIncomeGtq,
  saleMayBeConfirmed,
} from "@/lib/markets/guatemala-sale-payment";

const photo = { id: "photo-1", mediaType: "image/jpeg", data: "foto-prueba" };

function book(): SaleBook {
  return {
    items: [
      {
        id: "blusa",
        clientId: "tienda",
        sku: "4015",
        priceGtq: "20.00",
        status: "disponible",
        photos: [photo],
      },
    ],
    sales: [],
  };
}

describe("vuelto de Tienda Guatemala", () => {
  it("cobra Q15, recibe Q100 y entrega Q85 sin contar el billete como ingreso", () => {
    const payment = prepareSalePayment({ method: "efectivo", chargedPrice: "15", cashReceived: "100" });
    expect(payment.ok).toBe(true);
    if (!payment.ok) return;
    expect(payment.payment.chargedPriceGtq).toBe("15.00");
    expect(payment.payment.cashReceivedGtq).toBe("100.00");
    expect(changeDueLabel(payment.payment.changeGtq ?? "")).toBe("Cambio a entregar: Q85.00");
    expect(saleIncomeGtq(payment.payment)).toBe("15.00");
    expect(saleMayBeConfirmed(payment)).toBe(true);

    const sold = applyGuatemalaSale(book(), {
      clientId: "tienda",
      itemId: "blusa",
      chargedPrice: "15",
      paymentMethod: "efectivo",
      cashReceived: "100",
      clientAllowed: true,
    });
    expect(sold.result.ok).toBe(true);
    if (!sold.result.ok) return;
    expect(sold.result.sale.chargedPriceGtq).toBe("15.00");
    expect(sold.result.sale.cashReceivedGtq).toBe("100.00");
    expect(sold.result.sale.changeGtq).toBe("85.00");
    expect(saleIncomeGtq(sold.result.sale)).toBe("15.00");

    const report = summarizeChargedSales(
      [
        reportSale({
          chargedPriceGtq: sold.result.sale.chargedPriceGtq,
        }),
      ],
      false
    );
    expect(report.totalChargedGtq).toBe("15.00");
    expect(report.totalChargedGtq).not.toBe("100.00");
  });

  it("muestra Q0.00 cuando el efectivo es exacto", () => {
    const payment = prepareSalePayment({ method: "efectivo", chargedPrice: "15.00", cashReceived: "15" });
    expect(payment.ok).toBe(true);
    if (!payment.ok) return;
    expect(changeDueLabel(payment.payment.changeGtq ?? "")).toBe("Cambio a entregar: Q0.00");
    expect(payment.payment.incomeGtq).toBe("15.00");
  });

  it("indica cuánto falta y no guarda la venta si el efectivo no alcanza", () => {
    const original = book();
    const payment = prepareSalePayment({ method: "efectivo", chargedPrice: "15.00", cashReceived: "10" });
    expect(payment).toEqual({ ok: false, status: 400, error: SALE_PAYMENT_MESSAGES.short("5.00") });
    expect(saleMayBeConfirmed(payment)).toBe(false);

    const sold = applyGuatemalaSale(original, {
      clientId: "tienda",
      itemId: "blusa",
      chargedPrice: "15.00",
      paymentMethod: "efectivo",
      cashReceived: "10",
      clientAllowed: true,
    });
    expect(sold.book).toBe(original);
    expect(sold.result).toMatchObject({ ok: false, status: 400 });
    expect(original.sales).toHaveLength(0);
    expect(original.items[0]?.status).toBe("disponible");
  });

  it("oculta el efectivo en una transferencia y registra solo el precio cobrado", () => {
    const payment = prepareSalePayment({ method: "transferencia", chargedPrice: "15", cashReceived: "100" });
    expect(payment.ok).toBe(true);
    if (!payment.ok) return;
    expect(payment.payment.cashReceivedGtq).toBeNull();
    expect(payment.payment.changeGtq).toBeNull();
    expect(payment.payment.incomeGtq).toBe("15.00");

    const sold = applyGuatemalaSale(book(), {
      clientId: "tienda",
      itemId: "blusa",
      chargedPrice: "15",
      paymentMethod: "transferencia",
      cashReceived: "100",
      clientAllowed: true,
    });
    expect(sold.result.ok).toBe(true);
    if (!sold.result.ok) return;
    expect(sold.result.sale.paymentMethod).toBe("transferencia");
    expect(sold.result.sale.cashReceivedGtq).toBeNull();
    expect(sold.result.sale.changeGtq).toBeNull();
    expect(sold.result.sale.chargedPriceGtq).toBe("15.00");
  });

  it("rechaza una segunda venta y no marca como guardada una respuesta fallida", () => {
    const first = applyGuatemalaSale(book(), {
      clientId: "tienda",
      itemId: "blusa",
      chargedPrice: "15",
      paymentMethod: "efectivo",
      cashReceived: "15",
      clientAllowed: true,
    });
    const second = applyGuatemalaSale(first.book, {
      clientId: "tienda",
      itemId: "blusa",
      chargedPrice: "15",
      paymentMethod: "efectivo",
      cashReceived: "20",
      clientAllowed: true,
    });
    expect(second.book).toBe(first.book);
    expect(second.result).toMatchObject({ ok: false, status: 409 });
    expect(first.book.sales).toHaveLength(1);

    expect(acceptedSaleUpdate(false, { ok: false, error: "No se pudo registrar la venta." })).toBeNull();
    expect(acceptedSaleUpdate(true, { ok: false })).toBeNull();
    expect(acceptedSaleUpdate(true, { ok: true, item: { sale: null } })).toBeNull();
  });
});

function reportSale(overrides: Partial<ReportSale>): ReportSale {
  return {
    sku: "4015",
    title: "Blusa",
    publishedPriceGtq: "20.00",
    chargedPriceGtq: "15.00",
    soldAt: "2026-11-07T18:00:00.000Z",
    isTest: false,
    ...overrides,
  };
}
