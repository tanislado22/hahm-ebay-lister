import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyGuatemalaSale, type SaleBook } from "@/lib/markets/guatemala-inventory";
import { acceptedSaleUpdate } from "@/lib/markets/guatemala-pwa";
import {
  GARMENT_QR_PREFIX,
  GARMENT_QR_SPEC,
  QR_MESSAGES,
  beginSale,
  beginScan,
  cameraFailureMessage,
  cameraMayRetry,
  garmentQrText,
  parseGarmentQr,
  presentGuatemalaScan,
  readScannedLabel,
  releaseScan,
  scanLotLabel,
  scanQuery,
  scanSaleDecision,
  type ScanGarment,
} from "@/lib/markets/guatemala-qr";

const root = process.cwd();
const playera = "550e8400-e29b-41d4-a716-446655440000";
const otra = "550e8400-e29b-41d4-a716-446655440001";

function garment(input: Partial<ScanGarment> & Pick<ScanGarment, "id" | "sku" | "lotNumber">): ScanGarment {
  return {
    title: "Playera",
    priceGtq: "40.00",
    status: "disponible",
    published: true,
    lotId: input.lotNumber == null ? null : `lote-${input.lotNumber}`,
    lotName: input.lotNumber == null ? null : "Pacas",
    photo: null,
    ...input,
  };
}

function book(): SaleBook {
  return {
    items: [
      {
        id: playera,
        clientId: "tienda",
        sku: "3001",
        priceGtq: "40.00",
        status: "disponible",
        photos: [],
      },
    ],
    sales: [],
  };
}

