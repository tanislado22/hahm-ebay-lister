import { describe, expect, test } from "vitest";
import {
  cleanAspectValue,
  clipAspectValue,
  enforceCardinality,
  isPlaceholderValue,
  matchAllowed,
  splitAspectValues,
  canonicalizeAspectKeys,
  sanitizeCategorySizes,
} from "@/lib/ebay/aspects";
import type { AspectMeta } from "@/lib/ebay/taxonomy";

const meta = (over: Partial<AspectMeta>): AspectMeta => ({
  name: "X",
  required: false,
  usage: "OPTIONAL",
  mode: "FREE_TEXT",
  cardinality: "SINGLE",
  values: [],
  ...over,
});

describe("isPlaceholderValue", () => {
  test.each([
    "See tag in photos",
    "See listing photos for measurements",
    "Unknown",
    "unknown material",
    "N/A",
    "n/a",
    "Not visible",
    "not shown",
    "TBD",
    "check photos",
    "-",
    "???",
    "",
    "  ",
  ])("flags %j as placeholder", (v) => {
    expect(isPlaceholderValue(v)).toBe(true);
  });

  test.each([
    "Cotton",
    "Ralph Lauren",
    "Sterling Silver",
    "No Hood",
    "Multicolor",
    "Nylon blend",
    // Real values that a sloppier regex once flagged:
    "See by Chloé",
    "Check Print",
    "Not Rated",
  ])("keeps real value %j", (v) => {
    expect(isPlaceholderValue(v)).toBe(false);
  });
});

describe("cleanAspectValue", () => {
  test("empties placeholder phrases", () => {
    expect(cleanAspectValue("See tag in photos")).toBe("");
  });
  test("clips long values at word boundary", () => {
    const long = "word ".repeat(30).trim();
    expect(cleanAspectValue(long).length).toBeLessThanOrEqual(65);
  });
  test("respects a per-aspect max length", () => {
    expect(cleanAspectValue("A".repeat(40), 30).length).toBeLessThanOrEqual(30);
  });
});

describe("splitAspectValues", () => {
  test("keeps every part of a compound material", () => {
    expect(splitAspectValues("Cotton / Polyester")).toEqual(["Cotton", "Polyester"]);
  });
  test("splits ampersand colors", () => {
    expect(splitAspectValues("Black & White")).toEqual(["Black", "White"]);
  });
  test("splits comma lists", () => {
    expect(splitAspectValues("Casual, Travel, Workwear")).toEqual([
      "Casual",
      "Travel",
      "Workwear",
    ]);
  });
  test("splits on ' and ' but not inside words", () => {
    expect(splitAspectValues("Sandals")).toEqual(["Sandals"]);
    expect(splitAspectValues("Red and Blue")).toEqual(["Red", "Blue"]);
  });
  test("flattens arrays and dedupes case-insensitively", () => {
    expect(splitAspectValues(["Red", "red", "Blue"])).toEqual(["Red", "Blue"]);
  });
  test("drops placeholder parts", () => {
    expect(splitAspectValues("Unknown")).toEqual([]);
  });
  test.each(["AC/DC", "H&M", "Texas A&M", "9 1/2", "S/M"])(
    "never shreds names/sizes with short fragments: %j stays whole",
    (v) => {
      expect(splitAspectValues(v)).toEqual([v]);
    }
  );
});

describe("enforceCardinality", () => {
  test("MULTI aspects keep several values, SINGLE collapse to first", () => {
    const aspects: Record<string, string[]> = {
      Material: ["Cotton", "Polyester"],
      Color: ["Black", "White"],
      Mystery: ["A", "B"],
    };
    enforceCardinality(aspects, [
      meta({ name: "Material", cardinality: "MULTI" }),
      meta({ name: "Color", cardinality: "SINGLE" }),
    ]);
    expect(aspects.Material).toEqual(["Cotton", "Polyester"]);
    expect(aspects.Color).toEqual(["Black"]);
    // Unknown to eBay's schema — MULTI can't be proven safe.
    expect(aspects.Mystery).toEqual(["A"]);
  });

  test("Features stays multi-value even when absent from the schema", () => {
    const aspects: Record<string, string[]> = { Features: ["Pockets", "Lined"] };
    enforceCardinality(aspects, []);
    expect(aspects.Features).toEqual(["Pockets", "Lined"]);
  });
});

