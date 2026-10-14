import { describe, expect, test } from "vitest";
import { planManualEbayItem } from "@/lib/vinted/manual-ebay-item";

const account = [
  { ebayItemId: "123456789012", sku: "ST-267", title: "Navy coat" },
  { ebayItemId: "123456789013", sku: "", title: "Blue shirt" },
  { ebayItemId: "123456789014", sku: "ST-10", title: "Red hat" },
  { ebayItemId: "123456789014", sku: "ST-11", title: "Red hat copy" },
  { ebayItemId: "222222222222", sku: "ST-1", title: "Similar navy coat" },
];

describe("manual eBay item id", () => {
  test("offers the single SKU from the seller account without confirming it", () => {
    const plan = planManualEbayItem("123456789012", account);
    expect(plan).toMatchObject({
      ok: true,
      ebayItemId: "123456789012",
      suggestedSku: "ST-267",
      title: "Navy coat",
    });
    if (!plan.ok) return;
    expect(plan.detail).toContain("Confirma el SKU");
  });

  test("keeps the item id and link path when the listing has no SKU or more than one", () => {
    const missing = planManualEbayItem("https://www.ebay.com/itm/123456789013", account);
    expect(missing).toMatchObject({ ok: true, ebayItemId: "123456789013", suggestedSku: "" });
    const several = planManualEbayItem("123456789014", account);
    expect(several).toMatchObject({ ok: true, ebayItemId: "123456789014", suggestedSku: "" });
  });

  test("rejects an item that is not on the account and does not match by title", () => {
    expect(planManualEbayItem("999999999999", account)).toMatchObject({ ok: false });
    expect(planManualEbayItem("12345", account)).toMatchObject({ ok: false });
    const similar = planManualEbayItem("222222222222", account);
    expect(similar).toMatchObject({ ok: true, suggestedSku: "ST-1" });
    expect(similar.ok && similar.suggestedSku).not.toBe("ST-267");
  });
});
