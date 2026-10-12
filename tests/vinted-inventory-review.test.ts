import { describe, expect, test } from "vitest";
import { classifySoldListing, findPossibleDuplicates, type KnownSale } from "@/lib/vinted/inventory-review";

const photo = "https://images.vinted.net/closet/coat.jpg?s=1";

function listing(id: string, sku: string, title: string, photoUrl = "") {
  return { vintedItemId: id, sku, title, photoUrl };
}

describe("vinted duplicate review", () => {
  test("groups the same SKU or the same title and photo, and ignores brand, size, or title alone", () => {
    const groups = findPossibleDuplicates(
      [
        listing("1", "2443", "Blue coat", photo),
        listing("2", "2443", "Other coat", "https://images.vinted.net/other.jpg"),
        listing("3", "", "Blue coat", photo),
        listing("4", "", "Blue coat", "https://images.vinted.net/different.jpg"),
        listing("5", "", "Blue coat", ""),
      ],
      []
    );
    expect(groups).toEqual([
      { reason: "sku", itemIds: ["1", "2"] },
      { reason: "title-photo", itemIds: ["1", "3"] },
    ]);
  });

  test("drops a pair the user marked as different items", () => {
    const groups = findPossibleDuplicates(
      [listing("1", "2443", "Blue coat", photo), listing("2", "2443", "Blue coat", photo)],
      [["2", "1"]]
    );
    expect(groups).toEqual([]);
  });
});

describe("sold listings still active on vinted", () => {
  const sale: KnownSale = { platform: "ebay", sku: "2443", title: "Blue coat", soldAt: "2026-10-11T12:00:00.000Z" };

  test("marks one verified listing pending removal and leaves several listings for review", () => {
    expect(classifySoldListing({ sku: "2443", title: "Blue coat", listingsWithSku: 1, sales: [sale] })).toMatchObject({
      soldStatus: "pending_removal",
      platform: "ebay",
    });
    expect(classifySoldListing({ sku: "2443", title: "Blue coat", listingsWithSku: 2, sales: [sale] }).soldStatus).toBe("review");
  });

  test("does not treat a title-only sale or the absence of a sale as a confirmed sold listing", () => {
    const titleOnly: KnownSale = { platform: "depop", sku: "", title: "Blue coat", soldAt: "2026-10-11T12:00:00.000Z" };
    expect(classifySoldListing({ sku: "", title: "Blue coat", listingsWithSku: 0, sales: [titleOnly] }).soldStatus).toBe("review");
    expect(classifySoldListing({ sku: "2443", title: "Blue coat", listingsWithSku: 1, sales: [] }).soldStatus).toBe("");
  });
});
