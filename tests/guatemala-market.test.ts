import { describe, expect, it } from "vitest";
import { buildGuatemalaAnalysisPrompt } from "@/lib/markets/guatemala-prompt";
import {
  formatQuetzales,
  guatemalaCompReport,
  prepareGuatemalaListing,
  requestTargetsGuatemala,
} from "@/lib/markets/guatemala";
import type { ListingResult } from "@/lib/types";

const listing: ListingResult = {
  title: "Camisa azul",
  description: "Camisa de algodón.",
  brand: "Nike",
  suggested_price: 24.99,
};

describe("Tienda Guatemala", () => {
  it("quita el precio estimado y marca la moneda GTQ", () => {
    const prepared = prepareGuatemalaListing(listing);
    expect(prepared.suggested_price).toBeUndefined();
    expect(prepared.market).toBe("guatemala");
    expect(prepared.currency).toBe("GTQ");
    expect(prepared.title).toBe("Camisa azul");
  });

  it("pide título y descripción en español y prohíbe inventar un precio", () => {
    const prompt = buildGuatemalaAnalysisPrompt("clothing");
    expect(prompt).toContain("español");
    expect(prompt).toContain("No incluyas un precio");
    expect(prompt).toContain("No conviertas precios de otros países");
    expect(prompt).toContain("0XL");
  });

  it("informa que la fuente no está configurada y no devuelve precios", () => {
    const report = guatemalaCompReport(new Date("2026-10-15T22:00:00.000Z"));
    expect(report.status).toBe("source_not_configured");
    expect(report.currency).toBe("GTQ");
    expect(report.symbol).toBe("Q");
    expect(report.timezone).toBe("America/Guatemala");
    expect(report.listed).toEqual([]);
    expect(report.sold).toEqual([]);
    expect(report.message).toContain("Falta configurar una fuente");
    expect(JSON.stringify(report)).not.toContain("24.99");
    expect(report.queriedAt).toBe("2026-10-15T22:00:00.000Z");
  });

  it("reconoce una publicación de Guatemala antes de enviarla a eBay", () => {
    expect(requestTargetsGuatemala({ listing: { market: "guatemala" } })).toBe(true);
    expect(requestTargetsGuatemala({ market: "guatemala" })).toBe(true);
    expect(requestTargetsGuatemala({ listing: { market: "store" } })).toBe(false);
    expect(requestTargetsGuatemala({})).toBe(false);
  });

  it("muestra el quetzal con Q", () => {
    expect(formatQuetzales(15)).toBe("Q15.00");
    expect(formatQuetzales(30.5)).toBe("Q30.50");
  });
});
