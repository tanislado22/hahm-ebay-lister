import { describe, expect, it } from "vitest";
import {
  buildGuatemalaCompReport,
  guatemalaPriceIfEmpty,
  listingIsRelevant,
  type CatalogListing,
  type GarmentQuery,
  type StoreSaleInput,
} from "@/lib/markets/guatemala-price-match";
import { parseEconopacaProducts, parseMegapacaBoost, parseMegapacaSuggest } from "@/lib/markets/guatemala-price-sources";

const query: GarmentQuery = {
  title: "Camisa azul Perry Ellis",
  itemType: "Camisa",
  brand: "Perry Ellis",
  condition: "NEW_WITH_TAGS",
  size: "M",
  category: "mens_top",
};

function ad(overrides: Partial<CatalogListing> = {}): CatalogListing {
  return {
    source: "megapaca",
    title: "Camisa M (PERRY ELLIS)",
    priceGtq: 158,
    url: "https://megapaca.store/products/uno",
    brand: "PERRY ELLIS",
    itemType: "Camisa",
    condition: "Nuevo con etiqueta",
    size: "M",
    audience: "Caballero",
    ...overrides,
  };
}

function sale(overrides: Partial<StoreSaleInput> = {}): StoreSaleInput {
  return {
    sku: "12.50",
    title: "Camisa azul Perry Ellis",
    brand: "Perry Ellis",
    size: "M",
    condition: "NEW_WITH_TAGS",
    priceGtq: 40,
    soldAt: "2026-10-01T18:00:00.000Z",
    ...overrides,
  };
}

