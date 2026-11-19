import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyQuantityCheckout, type QuantityBook } from "@/lib/markets/guatemala-quantity";
import {
  QR_MESSAGES,
  SALE_SCAN_MESSAGES,
  addGarmentToSale,
  takeGarmentScan,
  type SaleScanItem,
} from "@/lib/markets/guatemala-qr";

function garment(id: string, sku: string, status = "disponible"): SaleScanItem {
  return { id, sku, title: `Prenda ${sku}`, lotLabel: "Lote 1 · Pacas", status };
}

function book(items: SaleScanItem[]): QuantityBook {
  return {
    groups: [],
    items: items.map((item) => ({ id: item.id, sku: item.sku, status: "disponible", lotId: "lote-1" })),
    checkouts: [],
    lotSellable: { "lote-1": 10 },
  };
}

describe("escaneo para vender en Tienda Guatemala", () => {
  it("abre la cámara desde la pantalla principal y deja el registro manual", () => {
    const layout = readFileSync("app/guatemala/panel/layout.tsx", "utf8");
    expect(layout).toContain("Escanear para vender");
    expect(layout).toContain('href="/guatemala/panel/inventario?accion=escanear"');
    expect(layout).toContain('href="/guatemala/panel/inventario?accion=venta"');
    expect(layout).not.toContain(">Escanear QR<");
    const scanPage = readFileSync("app/guatemala/panel/escanear/page.tsx", "utf8");
    expect(scanPage).toContain('redirect("/guatemala/panel/inventario?accion=escanear")');
    const screen = readFileSync("app/guatemala/inventario/screen.tsx", "utf8");
    expect(screen).toContain('startCamera={launch === "escanear"}');
    const panel = readFileSync("app/guatemala/inventario/quantity.tsx", "utf8");
    expect(panel).toContain("Escanear otra prenda");
    expect(panel).toContain("addGarmentToSale");
    expect(panel.indexOf("lookupScanned")).toBeLessThan(panel.indexOf('"/api/markets/guatemala/quantity-sales"'));
    const scanner = readFileSync("app/guatemala/inventario/sale-scan.tsx", "utf8");
    expect(scanner).not.toContain("quantity-sales");
    expect(scanner).not.toContain("/sale");
  });

  it("suma una prenda disponible y no la vende hasta el cobro", () => {
    const item = garment("a", "3001");
    const added = addGarmentToSale([], item);
    expect(added).toEqual({ items: [item], added: true, notice: "" });
    const original = book(added.items);
    expect(original.items[0]?.status).toBe("disponible");
    expect(original.checkouts).toHaveLength(0);

    const sold = applyQuantityCheckout(original, {
      requestId: "venta-una",
      chargedPrice: "40",
      pieceLines: [],
      itemIds: added.items.map((line) => line.id),
    });
    expect(sold.result).toEqual({ ok: true, chargedPriceGtq: "40.00", already: false });
    expect(sold.book.checkouts).toEqual([
      { requestId: "venta-una", chargedPriceGtq: "40.00", pieces: [], itemIds: ["a"] },
    ]);
    expect(sold.book.items[0]?.status).toBe("vendida");
  });

  it("junta tres prendas en un solo cobro, ignora el SKU repetido y avisa si ya está vendida", () => {
    let items: SaleScanItem[] = [];
    for (const [id, sku] of [
      ["a", "3001"],
      ["b", "3002"],
      ["c", "3003"],
    ] as const) {
      const next = addGarmentToSale(items, garment(id, sku));
      expect(next.added).toBe(true);
      expect(next.notice).toBe("");
      items = next.items;
    }
    expect(items.map((item) => item.sku)).toEqual(["3001", "3002", "3003"]);

    const repeated = addGarmentToSale(items, garment("d", "3002"));
    expect(repeated.added).toBe(false);
    expect(repeated.notice).toBe(SALE_SCAN_MESSAGES.duplicate);
    expect(repeated.items.map((item) => item.id)).toEqual(["a", "b", "c"]);

    const sameGarment = addGarmentToSale(items, garment("a", "9999"));
    expect(sameGarment.added).toBe(false);
    expect(sameGarment.items).toHaveLength(3);

    const alreadySold = addGarmentToSale(items, garment("e", "3004", "vendida"));
    expect(alreadySold.added).toBe(false);
    expect(alreadySold.notice).toBe(QR_MESSAGES.sold);
    expect(alreadySold.items.map((item) => item.sku)).toEqual(["3001", "3002", "3003"]);

    const missing = takeGarmentScan(null, "   ");
    expect(missing.text).toBeNull();
    const first = takeGarmentScan(null, "  VSA1:prenda  ");
    const held = takeGarmentScan(first.memory, "VSA1:prenda");
    const another = takeGarmentScan(held.memory, "3005");
    expect(first.text).toBe("VSA1:prenda");
    expect(held.text).toBeNull();
    expect(another.text).toBe("3005");

    const original = book(items);
    const charged = applyQuantityCheckout(original, {
      requestId: "venta-tres",
      chargedPrice: "90",
      pieceLines: [],
      itemIds: items.map((item) => item.id),
    });
    expect(charged.book.checkouts).toHaveLength(1);
    expect(charged.book.checkouts[0]).toMatchObject({
      chargedPriceGtq: "90.00",
      itemIds: ["a", "b", "c"],
    });
    expect(charged.book.items.map((item) => item.status)).toEqual(["vendida", "vendida", "vendida"]);
    expect(original.checkouts).toHaveLength(0);
  });
});
