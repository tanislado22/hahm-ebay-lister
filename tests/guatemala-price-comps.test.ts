import { describe, expect, it } from "vitest";
import {
  buildGuatemalaCompReport,
  coerceGuatemalaCompReport,
  guatemalaCompReportIsCurrent,
  garmentKind,
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

  it("trata la polo PJ Paul Jones 2XL aparte de una camiseta y amplía la talla", () => {
    const polo = {
      title: "Playera tipo polo PJ Paul Jones negra tejida manga corta talla 2XL",
      itemType: "Playera tipo polo de punto",
      brand: "PJ Paul Jones",
      condition: "NEW_WITH_TAGS",
      size: "2XL",
      category: "mens_top",
    };
    expect(garmentKind(polo.itemType, polo.title)?.key).toBe("polo");
    expect(garmentKind("Camiseta", "Playera Nike")?.key).toBe("camiseta");
    const report = buildGuatemalaCompReport({
      query: polo,
      advertised: [
        ad({ title: "Polo 2XL (PJ PAUL JONES)", brand: "PJ PAUL JONES", itemType: "Polo", size: "2XL", priceGtq: 120, url: "https://megapaca.store/products/polo-2xl" }),
        ad({ title: "Polo M (PJ PAUL JONES)", brand: "PJ PAUL JONES", itemType: "Polo", size: "M", priceGtq: 90, url: "https://megapaca.store/products/polo-m" }),
        ad({ title: "Polo L (PJ PAUL JONES)", brand: "PJ PAUL JONES", itemType: "Polo", size: "L", priceGtq: 110, url: "https://megapaca.store/products/polo-l" }),
        ad({ title: "Playera M (PJ PAUL JONES)", brand: "PJ PAUL JONES", itemType: "Camiseta", size: "M", priceGtq: 40, url: "https://megapaca.store/products/tee" }),
        ad({ title: "Polo 2XL usada", brand: "PJ PAUL JONES", itemType: "Polo", size: "2XL", condition: "usado", priceGtq: 30, url: "https://megapaca.store/products/used" }),
      ],
      sourceErrors: [],
      sales: [],
    });
    expect(report.priceBasis).toBe("same-brand");
    expect(report.suggestedPrice).toBe(110);
    expect(report.message).toContain("Precio orientativo");
    expect(report.message).toContain("Se amplió la talla");
    expect(report.listed.map((item) => item.url)).toEqual([
      "https://megapaca.store/products/polo-2xl",
      "https://megapaca.store/products/polo-m",
      "https://megapaca.store/products/polo-l",
    ]);
  });

  it("solo usa otra marca cuando la tabla de la tienda la marca como comparable", () => {
    const polo = {
      itemType: "Polo",
      brand: "PJ Paul Jones",
      condition: "NEW_WITH_TAGS",
      size: "2XL",
    };
    const catalog = [
      ad({ title: "Polo 2XL", brand: "PJ Paul Jones", itemType: "Polo", size: "2XL", priceGtq: 100, url: "https://megapaca.store/products/one" }),
      ad({ title: "Polo M", brand: "Van Heusen", itemType: "Polo", size: "M", priceGtq: 80, url: "https://megapaca.store/products/vh1" }),
      ad({ title: "Polo L", brand: "Van Heusen", itemType: "Polo", size: "L", priceGtq: 85, url: "https://megapaca.store/products/vh2" }),
      ad({ title: "Polo S", brand: "Van Heusen", itemType: "Polo", size: "S", priceGtq: 75, url: "https://megapaca.store/products/vh3" }),
    ];
    const withoutReason = buildGuatemalaCompReport({
      query: polo,
      advertised: catalog,
      sourceErrors: [],
      sales: [],
    });
    expect(withoutReason.suggestedPrice).toBeNull();
    expect(withoutReason.listed.map((item) => item.brand)).toEqual(["PJ Paul Jones"]);

    const withReason = buildGuatemalaCompReport({
      query: polo,
      advertised: catalog,
      sourceErrors: [],
      sales: [],
      guides: [
        {
          scope: "brand",
          brand: "PJ Paul Jones",
          garment: "polo",
          condition: "nuevo",
          priceGtq: null,
          adjustmentGtq: null,
          comparableBrands: ["Van Heusen"],
        },
      ],
    });
    expect(withReason.priceBasis).toBe("comparable-brands");
    expect(withReason.suggestedPrice).toBe(80);
    expect(withReason.message).toContain("Van Heusen");
    expect(withReason.message).toContain("Precio orientativo");
    expect(withReason.listed.every((item) => item.brand === "Van Heusen")).toBe(true);
  });

  it("estima con la tabla de la tienda y no inventa enlaces cuando faltan anuncios", () => {
    const report = buildGuatemalaCompReport({
      query: {
        title: "Playera tipo polo PJ Paul Jones talla 2XL",
        itemType: "Polo",
        brand: "PJ PAUL JONES",
        condition: "NEW_WITH_TAGS",
        size: "2XL",
        category: "mens_top",
      },
      advertised: [
        ad({
          title: "Polo 2XL (PJ PAUL JONES)",
          brand: "PJ PAUL JONES",
          itemType: "Polo",
          size: "2XL",
          priceGtq: 120,
          url: "https://megapaca.store/products/polo-2xl",
        }),
      ],
      sourceErrors: [],
      sales: [],
      guides: [
        {
          scope: "general",
          brand: "",
          garment: "polo",
          condition: "nuevo",
          priceGtq: 95,
          adjustmentGtq: null,
          comparableBrands: [],
        },
      ],
    });
    expect(report.priceBasis).toBe("store-estimate");
    expect(guatemalaCompReportIsCurrent(report)).toBe(true);
    expect(report.suggestedPrice).toBe(95);
    expect(report.message).toContain("Estimación de la tienda");
    expect(report.message).toContain("No es un precio comprobado del mercado");
    expect(report.message).not.toContain("https://");
    expect(report.proposal).toEqual([]);
    expect(report.listed.map((item) => item.url)).toEqual(["https://megapaca.store/products/polo-2xl"]);
  });

  it("aplica el precio general a cualquier marca y suma el ajuste solo si existe", () => {
    const polo = {
      itemType: "Polo",
      brand: "PJ PAUL JONES",
      condition: "NEW_WITH_TAGS",
      size: "2XL",
    };
    const general = {
      scope: "general" as const,
      brand: "",
      garment: "polo",
      condition: "nuevo" as const,
      priceGtq: 90,
      adjustmentGtq: null,
      comparableBrands: [],
    };
    const plain = buildGuatemalaCompReport({
      query: { ...polo, brand: "Otra Marca" },
      advertised: [],
      sourceErrors: [],
      sales: [],
      guides: [general],
    });
    expect(plain.suggestedPrice).toBe(90);
    expect(plain.priceBasis).toBe("store-estimate");
    expect(plain.message).toContain("Estimación de la tienda");

    const adjusted = buildGuatemalaCompReport({
      query: polo,
      advertised: [],
      sourceErrors: [],
      sales: [],
      guides: [
        general,
        {
          scope: "brand",
          brand: "PJ Paul Jones",
          garment: "polo",
          condition: "nuevo",
          priceGtq: null,
          adjustmentGtq: 15,
          comparableBrands: [],
        },
      ],
    });
    expect(adjusted.suggestedPrice).toBe(105);
    expect(adjusted.message).toContain("ajuste");
    expect(adjusted.message).toContain("PJ Paul Jones");
    expect(adjusted.message).toContain("No es un precio comprobado del mercado");
  });

  it("propone el precio general que falta sin inventar un importe", () => {
    const report = buildGuatemalaCompReport({
      query: {
        itemType: "Playera tipo polo",
        brand: "PJ PAUL JONES",
        condition: "NEW_WITH_TAGS",
        size: "2XL",
      },
      advertised: [],
      sourceErrors: [],
      sales: [],
      guides: [
        {
          scope: "brand",
          brand: "PJ Paul Jones",
          garment: "polo",
          condition: "nuevo",
          priceGtq: null,
          adjustmentGtq: 20,
          comparableBrands: [],
        },
      ],
    });
    expect(report.suggestedPrice).toBeNull();
    expect(report.priceBasis).toBeNull();
    expect(guatemalaCompReportIsCurrent(report)).toBe(true);
    expect(report.message).toContain("Propuesta: define el precio general de polo nueva");
    expect(report.message).toContain("No hay un importe inicial");
    expect(report.message).not.toMatch(/Q\d/);
    expect(report.proposal).toEqual([{ garment: "polo", condition: "nuevo", label: "polo nueva" }]);
  });

  it("ignores a saved comparison from before the advertised catalogs", () => {
    expect(
      coerceGuatemalaCompReport({
        ok: true,
        status: "source_not_configured",
        listed: {},
        sold: [],
        message: "Falta configurar una fuente de comparaciones en Guatemala.",
      })
    ).toBeNull();
  });

  it("pide de nuevo una comparación guardada antes de la tabla de la tienda", () => {
    const saved = coerceGuatemalaCompReport({
      ok: true,
      status: "insufficient",
      message:
        "No hay suficientes precios anunciados parecidos para sugerir un monto. Encontré 0 con el mismo tipo, marca, condición y talla. Estos son precios anunciados, no ventas comprobadas. Se necesitan al menos 3. Escribe el precio manualmente.",
      listed: [],
      sold: [],
      suggestedPrice: null,
      advertised: { count: 0, low: null, high: null, median: null, label: "anuncios" },
      storeSales: { count: 0, low: null, high: null, median: null, label: "Ventas comprobadas de esta tienda: todavía no hay ventas parecidas." },
    });
    expect(saved).not.toBeNull();
    expect(guatemalaCompReportIsCurrent(saved!)).toBe(false);
    const previousTableMessage = coerceGuatemalaCompReport({
      ok: true,
      status: "insufficient",
      message:
        "No hay suficientes precios anunciados parecidos para sugerir un monto. Encontré 0 con el mismo tipo, marca, condición y talla. Estos son precios anunciados, no ventas comprobadas. Se necesitan al menos 3. No hay una regla en la tabla de la tienda para esta marca, tipo y condición. Escribe el precio manualmente.",
      listed: [],
      sold: [],
      suggestedPrice: null,
      advertised: { count: 0, low: null, high: null, median: null, label: "anuncios" },
      storeSales: { count: 0, low: null, high: null, median: null, label: "Ventas comprobadas de esta tienda: todavía no hay ventas parecidas." },
    });
    expect(guatemalaCompReportIsCurrent(previousTableMessage!)).toBe(false);
  });
});
