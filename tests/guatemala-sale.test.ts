import { describe, expect, it } from "vitest";
import { formatGuatemalaMoment } from "@/lib/markets/guatemala";
import {
  applyGuatemalaSale,
  GUATEMALA_SALE_MESSAGES,
  type SaleBook,
} from "@/lib/markets/guatemala-inventory";

const photo = { id: "photo-1", mediaType: "image/jpeg", data: "foto-prueba" };
const soldAt = new Date("2026-10-17T18:00:00.000Z");

function book(): SaleBook {
  return {
    items: [
      {
        id: "playera-real",
        clientId: "tienda",
        sku: "3001",
        priceGtq: "40.00",
        status: "disponible",
        photos: [photo],
      },
      {
        id: "prenda-prueba",
        clientId: "tienda",
        sku: "prueba-q15",
        priceGtq: "30.00",
        status: "disponible",
        photos: [photo],
      },
      {
        id: "otra-prenda",
        clientId: "tienda",
        sku: "prueba-q20",
        priceGtq: "20.00",
        status: "disponible",
        photos: [photo],
      },
    ],
    sales: [],
  };
}

describe("venta de Tienda Guatemala", () => {
  it("guarda Q15 cobrados y Q30 publicados, descuenta una prenda y rechaza otra venta", () => {
    const original = book();
    const first = applyGuatemalaSale(original, {
      clientId: "tienda",
      itemId: "prenda-prueba",
      chargedPrice: "15",
      clientAllowed: true,
      now: soldAt,
    });
    expect(first.result).toMatchObject({
      ok: true,
      available: 2,
      sale: {
        sku: "prueba-q15",
        publishedPriceGtq: "30.00",
        chargedPriceGtq: "15.00",
      },
    });

    const reloaded = first.book;
    const sold = reloaded.items.find((item) => item.sku === "prueba-q15");
    const untouched = reloaded.items.find((item) => item.sku === "3001");
    expect(sold?.status).toBe("vendida");
    expect(sold?.priceGtq).toBe("30.00");
    expect(sold?.sku).toBe("prueba-q15");
    expect(sold?.photos).toEqual([photo]);
    expect(reloaded.sales).toHaveLength(1);
    expect(reloaded.sales[0]?.publishedPriceGtq).toBe("30.00");
    expect(reloaded.sales[0]?.chargedPriceGtq).toBe("15.00");
    expect(formatGuatemalaMoment(reloaded.sales[0]?.soldAt ?? "")).toContain("12:00");
    expect(untouched?.status).toBe("disponible");
    expect(reloaded.sales.some((sale) => sale.sku === "3001")).toBe(false);

    const second = applyGuatemalaSale(reloaded, {
      clientId: "tienda",
      itemId: "prenda-prueba",
      chargedPrice: "10.00",
      clientAllowed: true,
      now: soldAt,
    });
    expect(second.book).toBe(reloaded);
    expect(second.result).toMatchObject({
      ok: false,
      status: 409,
      error: GUATEMALA_SALE_MESSAGES.alreadySold,
    });
    expect(reloaded.sales).toHaveLength(1);
    expect(reloaded.sales[0]?.chargedPriceGtq).toBe("15.00");
    expect(reloaded.items.filter((item) => item.status === "disponible")).toHaveLength(2);
  });

  it("no deja una venta incompleta si el precio o el cliente no son válidos", () => {
    const original = book();
    const invalid = applyGuatemalaSale(original, {
      clientId: "tienda",
      itemId: "prenda-prueba",
      chargedPrice: "0",
      clientAllowed: true,
    });
    const foreign = applyGuatemalaSale(original, {
      clientId: "otro",
      itemId: "prenda-prueba",
      chargedPrice: "15.00",
      clientAllowed: false,
    });
    expect(invalid.book).toBe(original);
    expect(foreign.book).toBe(original);
    expect(original.sales).toHaveLength(0);
    expect(original.items.every((item) => item.status === "disponible")).toBe(true);
  });
});
