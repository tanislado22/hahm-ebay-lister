import { describe, expect, test } from "vitest";
import {
  decideEndedListing,
  parseTradingItems,
  type ListingSnapshot,
  type ListingWatch,
} from "@/lib/ebay/ended-listing";
import { endedListingMessage, enlargeSkuDigits } from "@/lib/telegram/message";

const active: ListingSnapshot = {
  itemId: "111",
  sku: "2830",
  title: "Levi's 550 Men's Relaxed Fit Jeans",
  status: "active",
  quantitySold: 0,
  endTime: "",
};

const withdrawn: ListingSnapshot = {
  ...active,
  status: "ended",
  quantitySold: 0,
  endTime: "2026-10-12T18:00:00.000Z",
};

describe("trading listing parser", () => {
  test("reads active and ended listings, including ones not created by this app", () => {
    const xml = `
      <ItemArray>
        <Item>
          <ItemID>111</ItemID>
          <Title>Levi&apos;s 550 Men&apos;s Relaxed Fit Jeans</Title>
          <SKU>2830</SKU>
          <SellingStatus>
            <QuantitySold>0</QuantitySold>
            <ListingStatus>Completed</ListingStatus>
          </SellingStatus>
          <ListingDetails><EndTime>2026-10-12T18:00:00.000Z</EndTime></ListingDetails>
        </Item>
        <Item>
          <ItemID>222</ItemID>
          <Title>Older coat published outside the app</Title>
          <SKU>2844</SKU>
          <SellingStatus>
            <QuantitySold>1</QuantitySold>
            <ListingStatus>Active</ListingStatus>
          </SellingStatus>
        </Item>
      </ItemArray>`;
    expect(parseTradingItems(xml)).toEqual([
      {
        itemId: "111",
        sku: "2830",
        title: "Levi's 550 Men's Relaxed Fit Jeans",
        status: "ended",
        quantitySold: 0,
        endTime: "2026-10-12T18:00:00.000Z",
      },
      {
        itemId: "222",
        sku: "2844",
        title: "Older coat published outside the app",
        status: "active",
        quantitySold: 1,
        endTime: "",
      },
    ]);
  });
});

describe("ended listing decision", () => {
  test("records an already ended listing and an existing active listing without notifying", () => {
    expect(decideEndedListing(null, withdrawn, false)).toEqual({ action: "baseline", status: "ended" });
    expect(decideEndedListing(null, active, false)).toEqual({ action: "baseline", status: "active" });
  });

  test("notifies once when a watched active listing ends without an eBay sale", () => {
    const previous: ListingWatch = { itemId: "111", status: "active", notifiedEventId: null };
    const decision = decideEndedListing(previous, withdrawn, false);
    expect(decision).toEqual({
      action: "notify",
      eventId: "111:2026-10-12T18:00:00.000Z",
      sku: "2830",
      title: active.title,
    });
    const again = decideEndedListing(
      { itemId: "111", status: "ended", notifiedEventId: "111:2026-10-12T18:00:00.000Z" },
      withdrawn,
      false
    );
    expect(again).toMatchObject({ action: "ignore", reason: "already-notified" });
  });

  test("does not treat an eBay sale as a withdrawal", () => {
    const previous: ListingWatch = { itemId: "111", status: "active", notifiedEventId: null };
    expect(decideEndedListing(previous, { ...withdrawn, quantitySold: 1 }, false)).toMatchObject({
      action: "ignore",
      reason: "ebay-sale",
    });
    expect(decideEndedListing(previous, withdrawn, true)).toMatchObject({
      action: "ignore",
      reason: "ebay-sale",
    });
  });
});

describe("ended listing telegram message", () => {
  test("shows the withdrawal header, the full title, and one large bold SKU", () => {
    const message = endedListingMessage("2830", active.title);
    expect(message).toContain("🛑 <b>ARTÍCULO RETIRADO DE EBAY</b>");
    expect(message).toContain(active.title);
    expect(message).toContain(`<b>${enlargeSkuDigits("2830")}</b>`);
    expect(message.match(/𝟮𝟴𝟯𝟬/g)).toHaveLength(1);
    expect(message).not.toContain("\n2830");
    expect(message).not.toMatch(/poshmark|depop|venta confirmada/i);
  });
});
