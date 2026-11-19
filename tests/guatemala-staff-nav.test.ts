import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inventoryLaunch } from "@/lib/markets/guatemala-inventory";

describe("accesos de la pantalla principal de Tienda Guatemala", () => {
  it("ordena escanear, con foto, sin foto, venta e inventario", () => {
    const layout = readFileSync("app/guatemala/panel/layout.tsx", "utf8");
    const labels = [
      "Escanear QR",
      "Agregar artículo con foto",
      "Agregar artículo sin foto",
      "Registrar venta",
      "Inventario",
    ];
    let cursor = -1;
    for (const label of labels) {
      const at = layout.indexOf(label);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(layout).toContain('href="/guatemala/panel/publicar"');
    expect(layout).toContain('href="/guatemala/panel/inventario?accion=sin-foto"');
    expect(layout).toContain('href="/guatemala/panel/inventario?accion=venta"');
    expect(layout).not.toContain(">Agregar artículo<");
    const inventory = readFileSync("app/guatemala/inventario/screen.tsx", "utf8");
    expect(inventory).toContain("Agregar artículo sin foto");
    expect(inventory).toContain("Registrar venta");
    expect(inventory).toContain("Buscar prenda por foto");
  });

  it("solo abre los formularios conocidos del inventario", () => {
    expect(inventoryLaunch("sin-foto")).toBe("sin-foto");
    expect(inventoryLaunch("venta")).toBe("venta");
    expect(inventoryLaunch("publicar")).toBeNull();
    expect(inventoryLaunch(null)).toBeNull();
  });
});
