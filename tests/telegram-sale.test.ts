import { describe, expect, test } from "vitest";
import { ebaySaleNotice, isConfirmedEbaySale } from "@/lib/telegram/ebay-sale";
import { enlargeSkuDigits, saleTelegramMessage } from "@/lib/telegram/message";

const SAMPLE_TITLE = "Levi’s 550 Men’s Relaxed Fit Jeans";

describe("telegram sale message", () => {
  test("renders the eBay premium layout with a bold header and both SKU forms", () => {
    const message = saleTelegramMessage("ebay", "2830", SAMPLE_TITLE);
    expect(message).toContain("🎉 <b>¡VENTA CONFIRMADA!</b> 🎉");
    expect(message).toContain("🛍️ <b>eBay Store</b>");
    expect(message).not.toContain("Vinted Store");
    expect(message).toContain("🏷️ <b>ARTÍCULO VENDIDO</b>");
    expect(message).toContain(SAMPLE_TITLE);
    expect(message).toContain("📦 <b>NÚMERO DE SKU</b>");
    expect(message).toContain(`<b>${enlargeSkuDigits("2830")}</b>`);
    expect(message).toContain("\n2830\n");
    expect(message).toContain("✨ <b>¡Otra venta exitosa!</b>");
    expect(message).toContain("━━━━━━━━━━━━━━━━━━━━");
    expect(message).not.toMatch(/\$|price|buyer|comprador/i);
  });

  test("uses the Vinted store line for Vinted sales", () => {
    const message = saleTelegramMessage("vinted", "2830", SAMPLE_TITLE);
    expect(message).toContain("💙 <b>Vinted Store</b>");
    expect(message).not.toContain("eBay Store");
  });

  test("keeps the full title and escapes HTML", () => {
    const title = `Levi's & Co <550> "Relaxed" Fit Jeans Extra Long Name`;
    const message = saleTelegramMessage("ebay", "2830", title);
    expect(message).toContain("Levi's &amp; Co &lt;550&gt; \"Relaxed\" Fit Jeans Extra Long Name");
    expect(message).not.toContain("<550>");
  });

  test("maps only digits to large unicode and still prints the exact SKU", () => {
    expect(enlargeSkuDigits("2830")).toBe("𝟮𝟴𝟯𝟬");
    expect(enlargeSkuDigits("28-30")).toBe("𝟮𝟴-𝟯𝟬");
    const message = saleTelegramMessage("ebay", "28-30", SAMPLE_TITLE);
    expect(message).toContain("<b>𝟮𝟴-𝟯𝟬</b>");
    expect(message).toContain("28-30");
  });

  test("does not repeat a SKU that has no digits", () => {
    const message = saleTelegramMessage("ebay", "BIN-A", SAMPLE_TITLE);
    expect(message).toContain("<b>BIN-A</b>");
    expect(message.match(/BIN-A/g)).toHaveLength(1);
  });
});

describe("confirmed eBay sale selection", () => {
  const paid = {
    cancelled: false,
    paymentStatus: "PAID",
    sku: "2830",
    title: "Order title",
  };

  test("accepts paid and unknown payment status, and rejects cancelled or unpaid orders", () => {
    expect(isConfirmedEbaySale({ cancelled: false, paymentStatus: "PAID" })).toBe(true);
    expect(isConfirmedEbaySale({ cancelled: false, paymentStatus: "" })).toBe(true);
    expect(isConfirmedEbaySale({ cancelled: false, paymentStatus: "PARTIALLY_REFUNDED" })).toBe(true);
    expect(isConfirmedEbaySale({ cancelled: true, paymentStatus: "PAID" })).toBe(false);
    expect(isConfirmedEbaySale({ cancelled: false, paymentStatus: "PENDING" })).toBe(false);
    expect(isConfirmedEbaySale({ cancelled: false, paymentStatus: "FAILED" })).toBe(false);
    expect(isConfirmedEbaySale({ cancelled: false, paymentStatus: "FULLY_REFUNDED" })).toBe(false);
  });

  test("prefers the inventory SKU and eBay title", () => {
    expect(
      ebaySaleNotice(paid, {
        kind: "one",
        row: { sku: "2830", ebayTitle: SAMPLE_TITLE, vintedTitle: "Shorter Vinted title" },
      })
    ).toEqual({ sku: "2830", title: SAMPLE_TITLE });
  });

  test("uses the order line when the sale is not linked in inventory", () => {
    expect(ebaySaleNotice(paid, { kind: "none" })).toEqual({
      sku: "2830",
      title: "Order title",
    });
  });

  test("does not guess when several inventory rows match", () => {
    expect(ebaySaleNotice(paid, { kind: "ambiguous" })).toBeNull();
  });

  test("does not notify a cancelled order", () => {
    expect(
      ebaySaleNotice({ ...paid, cancelled: true }, { kind: "none" })
    ).toBeNull();
  });
});
