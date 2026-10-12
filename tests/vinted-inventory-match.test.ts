import { describe, expect, test } from "vitest";
import { cleanVintedCard, ebayItemUrl, sizesEquivalent } from "@/lib/vinted/card-text";
import {
  matchVintedListing,
  mergeOwnEbayCandidates,
  reserveUniqueSkus,
  skuFromStoredText,
  uniqueVerifiedVintedUrl,
  parseInventoryImport,
  parseVintedItemLink,
  prepareCollectedItem,
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

  test("verifies a listed SKU only when the title agrees and keeps conflicts for review", () => {
    const agreed = matchVintedListing(
      {
        vintedItemId: "5",
        title: coat.ebayTitle,
        url: "https://www.vinted.com/items/5",
        photoUrl: "",
        brand: "",
        size: "",
        listedSku: skuFromStoredText("SKU: 2443"),
      },
      [coat, other]
    );
    expect(agreed).toMatchObject({ status: "verified", sku: "2443" });

    const differentTitle = matchVintedListing(
      {
        vintedItemId: "5b",
        title: "Different title",
        url: "https://www.vinted.com/items/5",
        photoUrl: "",
        brand: "",
        size: "",
        listedSku: "2443",
      },
      [coat, other]
    );
    expect(differentTitle).toMatchObject({ status: "review", sku: "", suggestedSku: "2443" });

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

  test("does not assign one SKU to several Vinted listings", () => {
    const match = { status: "verified" as const, sku: "2443", suggestedSku: "", title: coat.ebayTitle, ebayItemId: "123456789012", detail: "", candidates: [] };
    const reserved = reserveUniqueSkus(
      [
        { id: "a", match },
        { id: "b", match: { ...match } },
      ],
      ["2443"]
    );
    expect(reserved.every((row) => row.match.status === "review" && row.match.sku === "")).toBe(true);
    expect(reserved[0].match.suggestedSku).toBe("2443");
  });

  test("does not treat the same brand alone as an identification", () => {
    const result = matchVintedListing(
      {
        vintedItemId: "11",
        title: "Another Levi jacket",
        url: "https://www.vinted.com/items/11",
        photoUrl: "",
        brand: "Levi's",
        size: "",
      },
      [coat, { ...coat, sku: "3001", ebayTitle: "Levi's trucker jacket", size: "L" }]
    );
    expect(result.status).not.toBe("verified");
    expect(result.sku).toBe("");
  });

  test("links a unique contained title to the seller item and keeps two similar listings for review", () => {
    const linked = matchVintedListing(
      { vintedItemId: "7", title: coat.ebayTitle, url: "https://www.vinted.com/items/7", photoUrl: "", brand: "", size: "" },
      [{ ...coat, ebayItemId: "123456789012" }]
    );
    expect(linked).toMatchObject({ status: "verified", sku: "2443", ebayItemId: "123456789012" });
    expect(ebayItemUrl(linked.ebayItemId)).toBe("https://www.ebay.com/itm/123456789012");

    const contained = matchVintedListing(
      { vintedItemId: "8", title: "Levi's 550 Jeans", url: "https://www.vinted.com/items/8", photoUrl: "", brand: "", size: "" },
      [{ ...coat, ebayItemId: "123456789012", photoUrl: "https://i.ebayimg.com/jeans.jpg" }]
    );
    expect(contained).toMatchObject({ status: "verified", sku: "2443", ebayItemId: "123456789012" });
    expect(contained.candidates[0]).toMatchObject({ sku: "2443", photoUrl: "https://i.ebayimg.com/jeans.jpg" });
    expect(ebayItemUrl(contained.ebayItemId)).toBe("https://www.ebay.com/itm/123456789012");

    const ambiguous = matchVintedListing(
      { vintedItemId: "8b", title: "Levi's 550 Jeans", url: "https://www.vinted.com/items/8b", photoUrl: "", brand: "", size: "" },
      [
        { ...coat, ebayItemId: "123456789012" },
        { ...coat, sku: "2444", ebayTitle: "Levi's 550 Jeans Mens 36x30 Black", ebayItemId: "123456789013" },
      ]
    );
    expect(ambiguous.status).toBe("review");
    expect(ambiguous.sku).toBe("");
    expect(ambiguous.ebayItemId).toBe("");
    expect(ambiguous.candidates.map((candidate) => candidate.sku).sort()).toEqual(["2443", "2444"]);
  });

  test("uses only the live seller catalog and ignores stored listings that are not active", () => {
    const live = [{ ...coat, ebayItemId: "123456789012", brand: "" }];
    const stored = [other, { ...coat, brand: "Levi's", photoUrl: "https://i.ebayimg.com/stored.jpg" }];
    const merged = mergeOwnEbayCandidates(live, stored);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ sku: "2443", brand: "Levi's", photoUrl: "https://i.ebayimg.com/stored.jpg" });
    expect(merged.some((candidate) => candidate.sku === "2503")).toBe(false);
  });

  test("keeps the original Vinted title without price, size, or condition", () => {
    const prepared = prepareCollectedItem({
      vintedItemId: "9",
      title: "Nike Air Max",
      cardText: "Nike Air Max\nYM\n$20.00\nVery good",
      url: "https://www.vinted.com/items/9",
      photoUrl: "",
      brand: "",
      size: "",
    });
    expect(prepared.title).toBe("Nike Air Max");
    expect(prepared.size).toBe("YM");
    expect(prepared.title).not.toMatch(/\$|Very good|YM/);
    expect(cleanVintedCard("Gap Tee\nMedium\n€15,00\nGood").title).toBe("Gap Tee");
  });

  test("treats YM as Youth Medium and not as an adult medium", () => {
    expect(sizesEquivalent("YM", "Youth Medium")).toBe(true);
    expect(sizesEquivalent("YM", "M")).toBe(false);
    expect(sizesEquivalent("M", "Medium")).toBe(true);
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
    expect(VINTED_SYNC_PILOT_LIMIT).toBe(30);
  });

  test("includes one verified Vinted url and withholds the link when several differ", () => {
    expect(uniqueVerifiedVintedUrl([" https://www.vinted.com/items/1 ", "https://www.vinted.com/items/1"])).toBe(
      "https://www.vinted.com/items/1"
    );
    expect(
      uniqueVerifiedVintedUrl(["https://www.vinted.com/items/1", "https://www.vinted.com/items/2"])
    ).toBeNull();
    expect(uniqueVerifiedVintedUrl([])).toBeNull();
  });
});
