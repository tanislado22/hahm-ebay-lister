import { describe, expect, test } from "vitest";
import { parseActiveListPage, parseEbayItemXml } from "@/lib/archive/parse-item";
import {
  WORKSPACE_DELETE_REMOVES_ARCHIVE,
  canArchivePublished,
  chooseSaleRecord,
  existingVintedLink,
  isReadOnlyTradingCall,
  mergeArticleCore,
  planImportLink,
  removalAfterSave,
  type ArticleCore,
  type LocalRecord,
} from "@/lib/archive/link";
import { applyListPage, blankRun, completeDetail, statusesForListingsMissingFromImport } from "@/lib/archive/import-progress";
import { classifyTradingProblem, missingEbayConfig } from "@/lib/archive/trading-error";
import { exactSku } from "@/lib/archive/text";
import { restoreGroup } from "@/lib/archive/workspace";

const itemXml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemResponse>
  <Item>
    <ItemID>123456789012</ItemID>
    <Title>Camisa azul</Title>
    <SKU>00123</SKU>
    <Description><![CDATA[<p>Tela suave</p>]]></Description>
    <PictureDetails>
      <GalleryURL>https://i.ebayimg.com/images/g/abc/s-l140.jpg</GalleryURL>
      <PictureURL>https://i.ebayimg.com/images/g/abc/s-l1600.jpg</PictureURL>
      <PictureURL>https://i.ebayimg.com/images/g/def/s-l1600.jpg</PictureURL>
    </PictureDetails>
    <SellingStatus>
      <CurrentPrice currencyID="USD">19.50</CurrentPrice>
      <QuantitySold>0</QuantitySold>
      <ListingStatus>Active</ListingStatus>
    </SellingStatus>
    <ListingDetails>
      <ViewItemURL>https://www.ebay.com/itm/123456789012</ViewItemURL>
    </ListingDetails>
    <Variations>
      <Variation>
        <SKU>0007</SKU>
        <StartPrice currencyID="USD">21.00</StartPrice>
        <Quantity>2</Quantity>
        <VariationSpecifics>
          <NameValueList><Name>Size</Name><Value>M</Value></NameValueList>
        </VariationSpecifics>
      </Variation>
    </Variations>
  </Item>
