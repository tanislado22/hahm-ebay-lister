import { describe, expect, it } from "vitest";
import { catalogPublicState } from "@/lib/markets/guatemala-catalog";
import {
  applyRegistrationScan,
  lotAfterRegistrationScan,
  photoLessStaysOutOfCatalog,
  preparePhotoLessRegistration,
  registrationFormShouldClear,
  registrationInsertDecision,
  skuFromRegistrationScan,
} from "@/lib/markets/guatemala-registration";

const blank = {
  sku: "",
  lotId: "",
  title: "",
  description: "",
  brand: "",
  size: "",
  condition: "",
  price: "",
};

describe("registro por QR en Tienda Guatemala", () => {
  it("copia el SKU tal como viene, con letras, guiones y ceros", () => {
    expect(skuFromRegistrationScan("L1-001")).toEqual({ ok: true, kind: "sku", sku: "L1-001" });
    expect(skuFromRegistrationScan("L2-001")).toEqual({ ok: true, kind: "sku", sku: "L2-001" });
    expect(skuFromRegistrationScan(" USA-001 ")).toEqual({ ok: true, kind: "sku", sku: "USA-001" });
    expect(skuFromRegistrationScan("L1-0001")).toEqual({ ok: true, kind: "sku", sku: "L1-0001" });
    const applied = applyRegistrationScan({ ...blank, lotId: "lote-manual", title: "Blusa", price: "40" }, "L1-001");
    expect(applied.ok && applied.form.sku).toBe("L1-001");
    expect(applied.ok && applied.form.lotId).toBe("lote-manual");
    expect(applied.ok && applied.form.title).toBe("Blusa");
    expect(applied.ok && applied.form.price).toBe("40");
  });

  it("no asigna un lote por el prefijo del SKU", () => {
    expect(lotAfterRegistrationScan("", "L1-001")).toBe("");
    expect(lotAfterRegistrationScan("lote-2", "L1-001")).toBe("lote-2");
    expect(lotAfterRegistrationScan("lote-usa", "USA-001")).toBe("lote-usa");
    const saved = preparePhotoLessRegistration({ sku: "L1-001", price: "25", lotId: "" });
    expect(saved.ok && saved.item.lotId).toBeNull();
    expect(saved.ok && saved.item.sku).toBe("L1-001");
    const chosen = preparePhotoLessRegistration({ sku: "L2-001", price: "25", lotId: "lote-9" });
    expect(chosen.ok && chosen.item.lotId).toBe("lote-9");
  });

  it("abre un SKU repetido y no lo reemplaza", () => {
    const existing = { id: "prenda-1", sku: "USA-001", title: "Chaqueta" };
    expect(registrationInsertDecision(existing)).toEqual({ action: "open_existing", item: existing });
    expect(registrationInsertDecision(null)).toEqual({ action: "insert" });
  });

  it("guarda sin fotos fuera del catálogo y solo limpia el formulario si se guardó", () => {
    const saved = preparePhotoLessRegistration({
      sku: "L1-001",
      title: "",
      price: "15",
      lotId: "",
    });
    expect(saved.ok && saved.item.published).toBe(false);
    expect(saved.ok && saved.item.title).toBe("L1-001");
    expect(saved.ok && saved.item.priceGtq).toBe("15.00");
    expect(
      photoLessStaysOutOfCatalog(
        { clientId: "tienda", status: "disponible", sales: [], published: false },
        "tienda"
      )
    ).toBe(true);
    expect(
      catalogPublicState(
        {
          id: "1",
          clientId: "tienda",
          sku: "L1-001",
          title: "L1-001",
          description: "",
          brand: "",
          size: "",
          condition: "",
          priceGtq: "15.00",
          status: "disponible",
          photos: [{ id: "f", mediaType: "image/jpeg", data: "abcdabcd" }],
          sales: [],
          published: false,
        },
        "tienda"
      )
    ).toBe("oculto");
    expect(registrationFormShouldClear(false)).toBe(false);
    expect(registrationFormShouldClear(true)).toBe(true);
  });
});
