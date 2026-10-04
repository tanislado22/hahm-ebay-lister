import { describe, expect, test } from "vitest";
import {
  DEFAULT_VINTED_CATEGORY_RULES,
  formatVintedCategoryPath,
  resolveVintedCategory,
} from "@/lib/vinted/category-map";

describe("vinted category map", () => {
  test("maps item types to Vinted paths instead of eBay categories", () => {
    expect(
      resolveVintedCategory(
        { title: "Levi's 550 Jeans Mens 34x29", bucket: "mens_jeans" },
        DEFAULT_VINTED_CATEGORY_RULES
      )
    ).toEqual({ itemType: "Men's Jeans", path: ["Men", "Clothing", "Jeans"] });

    expect(
      resolveVintedCategory(
        { title: "Women's linen shorts", bucket: "womens_clothing" },
        DEFAULT_VINTED_CATEGORY_RULES
      )?.itemType
    ).toBe("Women's Shorts");

    expect(
      resolveVintedCategory(
        { title: "Silk blouse", bucket: "womens_top" },
        DEFAULT_VINTED_CATEGORY_RULES
      )
    ).toMatchObject({ itemType: "Women's Blouse", path: ["Women", "Clothing", "Blouses"] });
  });

  test("uses a Vinted sneaker path for a Ready Nike shoe", () => {
    const match = resolveVintedCategory(
      { title: "Nike Dunk Low Men's", brand: "Nike", bucket: "mens_shoes" },
      DEFAULT_VINTED_CATEGORY_RULES
    );
    expect(match?.path).toEqual(["Men", "Shoes", "Sneakers"]);
    expect(formatVintedCategoryPath(match?.path || [])).toBe("Men › Shoes › Sneakers");
  });

  test("keeps a saved Vinted category path", () => {
    expect(
      resolveVintedCategory({
        title: "Nike shirt",
        savedCategory: "Men › Clothing › T-shirts",
      })?.path
    ).toEqual(["Men", "Clothing", "T-shirts"]);
  });
});