describe("matchAllowed", () => {
  test("case-insensitive with singular/plural tolerance", () => {
    expect(matchAllowed("unisex adult", ["Unisex Adults", "Men"])).toBe("Unisex Adults");
  });
  test("null when nothing matches", () => {
    expect(matchAllowed("Purple", ["Red", "Blue"])).toBeNull();
  });
});

describe("sanitizeCategorySizes", () => {
  const womensTop = [
    meta({
      name: "Size",
      mode: "SELECTION_ONLY",
      values: ["XS", "S", "M", "L", "XL", "8", "10"],
    }),
    meta({ name: "Color", values: ["Black", "Red"] }),
  ];

  test("drops a fraction size that is not in the category list", () => {
    const aspects: Record<string, string[]> = { Size: ["7/8"], Color: ["Black"] };
    expect(sanitizeCategorySizes(aspects, womensTop)).toEqual(["Size"]);
    expect(aspects.Size).toBeUndefined();
    expect(aspects.Color).toEqual(["Black"]);
  });

  test("keeps a size the category actually allows, including word aliases", () => {
    const aspects: Record<string, string[]> = { Size: ["Large"] };
    expect(sanitizeCategorySizes(aspects, womensTop)).toEqual([]);
    expect(aspects.Size).toEqual(["L"]);
  });

  test("keeps 7/8 only when this category lists it", () => {
    const kids = [
      meta({ name: "Size", mode: "SELECTION_ONLY", values: ["6", "7/8", "10"] }),
    ];
    const aspects: Record<string, string[]> = { Size: ["7/8"] };
    expect(sanitizeCategorySizes(aspects, kids)).toEqual([]);
    expect(aspects.Size).toEqual(["7/8"]);
  });

  test("removes size aspects that belong to a different garment", () => {
    const aspects: Record<string, string[]> = {
      Size: ["M"],
      "Ring Size": ["7"],
      "Shoe Size": ["8"],
    };
    const dropped = sanitizeCategorySizes(aspects, womensTop);
    expect(dropped.sort()).toEqual(["Ring Size", "Shoe Size"]);
    expect(aspects.Size).toEqual(["M"]);
    expect(aspects["Ring Size"]).toBeUndefined();
    expect(aspects["Shoe Size"]).toBeUndefined();
  });

  test("drops a bare fraction when the category schema is unavailable", () => {
    const aspects: Record<string, string[]> = { Size: ["7/8"], "Waist Size": ["32"] };
    expect(sanitizeCategorySizes(aspects, [])).toEqual(["Size"]);
    expect(aspects.Size).toBeUndefined();
    expect(aspects["Waist Size"]).toEqual(["32"]);
  });
});

describe("canonicalizeAspectKeys", () => {
  test("rejoins compound allowed values that splitting broke apart", () => {
    const aspects: Record<string, string[]> = { Closure: ["Hook", "Eye"] };
    canonicalizeAspectKeys(aspects, [
      meta({ name: "Closure", mode: "SELECTION_ONLY", values: ["Zip", "Hook & Eye"] }),
    ]);
    expect(aspects.Closure).toEqual(["Hook & Eye"]);
  });
  test("snaps each valid value of a multi-value aspect", () => {
    const aspects: Record<string, string[]> = { Material: ["cotton", "polyester"] };
    canonicalizeAspectKeys(aspects, [
      meta({
        name: "Material",
        mode: "SELECTION_ONLY",
        cardinality: "MULTI",
        values: ["Cotton", "Polyester", "Wool"],
      }),
    ]);
    expect(aspects.Material).toEqual(["Cotton", "Polyester"]);
  });
  test("renames model keys to eBay's exact names", () => {
    const aspects: Record<string, string[]> = { "sleeve length": ["Long Sleeve"] };
    canonicalizeAspectKeys(aspects, [meta({ name: "Sleeve Length" })]);
    expect(aspects["Sleeve Length"]).toEqual(["Long Sleeve"]);
    expect(aspects["sleeve length"]).toBeUndefined();
  });
});
