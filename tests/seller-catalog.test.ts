import { describe, expect, test } from "vitest";
import { parseSellerCatalogItems } from "@/lib/ebay/seller-listings";

const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingResponse>
  <ActiveList>
    <ItemArray>
      <Item>
        <ItemID>123456789012</ItemID>
        <Title>Levi's 550 Jeans Mens 34x29</Title>
        <SKU>2443</SKU>
        <ListingStatus>Active</ListingStatus>
        <PictureDetails>
          <GalleryURL>https://i.ebayimg.com/images/g/jeans/s-l140.jpg</GalleryURL>
        </PictureDetails>
        <PrimaryCategory><CategoryName>Jeans</CategoryName></PrimaryCategory>
        <ItemSpecifics>
          <NameValueList><Name>Brand</Name><Value>Levi's</Value></NameValueList>
          <NameValueList><Name>Size</Name><Value>34</Value></NameValueList>
          <NameValueList><Name>Color</Name><Value>Blue</Value></NameValueList>
        </ItemSpecifics>
      </Item>
      <Item>
        <ItemID>123456789099</ItemID>
        <Title>Ended coat</Title>
        <SKU>9999</SKU>
        <ListingStatus>Completed</ListingStatus>
      </Item>
    </ItemArray>
  </ActiveList>
</GetMyeBaySellingResponse>`;

describe("seller catalog parser", () => {
  test("reads sku, item id, photo, brand, size, color and category from the connected account", () => {
    const listings = parseSellerCatalogItems(xml);
    expect(listings).toEqual([
      {
        itemId: "123456789012",
        sku: "2443",
        title: "Levi's 550 Jeans Mens 34x29",
        photoUrl: "https://i.ebayimg.com/images/g/jeans/s-l140.jpg",
        brand: "Levi's",
        size: "34",
        color: "Blue",
        category: "Jeans",
      },
    ]);
  });
});
