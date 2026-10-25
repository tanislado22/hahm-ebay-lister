import { describe, expect, test } from "vitest";
import { parseActiveItemDraft, textFromEbayDescription } from "@/lib/ebay/active-item-draft";
import { urlAfterSync } from "@/lib/vinted/listing-correction";
import {
  confirmedVintedHref,
  editablePreparePrice,
  planVintedLinkSave,
  uniqueActiveSkuListing,
} from "@/lib/vinted/prepare-listing";

const active = {
  sku: "1195",
  title: "Chaqueta de lana",
  photoUrl: "https://i.ebayimg.com/1195.jpg",
  ebayItemId: "111111111111",
  active: true,
};

describe("prepare from the exact active SKU", () => {
  test("uses only the active listing whose SKU text is 1195", () => {
    const result = uniqueActiveSkuListing("1195", [
      { ...active, title: "Vendida", photoUrl: "https://i.ebayimg.com/sold.jpg", ebayItemId: "333333333333", active: false },
      active,
      { ...active, sku: "01195", ebayItemId: "444444444444" },
      { ...active, sku: "1195.0", ebayItemId: "555555555555" },
      { ...active, sku: "11950", ebayItemId: "666666666666" },
    ]);
    expect(result).toEqual({
      ok: true,
      match: {
        sku: "1195",
        title: "Chaqueta de lana",
        photoUrl: "https://i.ebayimg.com/1195.jpg",
        ebayItemId: "111111111111",
      },
    });
  });

  test("does not prepare when the active SKU is missing or repeated", () => {
    expect(uniqueActiveSkuListing("1195", [{ ...active, active: false }]).ok).toBe(false);
    expect(uniqueActiveSkuListing(1195, [active]).ok).toBe(false);
    const many = uniqueActiveSkuListing("1195", [active, { ...active, ebayItemId: "222222222222", title: "Otra" }]);
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.error).toContain("No se preparó ningún artículo.");
  });
});

describe("eBay draft text", () => {
  test("reads the active listing text, price and every photo without treating the SKU as a number", () => {
    const draft = parseActiveItemDraft(`
      <Item>
        <ItemID>111111111111</ItemID>
        <SKU>1195</SKU>
        <Title>Chaqueta</Title>
        <Description><![CDATA[<p>Lana gruesa</p><br>SKU interno]]></Description>
        <ListingStatus>Active</ListingStatus>
        <SellingStatus><CurrentPrice currencyID="USD">24.50</CurrentPrice></SellingStatus>
        <PictureDetails>
          <PictureURL>https://i.ebayimg.com/a.jpg</PictureURL>
          <PictureURL>https://i.ebayimg.com/b.jpg</PictureURL>
        </PictureDetails>
        <PrimaryCategory><CategoryName>Coats</CategoryName></PrimaryCategory>
        <ItemSpecifics>
          <NameValueList><Name>Brand</Name><Value>Woolrich</Value></NameValueList>
        </ItemSpecifics>
      </Item>
    `);
    expect(draft).toMatchObject({
      sku: "1195",
      title: "Chaqueta",
      description: "Lana gruesa\n\nSKU interno",
      price: "24.50",
      photoUrls: ["https://i.ebayimg.com/a.jpg", "https://i.ebayimg.com/b.jpg"],
      brand: "Woolrich",
      category: "Coats",
      active: true,
    });
    expect(textFromEbayDescription("<p>Hola</p>")).toBe("Hola");
    const ended = parseActiveItemDraft("<Item><ItemID>111111111111</ItemID><SKU>1195</SKU><ListingStatus>Completed</ListingStatus></Item>");
    expect(ended?.active).toBe(false);
  });
});

describe("confirmed Vinted link", () => {
  test("a missing or broken link is not a confirmed listing", () => {
    expect(confirmedVintedHref({ url: "" })).toBe("");
    expect(confirmedVintedHref({ url: "https://www.vinted.com/" })).toBe("");
    expect(confirmedVintedHref({ url: "https://www.ebay.com/itm/111111111111" })).toBe("");
    expect(confirmedVintedHref({ url: "https://www.vinted.com/items/900-chaqueta" })).toBe(
      "https://www.vinted.com/items/900-chaqueta"
    );
    expect(
      confirmedVintedHref({
        url: "https://www.vinted.com/items/900-chaqueta",
        vintedUnlinkedAt: "2026-10-25T00:00:00.000Z",
        discardedVintedUrl: "https://www.vinted.com/items/900-chaqueta",
      })
    ).toBe("");
  });

  test("rejects a duplicate link and keeps the price as text", () => {
    const duplicate = planVintedLinkSave(
      "old-row",
      "https://www.vinted.com/items/555",
      [{ vintedItemId: "other", url: "https://www.vinted.com/items/555-lana" }]
    );
    expect(duplicate.ok).toBe(false);
    const saved = planVintedLinkSave("old-row", "https://www.vinted.com/items/777-nueva", [
      { vintedItemId: "other", url: "https://www.vinted.com/items/555" },
    ]);
    expect(saved).toEqual({
      ok: true,
      url: "https://www.vinted.com/items/777-nueva",
      linkedItemId: "777",
    });
    expect(planVintedLinkSave("old-row", 1195, []).ok).toBe(false);
    expect(editablePreparePrice("24.5")).toEqual({ ok: true, price: "24.50" });
    expect(editablePreparePrice(24.5).ok).toBe(false);
  });

  test("a saved link survives the next sync", () => {
    expect(
      urlAfterSync(
        { url: "https://www.vinted.com/items/777-nueva", manualVintedUrlAt: "2026-10-25T00:00:00.000Z" },
        "https://www.vinted.com/items/900-vieja"
      )
    ).toBe("https://www.vinted.com/items/777-nueva");
  });
});
