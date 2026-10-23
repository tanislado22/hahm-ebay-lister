import { describe, expect, it } from "vitest";
import {
  GUATEMALA_ARTICLE_WHATSAPP_LABEL,
  GUATEMALA_CATALOG_WHATSAPP_LABEL,
  GUATEMALA_CATALOG_WHATSAPP_MESSAGE,
  catalogRequestOrigin,
  guatemalaArticleWhatsappMessage,
  guatemalaWhatsappUrl,
  publicArticleUrl,
} from "@/lib/markets/guatemala-whatsapp";

describe("WhatsApp del catálogo público", () => {
  it("prellena el artículo con título, SKU, precio y enlace público", () => {
    const publicUrl = publicArticleUrl("https://www.variedadessanandres.com", true, "prenda-3001");
    const message = guatemalaArticleWhatsappMessage({
      title: "Camisa & polo?",
      sku: "001-2",
      priceGtq: "40.00",
      publicUrl,
    });
    expect(message).toBe(
      "Hola, me interesa este artículo: Camisa & polo?. SKU: 001-2. Precio: Q40.00. Enlace: https://www.variedadessanandres.com/prenda/prenda-3001"
    );
    expect(GUATEMALA_ARTICLE_WHATSAPP_LABEL).toBe("Consultar por WhatsApp");

    const url = guatemalaWhatsappUrl(message);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://wa.me/50232672767");
    expect([...parsed.searchParams.keys()]).toEqual(["text"]);
    expect(parsed.searchParams.get("text")).toBe(message);
    expect(url).toContain("SKU%3A%20001-2");
    expect(url).toContain("Camisa%20%26%20polo%3F");
    expect(url).not.toContain("send=");
    expect(url).not.toMatch(/\s/);
  });

  it("usa el mensaje general del catálogo y conserva ceros del SKU", () => {
    const url = guatemalaWhatsappUrl(GUATEMALA_CATALOG_WHATSAPP_MESSAGE);
    expect(new URL(url).searchParams.get("text")).toBe("Hola, quisiera información sobre la ropa disponible");
    expect(GUATEMALA_CATALOG_WHATSAPP_LABEL).toBe("WhatsApp +502 32672767");
    expect(guatemalaArticleWhatsappMessage({
      title: "Polo",
      sku: "001-2",
      priceGtq: "10.50",
      publicUrl: publicArticleUrl("http://localhost:3456", false, "id con espacio"),
    })).toContain("SKU: 001-2");
    expect(publicArticleUrl("http://localhost:3456", false, "id con espacio")).toBe(
      "http://localhost:3456/tienda/prenda/id%20con%20espacio"
    );
  });

  it("arma el origen público sin perder el host de la tienda", () => {
    expect(catalogRequestOrigin("www.variedadessanandres.com", "https")).toBe("https://www.variedadessanandres.com");
    expect(catalogRequestOrigin("localhost:3456", null)).toBe("http://localhost:3456");
    expect(catalogRequestOrigin("", null)).toBe("https://www.variedadessanandres.com");
    expect(guatemalaArticleWhatsappMessage({
      title: "   ",
      sku: "3001",
      priceGtq: "40.00",
      publicUrl: "https://www.variedadessanandres.com/prenda/3001",
    })).toContain("Prenda sin título");
  });
});
