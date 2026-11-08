import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STAFF_APP_NAME,
  STAFF_APP_SCOPE,
  STAFF_APP_START,
  STAFF_OFFLINE_NOTICE,
  STAFF_SALE_NOT_SAVED,
  STAFF_SALE_OFFLINE,
  acceptedSaleUpdate,
  installSurface,
  isIosDevice,
  saleMayBeSubmitted,
  staffFetchPlan,
} from "@/lib/markets/guatemala-pwa";

const root = process.cwd();

describe("aplicación instalable de Variedades San Andrés", () => {
  const manifest = JSON.parse(readFileSync(`${root}/public/guatemala/manifest.webmanifest`, "utf8")) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };

  it("abre la entrada del personal en una ventana propia", () => {
    expect(manifest.name).toBe(STAFF_APP_NAME);
    expect(manifest.name).toBe("Variedades San Andrés");
    expect(manifest.short_name.length).toBeGreaterThan(0);
    expect(manifest.start_url).toBe(STAFF_APP_START);
    expect(manifest.scope).toBe(STAFF_APP_SCOPE);
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512", "512x512"]);
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    expect(manifest.icons.some((icon) => icon.purpose === "any")).toBe(true);
    for (const icon of manifest.icons) {
      expect(readFileSync(`${root}/public${icon.src}`).byteLength).toBeGreaterThan(200);
    }
    expect(readFileSync(`${root}/public/guatemala/icons/apple-touch-icon.png`).byteLength).toBeGreaterThan(200);
  });

  it("ofrece la instalación nativa y, en iPhone, las instrucciones de Safari", () => {
    expect(installSurface({ standalone: false, ios: false, canPrompt: true })).toBe("prompt");
    expect(installSurface({ standalone: false, ios: true, canPrompt: false })).toBe("ios");
    expect(installSurface({ standalone: true, ios: true, canPrompt: true })).toBe("installed");
    expect(installSurface({ standalone: false, ios: false, canPrompt: false })).toBe("manual");
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)", "iPhone", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)", "iPad", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Windows NT 10.0)", "Win32", 0)).toBe(false);
  });

  it("no guarda una venta sin conexión ni cuando el envío falla", () => {
    expect(saleMayBeSubmitted(false)).toEqual({ ok: false, error: STAFF_SALE_OFFLINE });
    expect(saleMayBeSubmitted(true)).toEqual({ ok: true });
    const saved = {
      sku: "L1-4",
      status: "vendida",
      priceGtq: "40.00",
      sale: { chargedPriceGtq: "35.00" },
    };
    expect(acceptedSaleUpdate(true, { ok: true, item: saved })).toEqual(saved);
    expect(acceptedSaleUpdate(false, { ok: true, item: saved })).toBeNull();
    expect(acceptedSaleUpdate(true, { ok: false, item: saved })).toBeNull();
    expect(acceptedSaleUpdate(true, { ok: true, item: { ...saved, sale: undefined } })).toBeNull();
    expect(acceptedSaleUpdate(true, null)).toBeNull();
    expect(STAFF_SALE_NOT_SAVED).toContain("No quedó guardada");
  });

  it("no guarda inventario ni ventas en la caché y avisa sin internet", () => {
    expect(staffFetchPlan({ method: "GET", pathname: "/tienda", navigation: true })).toBe("passthrough");
    expect(staffFetchPlan({ method: "GET", pathname: "/api/markets/guatemala/inventory", navigation: false })).toBe(
      "network-only"
    );
    expect(staffFetchPlan({ method: "POST", pathname: "/api/markets/guatemala/inventory/prenda/sale", navigation: false })).toBe(
      "passthrough"
    );
    expect(staffFetchPlan({ method: "GET", pathname: "/guatemala/panel/inventario", navigation: true })).toBe(
      "network-or-offline"
    );
    expect(staffFetchPlan({ method: "GET", pathname: "/guatemala/panel/inventario", navigation: false })).toBe(
      "network-only"
    );
    const worker = readFileSync(`${root}/public/guatemala/sw.js`, "utf8");
    expect(worker).not.toContain("cache.put");
    expect(worker.match(/cache\.add/g)).toHaveLength(1);
    expect(worker).toContain('cache: "no-store"');
    expect(worker).toContain("/guatemala/sin-conexion.html");
    expect(worker).toContain("skipWaiting");
    const offline = readFileSync(`${root}/public/guatemala/sin-conexion.html`, "utf8");
    expect(offline).toContain(STAFF_OFFLINE_NOTICE);
    expect(offline).not.toContain("vendida");
  });
});
