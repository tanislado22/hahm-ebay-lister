import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarizeGuatemalaProfit } from "@/lib/markets/guatemala-expenses";
import { PRICE_QR_MESSAGES, garmentQrText, readPriceLabel, readScannedLabel, takePriceScan } from "@/lib/markets/guatemala-qr";
import {
  addPricedPiece,
  applySkuLessSale,
  removePricedPiece,
  skuLessCharge,
  type SkuLessBook,
} from "@/lib/markets/guatemala-skuless";

function book(): SkuLessBook {
  return { sales: [], pieces: 0, recoveredGtq: "0.00", inventoryCount: 12 };
}

describe("venta sin SKU de Tienda Guatemala", () => {
  it("registra 5 piezas por Q50 una sola vez, sin lote y sin descontar inventario", () => {
    const original = book();
    const sold = applySkuLessSale(original, { requestId: "venta-sin-sku", pieces: 5, chargedPrice: "50" });
    expect(sold.result).toEqual({ ok: true, chargedPriceGtq: "50.00", pieces: 5, already: false });
    expect(sold.book.sales).toEqual([
      { requestId: "venta-sin-sku", pieces: 5, chargedPriceGtq: "50.00", lotId: null },
    ]);
    expect(sold.book.pieces).toBe(5);
    expect(sold.book.recoveredGtq).toBe("50.00");
    expect(sold.book.inventoryCount).toBe(original.inventoryCount);

    const repeated = applySkuLessSale(sold.book, { requestId: "venta-sin-sku", pieces: 5, chargedPrice: "50" });
    expect(repeated.book).toBe(sold.book);
    expect(repeated.result).toMatchObject({ already: true, chargedPriceGtq: "50.00", pieces: 5 });
    expect(sold.book.sales).toHaveLength(1);
    expect(sold.book.recoveredGtq).toBe("50.00");
  });

  it("suma el monto una sola vez a la recuperación y no lo multiplica por las piezas", () => {
    const sold = applySkuLessSale(book(), { requestId: "una", pieces: "5", chargedPrice: "50" });
    const profit = summarizeGuatemalaProfit({
      includeTests: false,
      expenses: [],
      garments: [
        {
          itemId: "sin-sku",
          soldInPeriod: true,
          isTest: false,
          voided: false,
          chargedPriceGtq: sold.book.recoveredGtq,
          costGtq: null,
          costIncludesPhotography: false,
          tracksCost: false,
        },
      ],
    });
    expect(profit.salesTotalGtq).toBe("50.00");
    expect(profit.warnings.some((warning) => warning.includes("Falta el costo"))).toBe(false);
    expect(sold.book.recoveredGtq).not.toBe("250.00");
  });

  it("suma Q10, Q15 y Q20 en una venta de 3 piezas por Q45, sin lote ni existencias", () => {
    const ten = readPriceLabel("VSAP:10");
    const fifteen = readPriceLabel(" Q15 ");
    const twenty = readPriceLabel("VSAP:20.00");
    expect(ten.ok && fifteen.ok && twenty.ok).toBe(true);
    if (!ten.ok || !fifteen.ok || !twenty.ok) return;
    let lines = addPricedPiece([], ten.priceGtq);
    lines = addPricedPiece(lines, fifteen.priceGtq);
    lines = addPricedPiece(lines, twenty.priceGtq);
    expect(lines).toEqual([
      { priceGtq: "10.00", pieces: 1 },
      { priceGtq: "15.00", pieces: 1 },
      { priceGtq: "20.00", pieces: 1 },
    ]);
    const charge = skuLessCharge({ lines, manualPieces: "1", manualTotal: "" });
    expect(charge).toEqual({ ok: true, pieces: 3, chargedPriceGtq: "45.00" });

    const original = book();
    const sold = applySkuLessSale(original, {
      requestId: "precios",
      pieces: charge.ok ? charge.pieces : 0,
      chargedPrice: charge.ok ? charge.chargedPriceGtq : "",
    });
    expect(sold.book.sales).toEqual([{ requestId: "precios", pieces: 3, chargedPriceGtq: "45.00", lotId: null }]);
    expect(sold.book.pieces).toBe(3);
    expect(sold.book.recoveredGtq).toBe("45.00");
    expect(sold.book.inventoryCount).toBe(original.inventoryCount);
    const repeated = applySkuLessSale(sold.book, { requestId: "precios", pieces: 3, chargedPrice: "45.00" });
    expect(repeated.book).toBe(sold.book);
    expect(sold.book.recoveredGtq).toBe("45.00");
  });

  it("repite el mismo precio, quita una pieza y conserva la entrada manual", () => {
    const price = readPriceLabel("VSAP:10");
    if (!price.ok) throw new Error(price.error);
    const twice = addPricedPiece(addPricedPiece([], price.priceGtq), price.priceGtq);
    expect(twice).toEqual([{ priceGtq: "10.00", pieces: 2 }]);
    expect(removePricedPiece(twice, "10.00")).toEqual([{ priceGtq: "10.00", pieces: 1 }]);
    expect(removePricedPiece([{ priceGtq: "10.00", pieces: 1 }], "10.00")).toEqual([]);

    const manual = skuLessCharge({ lines: [], manualPieces: "4", manualTotal: "30" });
    expect(manual).toEqual({ ok: true, pieces: 4, chargedPriceGtq: "30.00" });
    const mixed = skuLessCharge({ lines: twice, manualPieces: "2", manualTotal: "8" });
    expect(mixed).toEqual({ ok: true, pieces: 4, chargedPriceGtq: "28.00" });

    const garment = "550e8400-e29b-41d4-a716-446655440000";
    expect(readPriceLabel(garmentQrText(garment)).error).toBe(PRICE_QR_MESSAGES.garmentOnPrice);
    expect(readPriceLabel("L1-0001").error).toBe(PRICE_QR_MESSAGES.garmentOnPrice);
    expect(readScannedLabel("VSAP:10")).toMatchObject({ ok: false, error: PRICE_QR_MESSAGES.notGarment });
    expect(readScannedLabel("Q20")).toMatchObject({ ok: false, error: PRICE_QR_MESSAGES.notGarment });
    expect(readScannedLabel("L1-0001")).toEqual({ ok: true, kind: "sku", sku: "L1-0001" });

    const first = takePriceScan(null, "VSAP:10", 0);
    const held = takePriceScan(first.memory, "VSAP:10", 400);
    const nextGarment = takePriceScan(held.memory, "VSAP:10", 1300);
    const otherPrice = takePriceScan(nextGarment.memory, "Q15", 1310);
    expect(first.priceGtq).toBe("10.00");
    expect(held.priceGtq).toBeNull();
    expect(nextGarment.priceGtq).toBe("10.00");
    expect(otherPrice.priceGtq).toBe("15.00");

    const form = readFileSync("app/guatemala/inventario/quantity.tsx", "utf8");
    const scanner = readFileSync("app/guatemala/inventario/price-qr.tsx", "utf8");
    expect(scanner).toContain("Escanear QR de precio");
    expect(scanner).toContain("Quitar pieza");
    expect(scanner).toContain("Total a cobrar");
    expect(form).toContain("Piezas vendidas");
    expect(form).toContain("Total cobrado");
    expect(form).toContain('request("/api/markets/guatemala/skuless-sales"');
    expect(form.match(/skuless-sales/g)).toHaveLength(1);
  });
});
