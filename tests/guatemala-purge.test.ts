import { describe, expect, it } from "vitest";
import { applyGuatemalaPurge, purgeConfirmText, type PurgeGarment } from "@/lib/markets/guatemala-purge";
import { decideGuatemalaAccess } from "@/lib/markets/guatemala-staff";

const TIENDA = "0d605a78-f474-49d8-a235-cca831d694be";
const OTHER = "e5e689b6-563d-4c99-8a39-e82686f6c9b8";

function garment(partial: Partial<PurgeGarment> & Pick<PurgeGarment, "id" | "sku">): PurgeGarment {
  return {
    clientId: TIENDA,
    title: partial.sku,
    status: "vendida",
    priceGtq: "30.00",
    suggested: false,
    photos: [{ id: `foto-${partial.id}`, position: 0 }],
    sales: [],
    corrections: [],
    ...partial,
  };
}

describe("eliminación de artículos de prueba de Tienda Guatemala", () => {
  const shirt3001 = garment({
    id: "prenda-3001",
    sku: "3001",
    status: "disponible",
    priceGtq: "30.00",
    title: "Playera de inventario",
    photos: [
      { id: "foto-3001-a", position: 0 },
      { id: "foto-3001-b", position: 1 },
    ],
  });
  const shirt3002 = garment({
    id: "prenda-3002",
    sku: "3002",
    suggested: true,
    sales: [
      {
        id: "venta-3002",
        sku: "3002",
        publishedPriceGtq: "30.00",
        chargedPriceGtq: "15.00",
        currentChargedPriceGtq: null,
        soldAt: "2026-10-16T18:00:00.000Z",
        isTest: true,
        voidedAt: null,
        soldByRole: "propietario",
        soldByUsername: null,
      },
    ],
  });
  const prueba1 = garment({
    id: "prenda-prueba1",
    sku: "prueba1",
    priceGtq: "40.00",
    suggested: true,
    sales: [
      {
        id: "venta-prueba1",
        sku: "prueba1",
        publishedPriceGtq: "40.00",
        chargedPriceGtq: "20.00",
        currentChargedPriceGtq: null,
        soldAt: "2026-10-17T09:22:40.000Z",
        isTest: true,
        voidedAt: null,
        soldByRole: "propietario",
        soldByUsername: null,
      },
    ],
    corrections: [
      {
        id: "corr-prueba1",
        saleId: "venta-prueba1",
        action: "corregir",
        previousChargedPriceGtq: "20.00",
        newChargedPriceGtq: "18.00",
        reason: "Ajuste de prueba",
        createdAt: "2026-10-17T12:00:00.000Z",
        actorRole: "propietario",
      },
    ],
  });
  const other = garment({ id: "prenda-ajena", sku: "3001", clientId: OTHER, status: "disponible" });
  const book = [shirt3001, shirt3002, prueba1, other];

  it("exige el texto exacto y no toca 3001 ni otra tienda", () => {
    const phrase = purgeConfirmText([shirt3002, prueba1]);
    expect(phrase).toBe("ELIMINAR 3002, prueba1");
    const removed = applyGuatemalaPurge(book, {
      owner: true,
      clientId: TIENDA,
      itemIds: [shirt3002.id, prueba1.id],
      confirmText: phrase,
      expected: { garments: 2, photos: 2, sales: 2, corrections: 1 },
      actor: { role: "propietario", accountId: null, username: null },
    });
    expect(removed.result.ok).toBe(true);
    expect(removed.garments.map((garment) => garment.id)).toEqual(["prenda-3001", "prenda-ajena"]);
    expect(removed.garments[0]).toBe(shirt3001);
    expect(removed.garments[1]).toBe(other);

    const wrong = applyGuatemalaPurge(book, {
      owner: true,
      clientId: TIENDA,
      itemIds: [shirt3002.id],
      confirmText: "ELIMINAR",
      expected: { garments: 1, photos: 1, sales: 1, corrections: 0 },
    });
    expect(wrong.garments).toHaveLength(4);
    expect(wrong.result).toMatchObject({ ok: false, status: 400 });
  });

  it("niega la eliminación al encargado aunque también tenga el acceso del propietario", () => {
    const denied = applyGuatemalaPurge(book, {
      owner: false,
      clientId: TIENDA,
      itemIds: [shirt3002.id],
      confirmText: "ELIMINAR 3002",
      expected: { garments: 1, photos: 1, sales: 1, corrections: 0 },
      actor: { role: "encargado", accountId: "cuenta-1", username: "ana" },
    });
    expect(denied.garments).toEqual(book);
    expect(denied.result).toMatchObject({ ok: false, status: 403 });
    expect(
      decideGuatemalaAccess({
        owner: true,
        staffPanel: true,
        account: {
          id: "cuenta-1",
          clientId: TIENDA,
          username: "ana",
          active: true,
          sessionGeneration: 1,
          deactivatedAt: null,
        },
        session: { accountId: "cuenta-1", sessionGeneration: 1, expiresAt: "2026-10-31T00:00:00.000Z" },
        requestedClientId: TIENDA,
        action: "purge",
        now: new Date("2026-10-17T18:00:00.000Z"),
      })
    ).toMatchObject({ ok: false, status: 403, error: "No puedes eliminar prendas del inventario." });
  });
});