describe("comparación de precios de Tienda Guatemala", () => {
  it("sugiere la mediana solo con anuncios suficientes y deja las ventas aparte", () => {
    const report = buildGuatemalaCompReport({
      now: new Date("2026-10-18T15:00:00.000Z"),
      query,
      advertised: [
        ad({ priceGtq: 150, url: "https://megapaca.store/products/a" }),
        ad({ priceGtq: 170, url: "https://megapaca.store/products/b" }),
        ad({
          source: "econopaca",
          priceGtq: 46,
          url: "https://store.econopaca.com/ProductDetail?id=1",
          brand: "Lands'end",
        }),
        ad({
          source: "econopaca",
          priceGtq: 39,
          url: "https://store.econopaca.com/ProductDetail?id=2",
          title: "Camisa Perry Ellis",
          brand: "Perry Ellis",
        }),
      ],
      sourceErrors: [],
      sales: [sale({ priceGtq: 10 }), sale({ priceGtq: 12 }), sale({ priceGtq: 14, sku: "12.52" })],
    });
    expect(report.status).toBe("ready");
    expect(report.suggestedPrice).toBe(150);
    expect(report.advertised).toMatchObject({ count: 3, low: 39, high: 170, median: 150 });
    expect(report.storeSales).toMatchObject({ count: 3, low: 10, high: 14, median: 12 });
    expect(report.message).toContain("Q150.00");
    expect(report.message).toContain("precios anunciados, no ventas comprobadas");
    expect(report.message).toContain("Puedes cambiar el precio");
    expect(report.storeSales.label).toContain("no se mezclan");
    expect(report.listed.map((item) => item.url)).toEqual([
      "https://megapaca.store/products/a",
      "https://megapaca.store/products/b",
      "https://store.econopaca.com/ProductDetail?id=2",
    ]);
    expect(report.queriedAt).toBe("2026-10-18T15:00:00.000Z");
  });

  it("no sugiere un precio con menos de tres anuncios relevantes", () => {
    const report = buildGuatemalaCompReport({
      query,
      advertised: [ad({ priceGtq: 100 }), ad({ priceGtq: 120, url: "https://megapaca.store/products/b" })],
      sourceErrors: ["No se pudo consultar Econopaca."],
      sales: [],
    });
    expect(report.status).toBe("insufficient");
    expect(report.suggestedPrice).toBeNull();
    expect(report.advertised.count).toBe(2);
    expect(report.message).toContain("Encontré 2");
    expect(report.message).toContain("Q100.00");
    expect(report.message).toContain("Q120.00");
    expect(report.message).toContain("Escribe el precio manualmente");
    expect(report.message).toContain("No se pudo consultar Econopaca.");
  });

  it("exige marca, condición, talla y separa camisa de camiseta", () => {
    expect(listingIsRelevant(query, ad({ brand: "Guess" }))).toBe(false);
    expect(listingIsRelevant(query, ad({ condition: "usado" }))).toBe(false);
    expect(listingIsRelevant(query, ad({ size: "L" }))).toBe(false);
    expect(listingIsRelevant(query, ad({ size: "0XL" }))).toBe(false);
    expect(listingIsRelevant({ ...query, size: "0XL" }, ad({ size: "0XL" }))).toBe(true);
    expect(listingIsRelevant({ ...query, size: "0XL" }, ad({ size: "XL" }))).toBe(false);
    expect(listingIsRelevant(query, ad({ itemType: "Camiseta", title: "Camiseta Perry Ellis" }))).toBe(false);
    expect(listingIsRelevant({ ...query, size: "" }, ad({ size: "L" }))).toBe(true);
    expect(listingIsRelevant(query, ad({ audience: "Dama" }))).toBe(false);
    expect(listingIsRelevant({ ...query, brand: "Sin marca" }, ad({ brand: "no visible" }))).toBe(true);
    expect(listingIsRelevant({ ...query, brand: "H&M" }, ad({ brand: "HM" }))).toBe(true);
  });

  it("usa las ventas como referencia sin convertirlas en la sugerencia", () => {
    const report = buildGuatemalaCompReport({
      query,
      advertised: [ad()],
      sourceErrors: [],
      sales: [sale({ priceGtq: 30 }), sale({ priceGtq: 40, sku: "2" }), sale({ priceGtq: 50, sku: "3" })],
    });
    expect(report.suggestedPrice).toBeNull();
    expect(report.storeSales.median).toBe(40);
    expect(report.storeSales.label).toContain("Ventas comprobadas de esta tienda");
    expect(report.message).not.toContain("Q40.00");
  });

  it("explica cuando los catálogos no responden", () => {
    const report = buildGuatemalaCompReport({
      query,
      advertised: [],
      sourceErrors: ["No se pudo consultar Megapaca.", "No se pudo consultar Econopaca."],
      sales: null,
      salesNote: "No se pudieron consultar las ventas de esta tienda.",
    });
    expect(report.status).toBe("unavailable");
    expect(report.suggestedPrice).toBeNull();
    expect(report.message).toContain("No se pudo consultar Megapaca ni Econopaca.");
    expect(report.storeSales.label).toContain("No se pudieron consultar las ventas");
  });

  it("completa el precio vacío y conserva uno escrito a mano", () => {
    expect(guatemalaPriceIfEmpty(undefined, 46)).toBe(46);
    expect(guatemalaPriceIfEmpty("", 46)).toBe(46);
    expect(guatemalaPriceIfEmpty(0, 46)).toBe(46);
    expect(guatemalaPriceIfEmpty(80, 46)).toBe(80);
    expect(guatemalaPriceIfEmpty("80.50", 46)).toBe("80.50");
    expect(guatemalaPriceIfEmpty(80, null)).toBe(80);
  });

  it("lee un anuncio real de Megapaca y otro de Econopaca", () => {
    const megapaca = parseMegapacaSuggest({
      resources: {
        results: {
          products: [
            {
              available: true,
              handle: "000873913305",
              price: "158.00",
              tags: ["Caballero", "Camisa", "Nuevo con etiqueta", "Talla M", "Hombre de Paca Bolsa"],
              title: "Camisa M (PERRY ELLIS)",
              vendor: "PERRY ELLIS",
              url: "/products/000873913305?_pos=1",
            },
            { available: false, handle: "agotado", price: "90.00", title: "Camisa agotada", vendor: "PERRY ELLIS" },
          ],
        },
      },
    });
    expect(megapaca).toHaveLength(1);
    expect(megapaca[0]).toMatchObject({
      source: "megapaca",
      priceGtq: 158,
      url: "https://megapaca.store/products/000873913305",
      size: "M",
      condition: "Nuevo con etiqueta",
      audience: "Caballero",
    });
    expect(megapaca[0].itemType).toBe("Camisa");
    expect(listingIsRelevant(query, megapaca[0])).toBe(true);

    const econopaca = parseEconopacaProducts([
      {
        id: "abc",
        name: "Camisa Azul",
        price: 46,
        brand: "Lands'end",
        type: "Camisa",
        condition: "nuevo",
        size: "M",
        subcategory: "caballero",
        stock: 1,
      },
    ]);
    expect(econopaca[0].url).toBe("https://store.econopaca.com/ProductDetail?id=abc");
    expect(listingIsRelevant({ ...query, brand: "Lands'end" }, econopaca[0])).toBe(true);
  });

  it("trata una playera de Megapaca como camiseta y un pantalón etiquetado jeans como jeans", () => {
    const playera = parseMegapacaBoost({
      products: [
        {
          available: true,
          handle: "playera-nike",
          title: "Playera M (NIKE)",
          vendor: "NIKE",
          price_min: 95,
          tags: ["Playera", "Playera de Caballero", "Talla M"],
          body_html: "Condiciones: Nuevo con etiqueta. Talla: M.",
          variants: [{ available: true, price: "95.00" }],
        },
      ],
    });
    expect(playera[0]).toMatchObject({
      source: "megapaca",
      priceGtq: 95,
      url: "https://megapaca.store/products/playera-nike",
      itemType: "Playera",
      condition: "Nuevo con etiqueta",
      size: "M",
    });
    expect(
      listingIsRelevant(
        {
          title: "Camiseta Nike",
          itemType: "Camiseta",
          brand: "Nike",
          condition: "NEW_WITH_TAGS",
          size: "M",
          category: "mens_top",
        },
        playera[0]
      )
    ).toBe(true);

    const jeans = parseMegapacaSuggest({
      resources: {
        results: {
          products: [
            {
              available: true,
              handle: "levis",
              price: "180.00",
              title: "Pantalón 32 X 30 (LEVI'S)",
              vendor: "LEVI'S",
              tags: ["Jeans", "Pantalón de Caballero", "Nuevo con etiqueta"],
              body: "<p>Talla: 32 X 30.</p>",
            },
          ],
        },
      },
    });
    expect(jeans[0].itemType).toBe("Jeans");
    expect(jeans[0].size).toBe("32X30");
    expect(
      listingIsRelevant(
        {
          itemType: "Jeans",
          brand: "Levi's",
          condition: "NEW_WITH_TAGS",
          size: "32x30",
          category: "mens_jeans",
        },
        jeans[0]
      )
    ).toBe(true);
    expect(listingIsRelevant({ itemType: "Pantalón", brand: "Levi's", condition: "NEW_WITH_TAGS", size: "32x30" }, jeans[0])).toBe(false);
    expect(listingIsRelevant({ itemType: "Chumpa", brand: "Zara", condition: "GOOD", size: "M" }, ad({ title: "Chumpa M", itemType: "Chumpa", brand: "Zara", condition: "usado" }))).toBe(true);
  });
});
