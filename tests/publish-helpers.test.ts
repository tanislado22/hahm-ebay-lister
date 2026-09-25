import { describe, expect, test } from "vitest";
import { buildAspects, sanitizeEbayImageUrls, validListingPrice } from "@/lib/ebay/publish";
import { prioritizeAspects } from "@/lib/ebay/aspectFill";
import type { AspectMeta } from "@/lib/ebay/taxonomy";
import type { ListingResult } from "@/lib/types";

describe("validListingPrice", () => {
  test("passes real prices through unchanged — no 18% markup", () => {
    expect(validListingPrice(20)).toBe(20);
    expect(validListingPrice("49.99")).toBe(49.99);
    expect(validListingPrice(100)).toBe(100);
  });

  test("rounds to cents", () => {
    expect(validListingPrice(19.999)).toBe(20);
  });

  test("missing/invalid prices block publish instead of becoming $35.39", () => {
    expect(validListingPrice(undefined)).toBeNull();
    expect(validListingPrice(0)).toBeNull();
    expect(validListingPrice(-5)).toBeNull();
    expect(validListingPrice("")).toBeNull();
    expect(validListingPrice("abc")).toBeNull();
  });
});

describe("buildAspects", () => {
  const listing = (over: Partial<ListingResult> = {}): ListingResult => ({
    title: "Vintage Carhartt Jacket",
    description: "d",
    ...over,
  });

  test("maps Size, Color, and Gender from structured listing fields", () => {
    const aspects = buildAspects(
      listing({
        size: "L",
        color: ["Black", "Red"],
        category: "mens_coat",
        brand: "Carhartt",
        item_type: "Jacket",
      }),
      "mens_coat"
    );
    expect(aspects.Size).toEqual(["L"]);
    expect(aspects.Color).toEqual(["Black", "Red"]);
    expect(aspects.Gender).toEqual(["Men"]);
    expect(aspects.Department).toEqual(["Men"]);
  });

  test("canonicalizes lowercase item_specifics into Size/Color/Gender", () => {
    const aspects = buildAspects(
      listing({
        item_specifics: { size: "M", color: "Navy", gender: "Women's" },
      }),
      "womens_top"
    );
    expect(aspects.Size).toEqual(["M"]);
    expect(aspects.Color).toEqual(["Navy"]);
    expect(aspects.Gender).toEqual(["Women"]);
    expect(aspects.Department).toEqual(["Women"]);
  });

  test("structured listing size/color win over item_specifics", () => {
    const aspects = buildAspects(
      listing({
        size: "XL",
        color: "Green",
        item_specifics: { Size: "S", Color: "Blue" },
      }),
      "mens_top"
    );
    expect(aspects.Size).toEqual(["XL"]);
    expect(aspects.Color).toEqual(["Green"]);
  });

  test("derives Gender from womens_/mens_ category when missing", () => {
    const women = buildAspects(listing({ size: "8", color: "Tan" }), "womens_dress");
    expect(women.Gender).toEqual(["Women"]);
    const men = buildAspects(listing({ size: "32x30", color: "Indigo" }), "mens_jeans");
    expect(men.Gender).toEqual(["Men"]);
  });
});

describe("prioritizeAspects", () => {
  const meta = (name: string, usage: AspectMeta["usage"]): AspectMeta => ({
    name,
    required: usage === "REQUIRED",
    usage,
    mode: "FREE_TEXT",
    cardinality: "SINGLE",
    values: [],
  });

  test("required aspects come first, then recommended, then optional", () => {
    const sorted = prioritizeAspects([
      meta("Opt1", "OPTIONAL"),
      meta("Rec1", "RECOMMENDED"),
      meta("Req1", "REQUIRED"),
      meta("Opt2", "OPTIONAL"),
      meta("Rec2", "RECOMMENDED"),
    ]);
    expect(sorted.map((a) => a.usage)).toEqual([
      "REQUIRED",
      "RECOMMENDED",
      "RECOMMENDED",
      "OPTIONAL",
      "OPTIONAL",
    ]);
    // Stable within a tier.
    expect(sorted.map((a) => a.name)).toEqual(["Req1", "Rec1", "Rec2", "Opt1", "Opt2"]);
  });
});

describe("sanitizeEbayImageUrls", () => {
  const eps = (n: number) => `https://i.ebayimg.com/00/s/MTYwMFgxMjAw/z/pic${n}.jpg`;

  test("accepts https eBay Picture Services URLs, preserving order", () => {
    const urls = [eps(1), eps(2), eps(3)];
    expect(sanitizeEbayImageUrls(urls)).toEqual(urls);
  });

  test("rejects non-eBay hosts, plain http, and junk", () => {
    expect(
      sanitizeEbayImageUrls([
        "https://evil.example.com/pic.jpg",
        "http://i.ebayimg.com/insecure.jpg",
        "https://notebayimg.com/pic.jpg",
        "https://fakeebayimg.com.evil.net/pic.jpg",
        "not a url",
        42,
        null,
      ])
    ).toEqual([]);
  });

  test("dedupes and caps at eBay's 12-photo limit", () => {
    const urls = Array.from({ length: 15 }, (_, i) => eps(i));
    expect(sanitizeEbayImageUrls(urls)).toHaveLength(12);
    expect(sanitizeEbayImageUrls([eps(1), eps(1), eps(2)])).toEqual([eps(1), eps(2)]);
  });

  test("non-array input yields no URLs", () => {
    expect(sanitizeEbayImageUrls(undefined)).toEqual([]);
    expect(sanitizeEbayImageUrls("https://i.ebayimg.com/x.jpg")).toEqual([]);
  });
});