describe("etiqueta QR de Tienda Guatemala", () => {
  it("imprime el identificador de esa prenda y no el SKU ni un enlace", () => {
    const text = garmentQrText(playera);
    expect(text).toBe(`${GARMENT_QR_PREFIX}:${playera}`);
    expect(GARMENT_QR_SPEC).toContain(text);
    expect(text.startsWith("http")).toBe(false);
    expect(text).not.toContain("3001");
    expect(text).not.toContain("precio");
    expect(text).not.toContain("sesion");
    expect(parseGarmentQr(`  ${text.toUpperCase()}  `)).toEqual({ ok: true, itemId: playera });
    expect(parseGarmentQr("L1-0001").ok).toBe(false);
    expect(parseGarmentQr(`VSA2:${playera}`).ok).toBe(false);
    expect(parseGarmentQr(`VSA1:${playera}?venta=1`).ok).toBe(false);
    expect(GARMENT_QR_SPEC).toContain("L1-0001");
  });

  it("acepta un QR que solo contiene el SKU y lo conserva tal cual", () => {
    expect(readScannedLabel(garmentQrText(playera))).toEqual({ ok: true, kind: "code", itemId: playera });
    expect(readScannedLabel("  L1-0001  ")).toEqual({ ok: true, kind: "sku", sku: "L1-0001" });
    expect(readScannedLabel("0001")).toEqual({ ok: true, kind: "sku", sku: "0001" });
    expect(readScannedLabel("l1-0001")).toEqual({ ok: true, kind: "sku", sku: "l1-0001" });
    expect(readScannedLabel("L1 0001")).toEqual({ ok: true, kind: "sku", sku: "L1 0001" });
    expect(readScannedLabel("   ").ok).toBe(false);
    expect(scanQuery({ codigo: "  L1-0001  ", sku: "" })).toEqual({ ok: true, kind: "sku", sku: "L1-0001" });
    expect(scanQuery({ codigo: garmentQrText(playera), sku: "L1-0001" })).toEqual({
      ok: true,
      kind: "code",
      itemId: playera,
    });
    expect(scanQuery({ codigo: "", sku: "0001" })).toEqual({ ok: true, kind: "sku", sku: "0001" });
    expect(scanQuery({ codigo: "", sku: "" })).toMatchObject({ ok: false, status: 400 });

    const found = presentGuatemalaScan("sku", [
      garment({ id: playera, sku: "L1-0001", title: "Blusa", lotNumber: 1, lotName: "Primera", priceGtq: "25.00" }),
    ]);
    expect(found).toEqual({
      ok: true,
      choice: "one",
      garment: garment({
        id: playera,
        sku: "L1-0001",
        title: "Blusa",
        lotNumber: 1,
        lotName: "Primera",
        priceGtq: "25.00",
      }),
    });
    expect(presentGuatemalaScan("sku", [])).toEqual({
      ok: false,
      status: 404,
      error: "No se encontró una prenda con este SKU",
    });

    const repeated = presentGuatemalaScan("sku", [
      garment({ id: playera, sku: "L1-0001", lotNumber: 1, lotName: "Primera" }),
      garment({ id: otra, sku: "L1-0001", lotNumber: 4, lotName: "Segunda", title: "Vestido" }),
    ]);
    expect(repeated.ok && repeated.choice === "many" && repeated.garments).toBeTruthy();
    if (repeated.ok && repeated.choice === "many") {
      expect(repeated.garments.map((item) => item.id)).toEqual([playera, otra]);
      expect(repeated.garments.map((item) => scanLotLabel(item.lotNumber, item.lotName))).toEqual([
        "Lote 1 · Primera",
        "Lote 4 · Segunda",
      ]);
    }

    const store = readFileSync(`${root}/lib/markets/guatemala-inventory-store.ts`, "utf8");
    expect(store).toContain("AND item.sku = ${query.sku}");
  });

  it("no elige solo cuando el mismo SKU está en dos lotes y conserva la prenda sin foto", () => {
    const first = garment({ id: playera, sku: "3001", lotNumber: 3, lotName: "Pacas" });
    const second = garment({ id: otra, sku: "3001", lotNumber: 7, lotName: "Segunda", title: "Vestido" });
    const many = presentGuatemalaScan("sku", [first, second]);
    expect(many).toMatchObject({ ok: true, choice: "many" });
    if (!many.ok || many.choice !== "many") return;
    expect(many.garments.map((item) => scanLotLabel(item.lotNumber, item.lotName))).toEqual([
      "Lote 3 · Pacas",
      "Lote 7 · Segunda",
    ]);
    expect(many.garments.every((item) => item.photo == null)).toBe(true);
    expect(many.garments.every((item) => item.status === "disponible")).toBe(true);

    const withoutPhoto = presentGuatemalaScan("code", [garment({ id: playera, sku: "3001", lotNumber: null, lotName: null })]);
    expect(withoutPhoto).toMatchObject({
      ok: true,
      choice: "one",
      garment: { id: playera, photo: null, status: "disponible" },
    });
    expect(scanLotLabel(null, null)).toBe("Sin lote");
    expect(presentGuatemalaScan("code", [])).toEqual({ ok: false, status: 404, error: QR_MESSAGES.unknownCode });
    expect(QR_MESSAGES.unknownSku).toBe("No se encontró una prenda con este SKU");
  });

  it("no vende al escanear, pide una sola confirmación y rechaza la segunda venta", () => {
    const original = book();
    const found = presentGuatemalaScan("code", [garment({ id: playera, sku: "3001", lotNumber: 3 })]);
    expect(found).toMatchObject({ ok: true, choice: "one", garment: { status: "disponible" } });
    expect(original.sales).toHaveLength(0);
    expect(original.items[0]?.status).toBe("disponible");
    expect(scanSaleDecision("disponible")).toEqual({ canSell: true });
    expect(acceptedSaleUpdate(true, { ok: true, item: { sku: "3001", status: "disponible", sale: null } })).toBeNull();

    const opened = beginScan(releaseScan(), playera);
    expect(opened).toEqual({ code: playera, saving: false });
    expect(beginScan(opened ?? releaseScan(), playera)).toBeNull();
    const saving = beginSale(opened ?? releaseScan());
    expect(saving).toEqual({ code: playera, saving: true });
    expect(beginSale(saving ?? releaseScan())).toBeNull();
    expect(beginScan(saving ?? releaseScan(), otra)).toBeNull();

    const first = applyGuatemalaSale(original, {
      clientId: "tienda",
      itemId: playera,
      chargedPrice: "35",
      clientAllowed: true,
    });
    expect(first.result).toMatchObject({ ok: true, sale: { chargedPriceGtq: "35.00" } });
    expect(scanSaleDecision("vendida")).toEqual({ canSell: false, message: QR_MESSAGES.sold });
    expect(scanSaleDecision("retirada")).toEqual({ canSell: false, message: QR_MESSAGES.withdrawn });
    const second = applyGuatemalaSale(first.book, {
      clientId: "tienda",
      itemId: playera,
      chargedPrice: "35.00",
      clientAllowed: true,
    });
    expect(second.book).toBe(first.book);
    expect(second.result).toMatchObject({ ok: false, status: 409 });
    expect(first.book.sales).toHaveLength(1);
  });

  it("explica el permiso de cámara y la consulta sigue exigiendo sesión", () => {
    const deniedError = { name: "NotAllowedError", message: "Permission denied" };
    const denied = cameraFailureMessage(deniedError);
    expect(denied).toContain("iPhone");
    expect(denied).toContain("Android");
    expect(denied).toContain("SKU");
    expect(cameraMayRetry(deniedError)).toBe(false);
    expect(cameraFailureMessage("camera only works on secure https pages")).toBe(QR_MESSAGES.cameraInsecure);
    expect(cameraMayRetry({ name: "OverconstrainedError" })).toBe(true);

    const route = readFileSync(`${root}/app/api/markets/guatemala/inventory/qr/route.ts`, "utf8");
    expect(route).toContain('authorizeGuatemalaRequest(request, clientId, "read")');
    expect(route).not.toContain("confirmGuatemalaSale");
    const saleRoute = readFileSync(`${root}/app/api/markets/guatemala/inventory/[itemId]/sale/route.ts`, "utf8");
    expect(saleRoute).toContain('authorizeGuatemalaRequest(request, typeof body?.clientId === "string" ? body.clientId : "", "sell")');
    const layout = readFileSync(`${root}/app/guatemala/panel/layout.tsx`, "utf8");
    expect(layout).toContain("Escanear QR");
    expect(layout).toContain("/guatemala/panel/escanear");
    const config = readFileSync(`${root}/next.config.mjs`, "utf8");
    expect(config).toContain("camera=(self)");
    expect(config).not.toContain("camera=()");
  });
});
