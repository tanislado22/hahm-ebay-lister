import { describe, expect, it } from "vitest";
import {
  applyGuatemalaSale,
  guatemalaInventoryStatusLabel,
  inventoryListFilter,
  isPendingPublication,
  isSoldWithoutPublishing,
  prepareDraftUpdate,
  prepareUnpublishedItem,
  UNPUBLISHED_ITEM_TYPES,
} from "@/lib/markets/guatemala-inventory";

describe("artículos sin fotos de Tienda Guatemala", () => {
  it("guarda sku, tipo, talla, precio y lote sin exigir fotos", () => {
    const saved = prepareUnpublishedItem({
      clientId: "tienda",
      sku: " L1-9 ",
      itemType: "blusa",
      size: " M ",
      price: "80",
      lotId: " lote-1 ",
    });
    expect(saved.ok && saved.item).toEqual({
      clientId: "tienda",
      sku: "L1-9",
      itemType: "blusa",
      title: "Blusa",
      size: "M",
      priceGtq: "80.00",
      lotId: "lote-1",
    });
    expect(UNPUBLISHED_ITEM_TYPES.slice(0, 5).map((type) => type.label)).toEqual([
      "Blusa",
      "Pantalón",
      "Zapatos",
      "Gorra",
      "Cartera",
    ]);
    expect(prepareUnpublishedItem({ clientId: "tienda", sku: "L1-9", itemType: "gorra", price: "25", lotId: "lote-1" }).ok).toBe(
      true
    );
    expect(prepareUnpublishedItem({ clientId: "tienda", sku: "", itemType: "blusa", price: "10", lotId: "lote-1" }).ok).toBe(
      false
    );
    expect(prepareUnpublishedItem({ clientId: "tienda", sku: "L1-9", itemType: "mesa", price: "10", lotId: "lote-1" }).ok).toBe(
      false
    );
    expect(prepareUnpublishedItem({ clientId: "tienda", sku: "L1-9", itemType: "blusa", price: "0", lotId: "lote-1" }).ok).toBe(
      false
    );
    expect(prepareUnpublishedItem({ clientId: "tienda", sku: "L1-9", itemType: "blusa", price: "10", lotId: "" }).ok).toBe(
      false
    );
  });

  it("distingue la pendiente de publicar de la vendida sin publicar", () => {
    const pending = { status: "disponible", published: false };
    const sold = { status: "vendida", published: false };
    expect(isPendingPublication(pending)).toBe(true);
    expect(isPendingPublication(sold)).toBe(false);
    expect(isSoldWithoutPublishing(sold)).toBe(true);
    expect(isSoldWithoutPublishing(pending)).toBe(false);
    expect(guatemalaInventoryStatusLabel("disponible", false)).toBe("Disponible · Sin publicar");
    expect(guatemalaInventoryStatusLabel("vendida", false)).toBe("Vendida · Sin publicar");
    expect(guatemalaInventoryStatusLabel("disponible", true)).toBe("Disponible");
    expect(inventoryListFilter("pendientes")).toBe("pendientes");
  });

  it("permite vender una prenda que nunca se publicó", () => {
    const book = {
      items: [
        {
          id: "blusa-1",
          clientId: "tienda",
          sku: "L1-9",
          priceGtq: "80.00",
          status: "disponible" as const,
          photos: [],
        },
      ],
      sales: [],
    };
    const sold = applyGuatemalaSale(book, {
      clientId: "tienda",
      itemId: "blusa-1",
      chargedPrice: "75",
      clientAllowed: true,
    });
    expect(sold.result.ok).toBe(true);
    const item = sold.book.items[0];
    expect(item?.status).toBe("vendida");
    expect(isPendingPublication({ status: item?.status ?? "", published: false })).toBe(false);
    expect(isSoldWithoutPublishing({ status: item?.status ?? "", published: false })).toBe(true);
    expect(guatemalaInventoryStatusLabel(item?.status ?? "", false)).toBe("Vendida · Sin publicar");
  });

  it("deja completar los datos y exige fotos solo para publicar", () => {
    const draft = prepareDraftUpdate({
      title: "Blusa azul",
      description: "",
      brand: "",
      size: "M",
      condition: "",
      price: "90",
      photos: [],
    });
    expect(draft.ok && draft.draft.photos).toEqual([]);
    expect(draft.ok && draft.draft.priceGtq).toBe("90.00");
    const withPhoto = prepareDraftUpdate({
      title: "Blusa azul",
      price: "90",
      photos: [{ mediaType: "image/jpeg", data: "foto" }],
    });
    expect(withPhoto.ok && withPhoto.draft.photos).toHaveLength(1);
    expect(prepareDraftUpdate({ title: "", price: "90", photos: [] }).ok).toBe(false);
  });
});
