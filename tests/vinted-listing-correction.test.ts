import { describe, expect, test } from "vitest";
import {
  confirmPhotoMatchesPreview,
  keptAfterDiscardedSync,
  photoAfterSync,
  planVintedUnlink,
  sameSkuText,
  selectUniqueActiveSkuPhoto,
  skuText,
} from "@/lib/vinted/listing-correction";

const active = {
  sku: "1195",
  title: "Chaqueta de lana",
  photoUrl: "https://i.ebayimg.com/1195.jpg",
  ebayItemId: "111111111111",
  active: true,
};

describe("SKU text matching", () => {
  test("compares the SKU as text and ignores numeric lookalikes", () => {
    expect(skuText(" 1195 ")).toBe("1195");
    expect(skuText(1195)).toBe("");
    expect(sameSkuText("1195", "1195")).toBe(true);
    expect(sameSkuText("1195", "11950")).toBe(false);
    expect(sameSkuText("1195", "01195")).toBe(false);
    expect(sameSkuText("1195", "1195.0")).toBe(false);
    expect(sameSkuText("1195", "1195-A")).toBe(false);
    expect(sameSkuText(1195, "1195")).toBe(false);
    expect(sameSkuText("K75", "k75")).toBe(false);
  });
});

describe("active eBay photo lookup", () => {
  test("returns the only active listing and ignores a sold listing with another photo", () => {
    const record = {
      sku: "1195",
      photoUrl: "https://vinted.example/wrong.jpg",
      url: "https://www.vinted.com/items/900",
    };
    const result = selectUniqueActiveSkuPhoto("1195", [
      { ...active, sku: "1195", title: "Prenda vendida", photoUrl: "https://i.ebayimg.com/sold.jpg", ebayItemId: "333333333333", active: false },
      active,
      { ...active, sku: "11950", title: "Otra talla", photoUrl: "https://i.ebayimg.com/11950.jpg", ebayItemId: "555555555555" },
    ]);
    expect(result).toEqual({
      ok: true,
      match: {
        sku: "1195",
        title: "Chaqueta de lana",
        photoUrl: "https://i.ebayimg.com/1195.jpg",
        ebayItemId: "111111111111",
      },
    });
    expect(record).toEqual({
      sku: "1195",
      photoUrl: "https://vinted.example/wrong.jpg",
      url: "https://www.vinted.com/items/900",
    });
  });

  test("explains when there is no active listing and leaves the record untouched", () => {
    const result = selectUniqueActiveSkuPhoto("1195", [
      { ...active, active: false },
      { ...active, sku: "11950" },
    ]);
    expect(result).toEqual({
      ok: false,
      error: "No hay una publicación activa con el SKU 1195. No se cambió la foto.",
    });
  });

  test("explains when several active listings share the SKU", () => {
    const result = selectUniqueActiveSkuPhoto("1195", [
      active,
      { ...active, title: "Segunda publicación", photoUrl: "https://i.ebayimg.com/other.jpg", ebayItemId: "222222222222" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Hay 2 publicaciones activas con el SKU 1195. No se cambió la foto.");
  });

  test("treats the same active item once", () => {
    const result = selectUniqueActiveSkuPhoto("1195", [active, { ...active }]);
    expect(result.ok).toBe(true);
  });

  test("requires the preview SKU and item id to match as text", () => {
    const match = { sku: "1195", title: "Chaqueta de lana", photoUrl: "https://i.ebayimg.com/1195.jpg", ebayItemId: "111111111111" };
    expect(confirmPhotoMatchesPreview(match, { sku: "1195", ebayItemId: "111111111111" })).toBe(true);
    expect(confirmPhotoMatchesPreview(match, { sku: 1195, ebayItemId: "111111111111" })).toBe(false);
    expect(confirmPhotoMatchesPreview(match, { sku: "1195", ebayItemId: "222222222222" })).toBe(false);
    expect(confirmPhotoMatchesPreview(match, { sku: "11950", ebayItemId: "111111111111" })).toBe(false);
  });
});

describe("unlink the wrong Vinted listing", () => {
  test("keeps the SKU, clears the link, and does not mark the record identified or reviewed", () => {
    const other = { vintedItemId: "other", sku: "42", url: "https://www.vinted.com/items/1" };
    const result = planVintedUnlink({
      sku: "1195",
      url: "https://www.vinted.com/items/900",
      photoUrl: "https://vinted.example/wrong.jpg",
      ebayItemId: "333333333333",
      title: "Prenda equivocada",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.sku).toBe("1195");
    expect(result.next.url).toBe("");
    expect(result.next.status).toBe("unmatched");
    expect(result.next.reviewedAt).toBe("");
    expect(result.next.verifiedAt).toBe("");
    expect(result.next.photoUrl).toBe("https://vinted.example/wrong.jpg");
    expect(result.next.ebayItemId).toBe("333333333333");
    expect(result.next.title).toBe("Prenda equivocada");
    expect(result.next.vintedUnlinked).toBe(true);
    expect(result.next.discardedVintedUrl).toBe("https://www.vinted.com/items/900");
    expect(other).toEqual({ vintedItemId: "other", sku: "42", url: "https://www.vinted.com/items/1" });
  });
});

describe("sync does not restore a discarded Vinted association", () => {
  test("keeps the SKU, the cleared link, and a photo taken from eBay", () => {
    const stored = {
      sku: "1195",
      url: "",
      photoUrl: "https://i.ebayimg.com/1195.jpg",
      status: "unmatched",
      reviewedAt: "",
      vintedUnlinkedAt: "2026-10-25T12:00:00.000Z",
      manualPhotoAt: "2026-10-25T12:05:00.000Z",
    };
    const incoming = {
      url: "https://www.vinted.com/items/900",
      photoUrl: "https://vinted.example/wrong.jpg",
      sku: "8888",
      status: "verified",
    };
    expect(keptAfterDiscardedSync(stored)).toEqual(stored);
    expect(photoAfterSync(stored, incoming.photoUrl, true)).toBe("https://i.ebayimg.com/1195.jpg");
    expect(stored.sku).toBe("1195");
    expect(stored.url).toBe("");
  });

  test("still protects a manual photo when the Vinted link stays", () => {
    expect(
      photoAfterSync(
        { photoUrl: "https://i.ebayimg.com/1195.jpg", manualPhotoAt: "2026-10-25T12:05:00.000Z" },
        "https://vinted.example/wrong.jpg",
        true
      )
    ).toBe("https://i.ebayimg.com/1195.jpg");
    expect(
      photoAfterSync({ photoUrl: "https://vinted.example/old.jpg", manualPhotoAt: "" }, "https://vinted.example/new.jpg", true)
    ).toBe("https://vinted.example/new.jpg");
  });

  test("lets a normal sync proceed when nothing was unlinked", () => {
    expect(keptAfterDiscardedSync({ vintedUnlinkedAt: "", sku: "1195" })).toBeNull();
  });
});
