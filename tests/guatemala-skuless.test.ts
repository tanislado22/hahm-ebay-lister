import { describe, expect, it } from "vitest";
import { summarizeGuatemalaProfit } from "@/lib/markets/guatemala-expenses";
import { applySkuLessSale, type SkuLessBook } from "@/lib/markets/guatemala-skuless";

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
});
