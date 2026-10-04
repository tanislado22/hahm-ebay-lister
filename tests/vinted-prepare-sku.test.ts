import { describe, expect, test } from "vitest";
import { buildSku, skuForVintedPrepare } from "@/lib/sku";
import { descriptionWithRealSku, photosForPreparedSku, prepareVintedFields } from "@/lib/vinted/prepare";
import type { ListingResult } from "@/lib/types";

const listing = {
  title: "Diesel jacket",
  description: "Blue Diesel jacket\nSKU: -A",
} as ListingResult;

describe("Prepare for Vinted uses the selected item SKU", () => {
  test("stores sku 2830 and finds that item's photos", () => {
    const selectedSku = skuForVintedPrepare("2830");
    const ready = prepareVintedFields(selectedSku, listing);
    const latestSku = selectedSku;

    expect(selectedSku).toBe("2830");
    expect(ready.sku).toBe("2830");
    expect(latestSku).toBe("2830");
    expect(ready.description).toBe("Blue Diesel jacket\nSKU: 2830");
    expect(descriptionWithRealSku(listing.description, selectedSku).endsWith("SKU: 2830")).toBe(true);

    const photos = photosForPreparedSku(
      [
        { sku: "-A", photos: [{ data: "nike-photo" }] },
        { sku: "2830", photos: [{ data: "diesel-photo" }, { data: "" }] },
      ],
      latestSku
    );
    expect(photos.map((photo) => photo.data)).toEqual(["diesel-photo"]);
  });

  test("does not turn a blank SKU into -A", () => {
    expect(skuForVintedPrepare("")).toBe("");
    expect(skuForVintedPrepare("   ")).toBe("");
    expect(buildSku("", 0)).toBe("A");
    expect(buildSku("", 0)).not.toBe("-A");
  });

  test("keeps any other selected SKU unchanged", () => {
    expect(skuForVintedPrepare(" K75-B ")).toBe("K75-B");
    const ready = prepareVintedFields(skuForVintedPrepare(" K75-B "), listing);
    expect(ready.sku).toBe("K75-B");
    expect(ready.description.endsWith("SKU: K75-B")).toBe(true);
  });
});
