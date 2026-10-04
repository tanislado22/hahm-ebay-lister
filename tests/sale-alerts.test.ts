import { describe, expect, test } from "vitest";
import { saleAlertMessage } from "@/lib/whatsapp/message";
import { decideEbaySale } from "@/lib/ebay/sale-decision";

describe("whatsapp sale alert", () => {
  test("includes the platform, SKU, and full title", () => {
    const title = "Levi's 550 Jeans Mens 34x29 Blue Relaxed Fit";
    const ebay = saleAlertMessage("ebay", "2450", title);
    expect(ebay.platformLabel).toBe("EBAY");
    expect(ebay.sku).toBe("2450");
    expect(ebay.title).toBe(title);
    expect(ebay.warning).toContain("Vinted");

    const vinted = saleAlertMessage("vinted", "2450", `${title}\nsecond line`);
    expect(vinted.platformLabel).toBe("VINTED");
    expect(vinted.title).toBe(`${title} second line`);
    expect(vinted.warning).toContain("eBay");
  });
});

describe("ebay sale decision", () => {
  test("alerts only when the same SKU is published on Vinted", () => {
    expect(
      decideEbaySale({
        cancelled: false,
        lookup: "one",
        publishedOnVinted: true,
        sku: "2450",
        title: "Coat",
      }).action
    ).toBe("alert");
  });

  test("skips a known SKU that is not on Vinted and does not guess a missing row", () => {
    expect(
      decideEbaySale({
        cancelled: false,
        lookup: "one",
        publishedOnVinted: false,
        sku: "2450",
        title: "Coat",
      })
    ).toMatchObject({ action: "record", status: "skipped" });
    expect(
      decideEbaySale({
        cancelled: false,
        lookup: "none",
        publishedOnVinted: false,
        sku: "2450",
        title: "Coat",
      }).action
    ).toBe("ignore");
  });
});
