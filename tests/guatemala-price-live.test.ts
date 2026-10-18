import { describe, expect, it } from "vitest";
import { buildGuatemalaCompReport } from "@/lib/markets/guatemala-price-match";
import { fetchGuatemalaAdvertised } from "@/lib/markets/guatemala-price-sources";

describe("catálogos públicos de Guatemala", () => {
  it("consulta Megapaca y Econopaca para una camisa", async () => {
    const query = {
      title: "Camisa azul Perry Ellis",
      itemType: "Camisa",
      brand: "Perry Ellis",
      condition: "NEW_WITH_TAGS",
      size: "M",
      category: "mens_top",
    };
    const catalogs = await fetchGuatemalaAdvertised(query);
    const report = buildGuatemalaCompReport({
      query,
      advertised: catalogs.items,
      sourceErrors: catalogs.errors,
      sales: [],
    });
    console.log(
      JSON.stringify(
        {
          errors: catalogs.errors,
          fetched: catalogs.items.length,
          bySource: {
            megapaca: catalogs.items.filter((item) => item.source === "megapaca").length,
            econopaca: catalogs.items.filter((item) => item.source === "econopaca").length,
          },
          status: report.status,
          suggestedPrice: report.suggestedPrice,
          advertised: report.advertised,
          message: report.message,
          links: report.listed.map((item) => ({
            source: item.sourceLabel,
            price: item.priceGtq,
            title: item.title,
            url: item.url,
          })),
        },
        null,
        2
      )
    );
    expect(catalogs.errors).not.toContain("No se pudo consultar Megapaca.");
    expect(catalogs.errors).not.toContain("No se pudo consultar Econopaca.");
    expect(catalogs.items.some((item) => item.source === "megapaca")).toBe(true);
    expect(catalogs.items.length).toBeGreaterThan(0);
    expect(report.currency).toBe("GTQ");

    const shirts = await fetchGuatemalaAdvertised({
      title: "Camiseta Nike",
      itemType: "Camiseta",
      brand: "Nike",
      condition: "NEW_WITH_TAGS",
      size: "M",
      category: "mens_top",
    });
    expect(shirts.errors).not.toContain("No se pudo consultar Megapaca.");
    const playeras = shirts.items.filter((item) => item.source === "megapaca" && /playera/i.test(item.title));
    expect(playeras.length).toBeGreaterThan(0);
    expect(playeras.some((item) => item.priceGtq > 0 && item.url.startsWith("https://megapaca.store/products/"))).toBe(true);
    const shirtReport = buildGuatemalaCompReport({
      query: {
        title: "Camiseta Nike",
        itemType: "Camiseta",
        brand: "Nike",
        condition: "NEW_WITH_TAGS",
        size: "M",
        category: "mens_top",
      },
      advertised: shirts.items,
      sourceErrors: shirts.errors,
      sales: [],
    });
    const landsEnd = await fetchGuatemalaAdvertised({
      title: "Camisa Lands' End",
      itemType: "Camisa",
      brand: "Lands' End",
      condition: "NEW_WITH_TAGS",
      size: "S",
      category: "mens_top",
    });
    const landsReport = buildGuatemalaCompReport({
      query: {
        title: "Camisa Lands' End",
        itemType: "Camisa",
        brand: "Lands' End",
        condition: "NEW_WITH_TAGS",
        size: "S",
        category: "mens_top",
      },
      advertised: landsEnd.items,
      sourceErrors: landsEnd.errors,
      sales: [],
    });
    expect(shirtReport.currency).toBe("GTQ");
    expect(landsReport.currency).toBe("GTQ");
    expect(landsEnd.errors).not.toContain("No se pudo consultar Econopaca.");
    expect(landsEnd.items.some((item) => item.source === "econopaca")).toBe(true);
    if (report.suggestedPrice != null) {
      expect(report.suggestedPrice).toBeGreaterThan(0);
      expect(report.suggestedPrice).toBeGreaterThanOrEqual(report.advertised.low ?? 0);
      expect(report.suggestedPrice).toBeLessThanOrEqual(report.advertised.high ?? 0);
    }
  }, 45000);
});
