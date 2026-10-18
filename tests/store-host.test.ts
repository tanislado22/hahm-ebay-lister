import { describe, expect, it } from "vitest";
import { decideStoreRequest, isPublicStoreApi } from "@/lib/markets/store-host";

describe("dominio de Variedades San Andrés", () => {
  it("manda el dominio sin www al dominio con www y abre el catálogo", () => {
    expect(decideStoreRequest("variedadessanandres.com", "/")).toEqual({
      kind: "redirect",
      hostname: "www.variedadessanandres.com",
      pathname: "/",
    });
    expect(decideStoreRequest("www.variedadessanandres.com", "/")).toEqual({
      kind: "rewrite",
      pathname: "/tienda",
    });
    expect(decideStoreRequest("www.variedadessanandres.com", "/prenda/abc")).toEqual({
      kind: "rewrite",
      pathname: "/tienda/prenda/abc",
    });
  });

  it("deja la administración en Vercel y oculta las rutas privadas en la tienda", () => {
    expect(decideStoreRequest("hahm-ebay-lister-ebay-lister3.vercel.app", "/")).toEqual({ kind: "app" });
    expect(decideStoreRequest("www.variedadessanandres.com", "/guatemala/inventario")).toEqual({
      kind: "redirect",
      hostname: "www.variedadessanandres.com",
      pathname: "/",
    });
    expect(decideStoreRequest("www.variedadessanandres.com", "/api/markets/guatemala/inventory")).toEqual({ kind: "hidden" });
    expect(decideStoreRequest("www.variedadessanandres.com", "/api/markets/guatemala/expenses")).toEqual({ kind: "hidden" });
    expect(isPublicStoreApi("/api/markets/guatemala/catalog")).toBe(true);
    expect(isPublicStoreApi("/api/markets/guatemala/catalog/foto/abc")).toBe(true);
    expect(isPublicStoreApi("/api/markets/guatemala/catalog/prenda")).toBe(true);
    expect(isPublicStoreApi("/api/markets/guatemala/price-guides")).toBe(false);
  });
});
