import { describe, expect, it } from "vitest";
import {
  addPublicCartLine,
  cartActionChangesInventory,
  cartIdsFromRequest,
  cartOrderWhatsappUrl,
  publicCartQuoteView,
  publicCartTotal,
  readStoredCart,
  removePublicCartLine,
  reviewPublicCart,
  type PublicCartLine,
} from "@/lib/markets/guatemala-cart";
import type { CatalogSourceItem } from "@/lib/markets/guatemala-catalog";

const shirt: PublicCartLine = {
  id: "prenda-1",
  sku: "001-2",
  title: "Camisa",
  size: "M",
  priceGtq: "40.00",
  coverPhotoId: "foto-1",
};

function source(patch: Partial<CatalogSourceItem>): CatalogSourceItem {
  return {
    id: "prenda-1",
    clientId: "tienda",
    sku: "001-2",
    title: "Camisa",
    description: "",
    brand: "",
    size: "M",
    condition: "",
    priceGtq: "40.00",
    status: "disponible",
    photos: [{ id: "foto-1", mediaType: "image/jpeg", data: "" }],
    sales: [],
    published: true,
    ...patch,
  };
}

describe("carrito del catálogo público", () => {
  it("agrega una sola unidad y no duplica la prenda", () => {
    const first = addPublicCartLine([], shirt);
    const second = addPublicCartLine(first.lines, shirt);
    expect(first.added).toBe(true);
    expect(first.lines).toHaveLength(1);
    expect(second.added).toBe(false);
    expect(second.lines).toEqual(first.lines);
    expect(second.message).toMatch(/ya está en el carrito/);
    expect(removePublicCartLine(first.lines, shirt.id)).toEqual([]);
    expect(publicCartTotal([shirt, { ...shirt, id: "prenda-2", sku: "002", priceGtq: "15.50" }])).toBe("55.50");
    expect(cartActionChangesInventory()).toBe(false);
  });

  it("conserva un carrito válido y descarta duplicados o datos rotos", () => {
    const raw = JSON.stringify([shirt, shirt, { id: "x", sku: "", priceGtq: "1" }]);
    expect(readStoredCart(raw)).toEqual([shirt]);
    expect(readStoredCart("no-json")).toEqual([]);
    expect(cartIdsFromRequest({ ids: [" prenda-1 ", "prenda-1", ""] })).toEqual(["prenda-1"]);
  });

  it("acepta solo prendas disponibles y publicadas", () => {
    expect(publicCartQuoteView(source({}), "tienda").available).toBe(true);
    expect(publicCartQuoteView(source({ published: false }), "tienda")).toEqual({ id: "prenda-1", available: false });
    expect(publicCartQuoteView(source({ status: "retirada" }), "tienda").available).toBe(false);
    expect(publicCartQuoteView(source({ status: "vendida", sales: [{ isTest: false, voidedAt: null }] }), "tienda").available).toBe(false);
  });

  it("avisa si una prenda se vendió o cambió de precio y no abre el pedido todavía", () => {
    const other: PublicCartLine = { ...shirt, id: "prenda-2", sku: "010", title: "Polo", priceGtq: "20.00" };
    const reviewed = reviewPublicCart([shirt, other], [
      { id: shirt.id, available: false },
      { id: other.id, available: true, sku: "010", title: "Polo", size: "", priceGtq: "25.00", coverPhotoId: null },
    ]);
    expect(reviewed.changed).toBe(true);
    expect(reviewed.lines).toEqual([{ ...other, size: "", priceGtq: "25.00", coverPhotoId: null }]);
    expect(reviewed.message).toMatch(/ya no está disponible/);
    expect(reviewed.message).toMatch(/precio/);
    expect(reviewed.message).toMatch(/Revisa el pedido/);

    const same = reviewPublicCart([shirt], [{
      id: shirt.id,
      available: true,
      sku: shirt.sku,
      title: shirt.title,
      size: shirt.size,
      priceGtq: shirt.priceGtq,
      coverPhotoId: shirt.coverPhotoId,
    }]);
    expect(same.changed).toBe(false);
    expect(same.lines).toEqual([shirt]);
  });

  it("arma el WhatsApp con nombre, SKU, precio, totales y enlace", () => {
    const url = cartOrderWhatsappUrl([shirt], "https://www.variedadessanandres.com", true);
    const text = new URL(url).searchParams.get("text") ?? "";
    expect(new URL(url).pathname).toBe("/50232672767");
    expect(text).toContain("Camisa");
    expect(text).toContain("SKU: 001-2");
    expect(text).toContain("Precio: Q40.00");
    expect(text).toContain("Productos: 1");
    expect(text).toContain("Total: Q40.00");
    expect(text).toContain("https://www.variedadessanandres.com/prenda/prenda-1");
    expect(text).toContain("costo de envío");
    expect(url).not.toContain("send=");
  });
});
