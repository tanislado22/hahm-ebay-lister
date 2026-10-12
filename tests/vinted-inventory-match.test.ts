import { describe, expect, test } from "vitest";
import {
  matchVintedListing,
  parseInventoryImport,
  parseVintedItemLink,
  VINTED_SYNC_PILOT_LIMIT,
  type EbayInventoryCandidate,
} from "@/lib/vinted/inventory-match";

const coat: EbayInventoryCandidate = {
  sku: "2443",
  ebayTitle: "Levi's 550 Jeans Mens 34x29 Blue Relaxed Fit",
  vintedTitle: "",
  brand: "Levi's",
  size: "34",
  photoUrl: "",
};

const other: EbayInventoryCandidate = {
  sku: "2503",
  ebayTitle: "Navy Wool Coat",
  vintedTitle: "Navy Wool Coat",
  brand: "Gap",
  size: "M",
  photoUrl: "https://images.example/coat.jpg",
};

describe("vinted inventory matching", () => {
  test("verifies one exact title and does not guess when two titles match", () => {
    expect(
      matchVintedListing(
        { vintedItemId: "1", title: coat.ebayTitle, url: "https://www.vinted.com/items/1", photoUrl: "", brand: "", size: "" },
        [coat, other]
      )
    ).toMatchObject({ status: "verified", sku: "2443" });

    const ambiguous = matchVintedListing(
      { vintedItemId: "2", title: coat.ebayTitle, url: "https://www.vinted.com/items/2", photoUrl: "", brand: "", size: "" },
      [coat, { ...coat, sku: "2444" }]
    );
    expect(ambiguous.status).toBe("review");
    expect(ambiguous.sku).toBe("");
  });

  test("keeps a different title for review even when brand and size match one item", () => {
    const result = matchVintedListing(
      {
        vintedItemId: "3",
        title: "Blue jeans",
        url: "https://www.vinted.com/items/3",
        photoUrl: "",
        brand: "Levi's",
        size: "34",
      },
      [coat, other]
    );
    expect(result).toMatchObject({ status: "review", sku: "", suggestedSku: "2443" });
  });

  test("verifies a unique listed SKU and sends a conflicting title to review", () => {
    const unique = matchVintedListing(
      {
        vintedItemId: "5",
        title: "Different title",
        url: "https://www.vinted.com/items/5",
        photoUrl: "",
        brand: "",
        size: "",
        listedSku: "2443",
      },
      [coat, other]
    );
    expect(unique).toMatchObject({ status: "verified", sku: "2443" });

    const conflict = matchVintedListing(
      {
        vintedItemId: "6",
        title: other.ebayTitle,
        url: "https://www.vinted.com/items/6",
        photoUrl: "",
        brand: "",
        size: "",
        listedSku: "2443",
      },
      [coat, other]
    );
    expect(conflict.status).toBe("review");
    expect(conflict.sku).toBe("");
  });

  test("leaves an item unmatched when nothing identifies it", () => {
    expect(
      matchVintedListing(
        { vintedItemId: "4", title: "Red scarf", url: "https://www.vinted.com/items/4", photoUrl: "", brand: "Nike", size: "S" },
        [coat]
      ).status
    ).toBe("unmatched");
  });

  test("reads a vinted item link and a ten-row import", () => {
    expect(parseVintedItemLink("https://www.vinted.com/items/178425031509-blue-jeans?ref=closet")).toEqual({
      vintedItemId: "178425031509",
      url: "https://www.vinted.com/items/178425031509-blue-jeans",
    });
    const csv = ["title,url,id", ...Array.from({ length: 12 }, (_, index) => `Coat ${index},https://www.vinted.com/items/${index + 1}-coat,`)].join("\n");
    const items = parseInventoryImport(csv);
    expect(items).toHaveLength(12);
    expect(items[0].vintedItemId).toBe("1");
    expect(VINTED_SYNC_PILOT_LIMIT).toBe(10);
  });
});
