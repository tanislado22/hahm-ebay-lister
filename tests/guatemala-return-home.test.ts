import { describe, expect, it } from "vitest";
import {
  guatemalaAdminHome,
  leaveIsAllowed,
  showStaffReturnHome,
  STAFF_PANEL_HOME,
  OWNER_ADMIN_HOME,
} from "@/lib/markets/guatemala-return-home";

describe("regreso a la pantalla principal de Tienda Guatemala", () => {
  it("lleva al propietario a su inicio y al encargado a su panel", () => {
    expect(guatemalaAdminHome("propietario")).toBe(OWNER_ADMIN_HOME);
    expect(guatemalaAdminHome("encargado")).toBe(STAFF_PANEL_HOME);
    expect(guatemalaAdminHome("propietario")).toBe("/");
    expect(guatemalaAdminHome("encargado")).toBe("/guatemala/panel");
  });

  it("muestra el botón en las secciones del encargado y no en su panel", () => {
    expect(showStaffReturnHome("/guatemala/panel")).toBe(false);
    expect(showStaffReturnHome("/guatemala/panel/")).toBe(false);
    expect(showStaffReturnHome("/guatemala/panel/inventario")).toBe(true);
    expect(showStaffReturnHome("/guatemala/panel/reportes")).toBe(true);
    expect(showStaffReturnHome("/guatemala/panel/gastos")).toBe(true);
    expect(showStaffReturnHome("/guatemala/panel/publicar")).toBe(true);
    expect(showStaffReturnHome("/guatemala/panel/corregir")).toBe(true);
    expect(showStaffReturnHome("/guatemala/inventario")).toBe(false);
  });

  it("pide confirmación solo cuando hay datos sin guardar", () => {
    expect(leaveIsAllowed({ dirty: false, confirmed: false })).toBe(true);
    expect(leaveIsAllowed({ dirty: true, confirmed: false })).toBe(false);
    expect(leaveIsAllowed({ dirty: true, confirmed: true })).toBe(true);
  });
});