</GetItemResponse>`;

const local = (patch: Partial<LocalRecord>): LocalRecord => ({
  id: "local-1",
  source: "platform",
  sku: "00123",
  ebayItemId: "",
  vintedListingUrl: "https://www.vinted.com/items/12345678",
  vintedListingId: "12345678",
  vintedTitle: "Camisa",
  vintedStatus: "published",
  ...patch,
});

const core = (patch: Partial<ArticleCore> = {}): ArticleCore => ({
  sku: "00123",
  title: "Local",
  description: "Nota local",
  price: "10.00",
  currency: "USD",
  ebayUrl: "",
  listingStatus: "Active",
  quantitySold: 0,
  variants: [],
  vintedListingUrl: "https://www.vinted.com/items/12345678",
  vintedListingId: "12345678",
  vintedTitle: "Camisa",
  vintedStatus: "published",
  ...patch,
});

describe("article archive", () => {
  test("keeps the SKU exactly, including leading zeros, and does not invent one", () => {
    const parsed = parseEbayItemXml(itemXml);
    expect(parsed?.sku).toBe("00123");
    expect(parsed?.variants[0]?.sku).toBe("0007");
    expect(exactSku("  00123  ")).toBe("00123");
    const empty = parseEbayItemXml(itemXml.replace("<SKU>00123</SKU>", ""));
    expect(empty?.sku).toBe("");
    expect(empty?.variants[0]?.sku).toBe("0007");
  });

  test("reads price, currency, photos, status and variants from the official item payload", () => {
    const parsed = parseEbayItemXml(itemXml);
    expect(parsed).toMatchObject({
      itemId: "123456789012",
      title: "Camisa azul",
      price: "19.50",
      currency: "USD",
      listingStatus: "Active",
      quantitySold: 0,
      ebayUrl: "https://www.ebay.com/itm/123456789012",
    });
    expect(parsed?.description).toContain("Tela suave");
    expect(parsed?.pictureUrls).toEqual([
      "https://i.ebayimg.com/images/g/abc/s-l1600.jpg",
      "https://i.ebayimg.com/images/g/def/s-l1600.jpg",
    ]);
    expect(parsed?.variants[0]?.specifics).toEqual([{ name: "Size", value: "M" }]);
  });

  test("does not link old records by a similar title", () => {
    const plan = planImportLink({
      ebayItemId: "123456789012",
      ebaySku: "00123",
      existingArchiveId: null,
      locals: [local({ id: "other", sku: "123", ebayItemId: "", vintedListingUrl: "https://www.vinted.com/items/99999999" })],
    });
    expect(plan.linkPlatformId).toBeNull();
    expect(plan.vintedFrom).toBeNull();
    const exact = planImportLink({
      ebayItemId: "123456789012",
      ebaySku: "00123",
      existingArchiveId: null,
      locals: [local({ id: "exact" })],
    });
    expect(exact.linkPlatformId).toBe("exact");
    expect(exact.vintedFrom?.vintedListingUrl).toBe("https://www.vinted.com/items/12345678");
  });

  test("updates an existing item id without clearing Vinted or a local SKU", () => {
    const plan = planImportLink({
      ebayItemId: "123456789012",
      ebaySku: "",
      existingArchiveId: "archive-1",
      locals: [local({ ebayItemId: "123456789012" })],
    });
    expect(plan.archiveId).toBe("archive-1");
    const merged = mergeArticleCore(core(), {
      ...core({ sku: "", title: "Desde eBay", description: "", price: "19.50", vintedListingUrl: "", vintedListingId: "", vintedTitle: "", vintedStatus: "" }),
    }, null);
    expect(merged.sku).toBe("00123");
    expect(merged.title).toBe("Desde eBay");
    expect(merged.description).toBe("Nota local");
    expect(merged.vintedListingUrl).toBe("https://www.vinted.com/items/12345678");
  });

  test("an incomplete import does not invent sold or ended statuses", () => {
    const first = applyListPage(blankRun("all"), {
      pageNumber: 1,
      totalPages: 3,
      totalEntries: 30,
      itemIds: ["111111111111"],
      truncated: false,
    });
    expect(first.run.listComplete).toBe(false);
    expect(first.run.pendingIds).toEqual(["111111111111"]);
    expect(statusesForListingsMissingFromImport()).toEqual([]);
    const truncated = applyListPage(blankRun("all"), {
      pageNumber: 1,
      totalPages: null,
      totalEntries: null,
      itemIds: [],
      truncated: true,
    });
    expect(truncated.run.listComplete).toBe(false);
    expect(truncated.problem).toBe("truncated");
  });

  test("the ten-item trial stops after the first page and a repeat updates the same item", () => {
    const ids = Array.from({ length: 15 }, (_, index) => String(100000000000 + index));
    const sample = applyListPage(blankRun("sample"), {
      pageNumber: 1,
      totalPages: 4,
      totalEntries: 40,
      itemIds: ids,
      truncated: false,
    });
    expect(sample.run.found).toBe(10);
    expect(sample.run.pendingIds).toHaveLength(10);
    expect(sample.run.listComplete).toBe(true);
    const saved = completeDetail(sample.run, sample.run.pendingIds[0], "existing");
    expect(saved.existing).toBe(1);
    expect(saved.imported).toBe(0);
  });

  test("archive and delete stay separate, and only published items can be archived", () => {
    expect(WORKSPACE_DELETE_REMOVES_ARCHIVE).toBe(false);
    expect(canArchivePublished("posted")).toBe(true);
    expect(canArchivePublished("idle")).toBe(false);
    expect(canArchivePublished("posting")).toBe(false);
    expect(removalAfterSave(false)).toBe("keep");
    expect(removalAfterSave(true)).toBe("remove");
    expect(isReadOnlyTradingCall("GetItem")).toBe(true);
    expect(isReadOnlyTradingCall("EndItem")).toBe(false);
    expect(isReadOnlyTradingCall("ReviseItem")).toBe(false);
  });

  test("restoring keeps the listing id and published state", () => {
    const group = restoreGroup({
      articleId: "article-1",
      sourceJobId: "job-1",
      sku: "00123",
      title: "Camisa",
      description: "Tela",
      price: "19.50",
      currency: "USD",
      ebayItemId: "123456789012",
      ebayUrl: "https://www.ebay.com/itm/123456789012",
      vintedStatus: "published",
      vintedListingUrl: "https://www.vinted.com/items/12345678",
      storedGroup: { id: "job-1", sku: "00123", postStatus: "posted", listingId: "123456789012" },
      photoIds: ["photo-1"],
    });
    expect(group.id).toBe("job-1");
    expect(group.sku).toBe("00123");
    expect(group.postStatus).toBe("posted");
    expect(group.listingId).toBe("123456789012");
  });

  test("sale lookup uses the item id or the exact SKU, not a lookalike", () => {
    const rows = [
      { id: "a", sku: "00123", ebayItemId: "123456789012" },
      { id: "b", sku: "123", ebayItemId: "222222222222" },
    ];
    expect(chooseSaleRecord("00123", "123456789012", rows)).toEqual({ kind: "one", id: "a" });
    expect(chooseSaleRecord("123", "", rows)).toEqual({ kind: "one", id: "b" });
    expect(chooseSaleRecord("", "123456789012", rows)).toEqual({ kind: "one", id: "a" });
    expect(chooseSaleRecord("Camisa azul", "", rows).kind).toBe("none");
  });

  test("keeps one existing Vinted link and does not choose between conflicting ones", () => {
    const kept = existingVintedLink({
      rows: [local({ ebayItemId: "123456789012" })],
      ebayItemId: "123456789012",
      sku: "00123",
      groupUrl: "",
      groupStatus: "",
    });
    expect(kept.url).toBe("https://www.vinted.com/items/12345678");
    const conflict = existingVintedLink({
      rows: [
        local({ id: "a", ebayItemId: "123456789012", vintedListingUrl: "https://www.vinted.com/items/11111111" }),
        local({ id: "b", ebayItemId: "123456789012", vintedListingUrl: "https://www.vinted.com/items/22222222" }),
      ],
      ebayItemId: "123456789012",
      sku: "00123",
      groupUrl: "https://www.vinted.com/items/33333333",
      groupStatus: "published",
    });
    expect(conflict.url).toBe("");
  });

  test("active list pages keep the SKU text and skip ended rows", () => {
    const page = parseActiveListPage(`<GetMyeBaySellingResponse><ActiveList>
      <PaginationResult><TotalNumberOfPages>2</TotalNumberOfPages><TotalNumberOfEntries>3</TotalNumberOfEntries></PaginationResult>
      <Item><ItemID>123456789012</ItemID><SKU>00123</SKU><Title>Uno</Title><SellingStatus><ListingStatus>Active</ListingStatus><CurrentPrice currencyID="USD">5.00</CurrentPrice></SellingStatus></Item>
      <Item><ItemID>123456789013</ItemID><SKU></SKU><Title>Dos</Title><ListingStatus>Completed</ListingStatus></Item>
    </ActiveList></GetMyeBaySellingResponse>`);
    expect(page.pages).toBe(2);
    expect(page.items).toEqual([
      expect.objectContaining({ itemId: "123456789012", sku: "00123", price: "5.00", currency: "USD" }),
    ]);
  });

  test("a missing eBay permission is reported with eBay's own message", () => {
    const problem = classifyTradingProblem(
      401,
      "<Errors><ErrorCode>21917053</ErrorCode><LongMessage>IAF token supplied is invalid.</LongMessage></Errors>"
    );
    expect(problem.config).toBe(true);
    expect(problem.message).toContain("21917053");
    expect(problem.message).toContain("IAF token supplied is invalid.");
    expect(problem.missing.join(" ")).toContain("GetMyeBaySelling");
    const keys = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RU_NAME", "SESSION_SECRET", "DATABASE_URL", "STORAGE_DATABASE_URL"] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      for (const key of keys) delete process.env[key];
      expect(missingEbayConfig()).toEqual(expect.arrayContaining(["EBAY_CLIENT_ID (App ID)", "SESSION_SECRET", "DATABASE_URL"]));
    } finally {
      for (const key of keys) {
        if (previous[key] == null) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });
});
