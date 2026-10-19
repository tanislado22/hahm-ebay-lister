import { describe, expect, it } from "vitest";
import {
  catalogClearSearch,
  catalogEmptyMessage,
  catalogFilterChips,
  catalogItemVisible,
  catalogOrderAllowed,
  catalogPageSearch,
  publicCatalogCards,
  publicCatalogDetail,
  publicSoldArticleCount,
  PUBLIC_SOLD_NOTICE,
  type CatalogSourceItem,
} from "@/lib/markets/guatemala-catalog";

const TIENDA = "0d605a78-f474-49d8-a235-cca831d694be";
const OTHER = "e5e689b6-563d-4c99-8a39-e82686f6c9b8";
const photo = { id: "foto-1", mediaType: "image/jpeg", data: "foto" };

function item(partial: Partial<CatalogSourceItem> = {}): CatalogSourceItem {
  return {
    id: "prenda-nueva",
    clientId: TIENDA,
    sku: "4100",
    title: "Camisa azul",
    description: "Algodón.",
    brand: "Arrow",
    size: "M",
    condition: "NEW_WITH_TAGS",
    priceGtq: "40.00",
    status: "disponible",
    photos: [photo],
    sales: [],
    ...partial,
  };
}

describe("catálogo público de Tienda Guatemala", () => {
  const shirt3001 = item({
    id: "prenda-3001",
    sku: "3001",
    title: "Camisa 3001",
    priceGtq: "40.00",
    sales: [],
  });
  const shirt3002 = item({
    id: "prenda-3002",
    sku: "3002",
    title: "Camisa 3002",
    priceGtq: "30.00",
    status: "vendida",
    sales: [{ isTest: true, voidedAt: null }],
  });
  const prueba1 = item({
    id: "prenda-prueba1",
    sku: "prueba1",
    title: "Prenda de prueba",
    priceGtq: "40.00",
    status: "vendida",
    sales: [{ isTest: true, voidedAt: null }],
  });
  const returned = item({
    id: "prenda-devuelta",
    sku: "4200",
    title: "Pantalón devuelto",
    priceGtq: "55.00",
    sales: [{ isTest: false, voidedAt: "2026-10-17T16:00:00.000Z" }],
  });
  const returnedTest = item({
    id: "prenda-prueba-devuelta",
    sku: "prueba-devuelta",
    title: "Prueba anulada",
    sales: [{ isTest: true, voidedAt: "2026-10-17T16:00:00.000Z" }],
  });
  const otherStore = item({
    id: "prenda-ajena",
    clientId: OTHER,
    sku: "3001",
    title: "Camisa de otra tienda",
  });
  const sold = item({
    id: "prenda-vendida",
    sku: "4300",
    title: "Chaqueta vendida",
    priceGtq: "70.00",
    status: "vendida",
    sales: [{ isTest: false, voidedAt: null }],
  });
  const withdrawn = item({
    id: "prenda-retirada",
    sku: "4400",
    title: "Prenda retirada",
    status: "retirada",
  });
  const book = [sold, shirt3001, shirt3002, prueba1, returned, returnedTest, otherStore, withdrawn];

  it("muestra solo prendas disponibles de Tienda Guatemala y omite ventas, pruebas y otras tiendas", () => {
    const cards = publicCatalogCards(book, TIENDA, "");
    expect(cards.map((card) => card.sku)).toEqual(["3001", "4200", "prueba-devuelta", "4300"]);
    expect(cards.map((card) => card.availability)).toEqual(["disponible", "disponible", "disponible", "vendido"]);
    expect(publicSoldArticleCount(book, TIENDA)).toBe(1);
    expect(shirt3001).toBe(book[1]);
    expect(shirt3002).toBe(book[2]);
    expect(prueba1).toBe(book[3]);
    expect(cards[0]).toEqual({
      id: "prenda-3001",
      sku: "3001",
      title: "Camisa 3001",
      brand: "Arrow",
      size: "M",
      priceGtq: "40.00",
      category: "camisa",
      categoryLabel: "camisa",
      coverPhotoId: "foto-1",
      availability: "disponible",
      soldBadge: "",
    });
    expect(JSON.stringify(cards)).not.toMatch(/charged|clientId|soldBy|corrections|voided|username|password|isTest|costGtq|"data"/i);
    expect(catalogItemVisible(returnedTest, TIENDA)).toBe(true);
    expect(catalogOrderAllowed(returnedTest, TIENDA)).toBe(true);
    expect(catalogItemVisible(otherStore, TIENDA)).toBe(false);
  });

  it("busca por título o SKU y abre el detalle sin el historial", () => {
    expect(publicCatalogCards(book, TIENDA, "pantalón").map((card) => card.sku)).toEqual(["4200"]);
    expect(publicCatalogCards(book, TIENDA, "3001").map((card) => card.id)).toEqual(["prenda-3001"]);
    expect(publicCatalogCards(book, TIENDA, "Camisa de otra tienda")).toEqual([]);
    expect(publicCatalogCards(book, TIENDA, "prueba1")).toEqual([]);

    const detail = publicCatalogDetail(book, TIENDA, "prenda-devuelta");
    expect(detail).toEqual({
      id: "prenda-devuelta",
      sku: "4200",
      title: "Pantalón devuelto",
      description: "Algodón.",
      brand: "Arrow",
      size: "M",
      conditionLabel: "Nueva con etiqueta",
      priceGtq: "55.00",
      category: "pantalon",
      categoryLabel: "pantalón",
      photoIds: ["foto-1"],
      availability: "disponible",
      soldNotice: "",
    });
    expect(publicCatalogDetail(book, TIENDA, "prenda-3002")).toBeNull();
    expect(publicCatalogDetail(book, TIENDA, "prenda-prueba1")).toBeNull();
    expect(publicCatalogDetail(book, TIENDA, "prenda-ajena")).toBeNull();
    expect(publicCatalogDetail(book, OTHER, "prenda-3001")).toBeNull();
    expect(catalogEmptyMessage("")).toBe("Estamos preparando nuestra colección. Vuelve pronto.");
    expect(catalogEmptyMessage({ q: "", category: "", size: "", brand: "", minPrice: null, maxPrice: null, availability: "disponibles" })).toBe("Todavía no hay prendas disponibles.");
    expect(catalogEmptyMessage({ q: "", category: "", size: "", brand: "", minPrice: null, maxPrice: null, availability: "vendidos" })).toBe("Todavía no hay artículos vendidos.");
    expect(catalogEmptyMessage("xyz")).toBe("Ninguna prenda coincide con la búsqueda.");
    expect(JSON.stringify(detail)).not.toMatch(/clientId|costGtq|charged|soldBy|"data"/i);
  });

  it("filtra por categoría, talla, marca y precio sin mezclar una polo con una camisa", () => {
    const polo = item({
      id: "polo",
      sku: "3001",
      title: "Playera tipo polo PJ Paul Jones",
      brand: "PJ Paul Jones",
      size: "2XL",
      priceGtq: "95.00",
    });
    const shirt = item({ id: "camisa", sku: "4100", title: "Camisa azul", brand: "Arrow", size: "M", priceGtq: "40.00" });
    const stock = [polo, shirt];
    const filters = { q: "", category: "", size: "", brand: "", minPrice: null, maxPrice: null, availability: "todos" as const };
    expect(publicCatalogCards(stock, TIENDA, { ...filters, category: "polo" }).map((card) => card.sku)).toEqual(["3001"]);
    expect(publicCatalogCards(stock, TIENDA, { ...filters, size: "2XL" }).map((card) => card.sku)).toEqual(["3001"]);
    expect(publicCatalogCards(stock, TIENDA, { ...filters, brand: "Arrow" }).map((card) => card.sku)).toEqual(["4100"]);
    expect(publicCatalogCards(stock, TIENDA, { ...filters, minPrice: 90, maxPrice: 100 }).map((card) => card.sku)).toEqual(["3001"]);
    expect(publicCatalogCards(stock, TIENDA, { ...filters, q: "paul" }).map((card) => card.sku)).toEqual(["3001"]);
  });

  it("refleja publicar, cambiar el precio y retirar una prenda de prueba", () => {
    const published = item({ id: "aislada", sku: "prueba-tienda", title: "Polo de prueba", brand: "Marca Prueba", priceGtq: "10.00" });
    expect(publicCatalogCards([published], TIENDA, "").map((card) => card.priceGtq)).toEqual(["10.00"]);
    expect(publicCatalogCards([{ ...published, priceGtq: "12.50" }], TIENDA, "")[0]?.priceGtq).toBe("12.50");
    expect(publicCatalogCards([{ ...published, status: "vendida" }], TIENDA, "")).toEqual([]);
    expect(publicCatalogCards([{ ...published, sales: [{ isTest: false, voidedAt: null }] }], TIENDA, "")).toEqual([]);
    expect(publicCatalogDetail([{ ...published, status: "vendida" }], TIENDA, "aislada")).toBeNull();
    expect(publicCatalogCards([{ ...published, status: "retirada" }], TIENDA, "")).toEqual([]);
    expect(publicCatalogDetail([{ ...published, status: "retirada" }], TIENDA, "aislada")).toBeNull();
  });

  it("muestra una venta real como vendida, sin compra, y la vuelve a ofrecer si se anula", () => {
    const available = item({ id: "lista", sku: "4500", title: "Polo listo" });
    const confirmed = item({
      id: "lista",
      sku: "4500",
      title: "Polo listo",
      status: "vendida",
      sales: [{ isTest: false, voidedAt: null }],
    });
    const cards = publicCatalogCards([confirmed, available], TIENDA, "");
    expect(cards.map((card) => card.sku)).toEqual(["4500", "4500"]);
    expect(cards.map((card) => card.availability)).toEqual(["disponible", "vendido"]);
    expect(cards[1]?.soldBadge).toBe("VENDIDO");
    expect(cards[1]?.coverPhotoId).toBe("foto-1");
    const detail = publicCatalogDetail([confirmed], TIENDA, "lista");
    expect(detail?.soldNotice).toBe(PUBLIC_SOLD_NOTICE);
    expect(detail?.photoIds).toEqual(["foto-1"]);
    expect(catalogOrderAllowed(confirmed, TIENDA)).toBe(false);
    expect(catalogOrderAllowed(available, TIENDA)).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/charged|soldBy|username|costGtq|clientId|comprador/i);
    expect(publicSoldArticleCount([confirmed, available], TIENDA)).toBe(1);

    const voided = item({
      id: "lista",
      sku: "4500",
      status: "disponible",
      sales: [{ isTest: false, voidedAt: "2026-10-18T20:00:00.000Z" }],
    });
    expect(publicCatalogCards([voided], TIENDA, "")[0]?.availability).toBe("disponible");
    expect(catalogOrderAllowed(voided, TIENDA)).toBe(true);
    expect(publicSoldArticleCount([voided], TIENDA)).toBe(0);
    expect(publicCatalogCards([confirmed], TIENDA, { q: "", category: "", size: "", brand: "", minPrice: null, maxPrice: null, availability: "vendidos" })).toHaveLength(1);
    expect(publicCatalogCards([confirmed, available], TIENDA, { q: "", category: "", size: "", brand: "", minPrice: null, maxPrice: null, availability: "disponibles" }).every((card) => card.availability === "disponible")).toBe(true);
    const selected = { q: "polo", category: "camisa", size: "M", brand: "Arrow", minPrice: 40, maxPrice: 100, availability: "disponibles" as const };
    const chips = catalogFilterChips(selected);
    expect(chips.map((chip) => chip.label)).toEqual(["polo", "camisa", "Talla M", "Arrow", "Desde Q40", "Hasta Q100"]);
    expect(chips.find((chip) => chip.id === "categoria")?.search).toContain("estado=disponibles");
    expect(chips.find((chip) => chip.id === "categoria")?.search).not.toContain("categoria=");
    expect(catalogClearSearch(selected)).toBe("estado=disponibles");
    expect(catalogPageSearch({ q: "polo", category: "", size: "", brand: "", minPrice: null, maxPrice: null, availability: "todos" })).toBe("q=polo");
    expect(catalogPageSearch({ q: "", category: "", size: "", brand: "", minPrice: null, maxPrice: null, availability: "vendidos" })).toBe("estado=vendidos");
    expect(publicCatalogCards([item({ clientId: OTHER, status: "vendida", sales: [{ isTest: false, voidedAt: null }] })], TIENDA, "")).toEqual([]);
  });
});
