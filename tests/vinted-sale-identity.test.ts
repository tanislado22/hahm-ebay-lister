import { describe, expect, test } from "vitest";
import { resolveMarketplaceIdentity, resolveSaleIdentity } from "@/lib/vinted/sale-identity";

const jeans = {
  sku: "2830",
  vintedTitle: "Levi's 550 Jeans Mens 34x29 Blue Relaxed Fit",
  ebayTitle: "Levi's 550 Jeans",
};

describe("vinted sale identity", () => {
  test("reads SKU 3053 without a colon", () => {
    expect(resolveMarketplaceIdentity(
      "You just sold an item",
      "You just sold an item\nBlue Shirt\nSKU 3053\nPrice $8\nYour earnings $5.05\n",
      [{ sku: "3053", vintedTitle: "Blue Shirt", ebayTitle: "" }]
    )).toEqual({ sku: "3053", title: "Blue Shirt" });
  });

  test("uses one SKU line from the listing description", () => {
    expect(
      resolveSaleIdentity("Navy wool coat", "Navy wool coat\nSKU: 2443\n", [jeans])
    ).toEqual({ sku: "2443", title: "Navy wool coat" });
  });

  test("uses the inventory title when the email has a SKU and no item title", () => {
    expect(resolveSaleIdentity("", "You sold an item on Vinted\nSKU: 2830\n", [jeans])).toEqual({
      sku: "2830",
      title: jeans.vintedTitle,
    });
  });

  test("matches a title when the email has no SKU line", () => {
    expect(resolveSaleIdentity(jeans.vintedTitle, jeans.vintedTitle, [jeans])).toEqual({
      sku: "2830",
      title: jeans.vintedTitle,
    });
  });

  test("leaves the SKU empty when the email and the title point at different items", () => {
    expect(resolveSaleIdentity(jeans.vintedTitle, `${jeans.vintedTitle}\nSKU: 9999`, [jeans])).toEqual({
      sku: "",
      title: jeans.vintedTitle,
    });
  });

  test("leaves the SKU empty when the email contains two different SKU lines", () => {
    expect(resolveSaleIdentity("", "SKU: 2443\nSKU: 2830\n", [jeans])).toEqual({
      sku: "",
      title: "No identificado",
    });
  });

  test("matches a Poshmark subject to the lot title even when the first line is the greeting", () => {
    expect(resolveMarketplaceIdentity(
      "Congrats! You made a sale",
      "Congrats! You made a sale\n\nNavy Wool Coat\n\nShip your order soon\n",
      [{ sku: "2830", vintedTitle: "Navy Wool Coat", ebayTitle: "" }]
    )).toEqual({ sku: "2830", title: "Navy Wool Coat" });
  });

  test("still names the sale when nothing identifies the item", () => {
    expect(resolveSaleIdentity("", "You sold an item on Vinted", [])).toEqual({
      sku: "",
      title: "No identificado",
    });
  });
});
