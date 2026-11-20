import { describe, expect, test } from "vitest";
import type { ListingResult } from "@/lib/types";
import { photosForPreparedSku } from "@/lib/vinted/prepare";
import {
  buildReadySnapshot,
  buildReadySnapshotFromPrepared,
  replaceReadyItem,
  type ReadySnapshot,
} from "@/lib/vinted/snapshot";

function listing(partial: Partial<ListingResult> & { title: string; description: string }): ListingResult {
  return partial as ListingResult;
}

function prepare(sku: string, title: string, description: string, photo: string, extra: Partial<ListingResult> = {}): ReadySnapshot {
  return buildReadySnapshot({
    sku,
    listing: listing({ title, description, ...extra }),
    photos: [{ mediaType: "image/jpeg", data: photo }],
  });
}

describe("one Ready item replaces the previous item", () => {
  test("article B keeps none of article A", () => {
    const alpha = prepare("A-100", "Alpha coat", "Warm alpha coat\nSKU: -A", "photo-alpha", {
      brand: "Nike",
      size: "M",
      color: "Black",
      suggested_price: 25,
      item_type: "coat",
    });
    const beta = prepare("2830", "Diesel jacket", "Blue diesel jacket\nSKU: -A", "photo-diesel", {
      brand: "Diesel",
      size: "L",
      color: "Blue",
      suggested_price: 40,
      item_type: "jacket",
    });

    const current = replaceReadyItem(alpha, beta);

    expect(current.sku).toBe("2830");
    expect(current.title).toBe("Diesel jacket");
    expect(current.description).toBe("Blue diesel jacket\nSKU: 2830");
    expect(current.brand).toBe("Diesel");
    expect(current.size).toBe("L");
    expect(current.color).toBe("Blue");
    expect(current.photos.map((photo) => photo.data)).toEqual(["photo-diesel"]);
    expect(JSON.stringify(current)).not.toMatch(/Alpha|photo-alpha|SKU: -A|Nike/);

    const photos = photosForPreparedSku(
      [
        { sku: alpha.sku, photos: alpha.photos },
        { sku: current.sku, photos: current.photos },
      ],
      current.sku
    );
    expect(photos.map((photo) => photo.data)).toEqual(["photo-diesel"]);
  });

  test("article C keeps none of article B", () => {
    const beta = prepare("2830", "Diesel jacket", "Blue diesel jacket", "photo-diesel", {
      brand: "Diesel",
    });
    const gamma = prepare("K75-C", "Wool scarf", "Soft wool scarf\nSKU: 2830", "photo-scarf", {
      brand: "Uniqlo",
      color: "Red",
    });
    const current = replaceReadyItem(beta, gamma);

    expect(current.sku).toBe("K75-C");
    expect(current.title).toBe("Wool scarf");
    expect(current.description).toBe("Soft wool scarf\nSKU: K75-C");
    expect(current.brand).toBe("Uniqlo");
    expect(current.color).toBe("Red");
    expect(current.photos.map((photo) => photo.data)).toEqual(["photo-scarf"]);
    expect(JSON.stringify(current)).not.toMatch(/Diesel|2830|photo-diesel/);
  });

  test("queue activate rebuilds the ready item from prepared fields and photos", () => {
    const snapshot = buildReadySnapshotFromPrepared({
      prepared: {
        sku: "3146",
        title: "Ready jacket",
        description: "Blue jacket\nSKU: 3146",
        brand: "Diesel",
        category: "Women",
        vintedCategory: "Women / Outerwear",
        size: "M",
        color: "Blue",
        condition: "Good",
        price: "28.00",
      },
      photos: [
        { mediaType: "image/jpeg", data: "photo-a" },
        { mediaType: "image/jpeg", data: "photo-b" },
        { mediaType: "image/jpeg", data: "photo-c" },
      ],
    });
    expect(snapshot.sku).toBe("3146");
    expect(snapshot.category).toBe("Women / Outerwear");
    expect(snapshot.photos.map((photo) => photo.data)).toEqual(["photo-a", "photo-b", "photo-c"]);
  });
});
