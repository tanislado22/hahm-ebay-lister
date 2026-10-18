import { describe, expect, it } from "vitest";
import {
  catalogEmptyMessage,
  catalogItemVisible,
  publicCatalogCards,
  publicCatalogDetail,
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
  const book = [shirt3001, shirt3002, prueba1, returned, returnedTest, otherStore];

  it("muestra solo prendas disponibles de Tienda Guatemala y omite ventas, pruebas y otras tiendas", () => {
    const cards = publicCatalogCards(book, TIENDA, "");
    expect(cards.map((card) => card.sku)).toEqual(["3001", "4200"]);
    expect(shirt3001).toBe(book[0]);
    expect(shirt3002).toBe(book[1]);
    expect(prueba1).toBe(book[2]);
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
    });
    expect(JSON.stringify(cards)).not.toMatch(/charged|clientId|soldBy|corrections|voided|username|password|isTest|costGtq|"data"/i);
    expect(catalogItemVisible(returnedTest, TIENDA)).toBe(false);
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
    });
    expect(publicCatalogDetail(book, TIENDA, "prenda-3002")).toBeNull();
    expect(publicCatalogDetail(book, TIENDA, "prenda-prueba1")).toBeNull();
    expect(publicCatalogDetail(book, TIENDA, "prenda-ajena")).toBeNull();
    expect(publicCatalogDetail(book, OTHER, "prenda-3001")).toBeNull();
    expect(catalogEmptyMessage("")).toBe("Todavía no hay prendas disponibles.");
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
    expect(publicCatalogCards(stock, TIENDA, { q: "", category: "polo", size: "", brand: "", minPrice: null, maxPrice: null }).map((card) => card.sku)).toEqual(["3001"]);
    expect(publicCatalogCards(stock, TIENDA, { q: "", category: "", size: "2XL", brand: "", minPrice: null, maxPrice: null }).map((card) => card.sku)).toEqual(["3001"]);
    expect(publicCatalogCards(stock, TIENDA, { q: "", category: "", size: "", brand: "Arrow", minPrice: null, maxPrice: null }).map((card) => card.sku)).toEqual(["4100"]);
    expect(publicCatalogCards(stock, TIENDA, { q: "", category: "", size: "", brand: "", minPrice: 90, maxPrice: 100 }).map((card) => card.sku)).toEqual(["3001"]);
    expect(publicCatalogCards(stock, TIENDA, { q: "paul", category: "", size: "", brand: "", minPrice: null, maxPrice: null }).map((card) => card.sku)).toEqual(["3001"]);
  });

  it("refleja publicar, cambiar el precio y retirar una prenda de prueba", () => {
    const published = item({ id: "aislada", sku: "prueba-tienda", title: "Polo de prueba", brand: "Marca Prueba", priceGtq: "10.00" });
    expect(publicCatalogCards([published], TIENDA, "").map((card) => card.priceGtq)).toEqual(["10.00"]);
    expect(publicCatalogCards([{ ...published, priceGtq: "12.50" }], TIENDA, "")[0]?.priceGtq).toBe("12.50");
    expect(publicCatalogCards([{ ...published, status: "vendida" }], TIENDA, "")).toEqual([]);
    expect(publicCatalogCards([{ ...published, sales: [{ isTest: false, voidedAt: null }] }], TIENDA, "")).toEqual([]);
    expect(publicCatalogDetail([{ ...published, status: "vendida" }], TIENDA, "aislada")).toBeNull();
  });
});
