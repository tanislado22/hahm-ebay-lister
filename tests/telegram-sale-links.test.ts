import { describe, expect, test } from "vitest";
import { extractPlatformListingUrl, listingUrlForPlatform, saleNoticeIsDuplicate } from "@/lib/telegram/sale-links";

describe("platform listing links", () => {
  test("reads the sold listing URL for each marketplace and ignores other links", () => {
    const source = [
      "Track it at https://carrier.example/track/1",
      "https://www.ebay.com/itm/123456789012?camp=1",
      "https://www.vinted.com/items/178425031509-coat",
      "https://poshmark.com/listing/navy-wool-coat-64abc",
      "https://www.depop.com/products/coat-123",
    ].join("\n");
    expect(extractPlatformListingUrl("ebay", source)).toBe("https://www.ebay.com/itm/123456789012?camp=1");
    expect(extractPlatformListingUrl("vinted", source)).toBe("https://www.vinted.com/items/178425031509-coat");
    expect(extractPlatformListingUrl("poshmark", source)).toBe("https://poshmark.com/listing/navy-wool-coat-64abc");
    expect(extractPlatformListingUrl("depop", source)).toBe("https://www.depop.com/products/coat-123");
    expect(listingUrlForPlatform("ebay", "javascript:alert(1)")).toBeNull();
    expect(extractPlatformListingUrl("vinted", "https://www.ebay.com/itm/123456789012")).toBeNull();
  });
});

describe("sale notice duplicates", () => {
  const prior = [
    { platform: "ebay", sku: "2830", externalEventId: "order-1", sent: true },
    { platform: "vinted", sku: "2443", externalEventId: "gmail-1", sent: true },
  ];

  test("blocks the same event or the same SKU on the same platform", () => {
    expect(saleNoticeIsDuplicate({ platform: "ebay", sku: "9999", externalEventId: "order-1", prior })).toBe(true);
    expect(saleNoticeIsDuplicate({ platform: "ebay", sku: "2830", externalEventId: "order-2", prior })).toBe(true);
  });

  test("still notifies another platform, another SKU, and a sale without a SKU", () => {
    expect(saleNoticeIsDuplicate({ platform: "vinted", sku: "2830", externalEventId: "gmail-2", prior })).toBe(false);
    expect(saleNoticeIsDuplicate({ platform: "poshmark", sku: "", externalEventId: "gmail-3", prior })).toBe(false);
    expect(saleNoticeIsDuplicate({ platform: "depop", sku: "2503", externalEventId: "gmail-4", prior })).toBe(false);
    expect(
      saleNoticeIsDuplicate({
        platform: "ebay",
        sku: "2830",
        externalEventId: "order-1",
        prior: [{ platform: "ebay", sku: "2830", externalEventId: "order-1", sent: false }],
      })
    ).toBe(false);
  });
});
