import { describe, expect, it } from "vitest";
import { applyGuatemalaSale } from "@/lib/markets/guatemala-inventory";
import {
  applyQuantityCheckout,
  applyQuantityGroup,
  groupAvailable,
  lotSoldPieces,
  prepareQuantityCheckout,
  quantityStockMessage,
  type QuantityBook,
} from "@/lib/markets/guatemala-quantity";

const lot = "lote-1";
const otherLot = "lote-2";

function book(): QuantityBook {
  return {
    groups: [],
    items: [
      { id: "playera", sku: "3001", status: "disponible", lotId: lot },
    ],
    checkouts: [],
    lotSellable: { [lot]: 100, [otherLot]: 80 },
  };
}

describe("venta por cantidad de Tienda Guatemala", () => {
  it("asigna 100 piezas al lote sin volver a sumarlas y deja otra grupo en el lote 2", () => {
    const original = book();
    const first = applyQuantityGroup(original, {
      id: "bebe-1",
      name: "Ropa de bebé · Lote 1",
      lotId: lot,
      quantity: 100,
    });
    const second = applyQuantityGroup(first.book, {
      id: "bebe-2",
      name: "Ropa de bebé · Lote 2",
      lotId: otherLot,
      quantity: 40,
    });
    expect(first.result).toEqual({ ok: true, lotPieceDelta: 0 });
    expect(second.book.lotSellable).toEqual(original.lotSellable);
    expect(second.book.groups.map((group) => [group.name, group.lotId, groupAvailable(group)])).toEqual([
      ["Ropa de bebé · Lote 1", lot, 100],
      ["Ropa de bebé · Lote 2", otherLot, 40],
    ]);
    expect(second.book.items).toEqual(original.items);
  });

  it("vende 5 piezas por Q50 una sola vez, deja 95 y suma 5 vendidas al lote", () => {
    const created = applyQuantityGroup(book(), {
      id: "bebe-1",
      name: "Ropa de bebé · Lote 1",
      lotId: lot,
      quantity: 100,
    });
    const sold = applyQuantityCheckout(created.book, {
      requestId: "venta-1",
      chargedPrice: "50",
      pieceLines: [{ groupId: "bebe-1", quantity: 5 }],
      itemIds: [],
    });
    const group = sold.book.groups[0];
    expect(sold.result).toEqual({ ok: true, chargedPriceGtq: "50.00", already: false });
    expect(group && groupAvailable(group)).toBe(95);
    expect(lotSoldPieces(sold.book, lot)).toBe(5);
    expect(sold.book.checkouts).toEqual([
      { requestId: "venta-1", chargedPriceGtq: "50.00", pieces: [{ groupId: "bebe-1", quantity: 5 }], itemIds: [] },
    ]);
    expect(sold.book.lotSellable[lot]).toBe(100);
    expect(sold.book.items[0]?.status).toBe("disponible");

    const repeated = applyQuantityCheckout(sold.book, {
      requestId: "venta-1",
      chargedPrice: "50",
      pieceLines: [{ groupId: "bebe-1", quantity: 5 }],
      itemIds: [],
    });
    expect(repeated.book).toBe(sold.book);
    expect(repeated.result).toEqual({ ok: true, chargedPriceGtq: "50.00", already: true });
    expect(group && groupAvailable(group)).toBe(95);
    expect(sold.book.checkouts).toHaveLength(1);
  });

  it("bloquea una cantidad mayor a las existencias y no descuenta", () => {
    const created = applyQuantityGroup(book(), {
      id: "bebe-1",
      name: "Ropa de bebé · Lote 1",
      lotId: lot,
      quantity: 100,
    });
    const blocked = applyQuantityCheckout(created.book, {
      requestId: "venta-grande",
      chargedPrice: "50",
      pieceLines: [{ groupId: "bebe-1", quantity: 101 }],
      itemIds: [],
    });
    expect(blocked.book).toBe(created.book);
    expect(blocked.result).toEqual({
      ok: false,
      error: quantityStockMessage("Ropa de bebé · Lote 1", 100),
    });
    expect(created.book.checkouts).toHaveLength(0);
  });

  it("cobra grupos y la prenda exacta en una sola venta", () => {
    const created = applyQuantityGroup(book(), {
      id: "bebe-1",
      name: "Ropa de bebé · Lote 1",
      lotId: lot,
      quantity: 100,
    });
    const sold = applyQuantityCheckout(created.book, {
      requestId: "venta-mixta",
      chargedPrice: "50",
      pieceLines: [{ groupId: "bebe-1", quantity: 5 }],
      itemIds: ["playera"],
    });
    expect(sold.book.checkouts).toHaveLength(1);
    expect(sold.book.checkouts[0]?.chargedPriceGtq).toBe("50.00");
    expect(sold.book.items.find((item) => item.sku === "3001")?.status).toBe("vendida");
    expect(groupAvailable(sold.book.groups[0]!)).toBe(95);
    expect(lotSoldPieces(sold.book, lot)).toBe(6);

    const again = applyGuatemalaSale(
      {
        items: [{ id: "playera", clientId: "tienda", sku: "3001", priceGtq: "40.00", status: "vendida", photos: [] }],
        sales: [],
      },
      { clientId: "tienda", itemId: "playera", chargedPrice: "40", clientAllowed: true }
    );
    expect(again.result).toMatchObject({ ok: false, status: 409 });
  });

  it("no elige un grupo cuando hay dos con el mismo nombre", () => {
    const created = applyQuantityGroup(
      applyQuantityGroup(book(), { id: "bebe-1", name: "Ropa de bebé", lotId: lot, quantity: 10 }).book,
      { id: "bebe-2", name: "Ropa de bebé", lotId: otherLot, quantity: 8 }
    );
    const ambiguous = prepareQuantityCheckout({
      groups: created.book.groups,
      pieceLines: [],
      items: created.book.items,
      itemIds: [],
      chargedPrice: "50",
      requestId: "venta",
    });
    expect(ambiguous.ok).toBe(false);
    expect(created.book.groups).toHaveLength(2);
  });
});
