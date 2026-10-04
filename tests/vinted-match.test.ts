import { describe, expect, test } from "vitest";
import { matchSoldTitle } from "@/lib/vinted/match";

const jeans = {
  sku: "2450",
  vintedTitle: "Levi's 550 Jeans Mens 34x29 Blue Relaxed Fit",
  ebayTitle: "Levi's 550 Jeans Mens 34x29 Blue Relaxed Fit",
};

describe("vinted title matching", () => {
  test("matches one published title to its SKU", () => {
    expect(matchSoldTitle(jeans.vintedTitle, [jeans])).toEqual({
      kind: "unique",
      sku: "2450",
      title: jeans.vintedTitle,
    });
  });

  test("does not guess when two SKUs share the title", () => {
    const result = matchSoldTitle(jeans.vintedTitle, [jeans, { ...jeans, sku: "2451" }]);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") expect(result.skus.sort()).toEqual(["2450", "2451"]);
  });

  test("does not match a different item", () => {
    expect(
      matchSoldTitle("Red Silk Scarf", [jeans])
    ).toEqual({ kind: "none" });
  });
});
