import { EBAY_TRADING } from "@/lib/ebay/config";
import { parseTradingItems, type ListingSnapshot } from "@/lib/ebay/ended-listing";

const COMPATIBILITY_LEVEL = "1423";
const SITE_ID = "0";
const MAX_PAGES = 5;

async function tradingCall(accessToken: string, callName: string, body: string): Promise<string> {
  const resp = await fetch(EBAY_TRADING, {
    method: "POST",
    headers: {
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": SITE_ID,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
    },
    body,
  });
  const text = await resp.text();
  if (!resp.ok || !/<Ack>(Success|Warning)<\/Ack>/i.test(text)) {
    throw new Error(`eBay ${callName} failed (${resp.status}): ${text.slice(0, 180)}`);
  }
  return text;
}

function totalPages(xml: string, cap = MAX_PAGES): number {
  const match = xml.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/i);
  const pages = Number(match?.[1] ?? "1");
  if (!Number.isFinite(pages) || pages < 1) return 1;
  return Math.min(pages, cap);
}

// Read-only. Every active listing on the seller account, including listings
// that were published outside this app.
export async function fetchActiveSellerListings(accessToken: string): Promise<ListingSnapshot[]> {
  const listings: ListingSnapshot[] = [];
  let pages = 1;
  for (let page = 1; page <= pages; page += 1) {
    const xml = await tradingCall(
      accessToken,
      "GetMyeBaySelling",
      `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>${page}</PageNumber>
    </Pagination>
  </ActiveList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`
    );
    pages = totalPages(xml);
    listings.push(...parseTradingItems(xml));
  }
  return listings;
}

// Read-only. Listings whose end time falls in the window, including early ends.
export async function fetchRecentlyEndedSellerListings(
  accessToken: string,
  from: Date,
  to: Date
): Promise<ListingSnapshot[]> {
  const listings: ListingSnapshot[] = [];
  let pages = 1;
  for (let page = 1; page <= pages; page += 1) {
    const xml = await tradingCall(
      accessToken,
      "GetSellerList",
      `<?xml version="1.0" encoding="utf-8"?>
<GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <EndTimeFrom>${from.toISOString()}</EndTimeFrom>
  <EndTimeTo>${to.toISOString()}</EndTimeTo>
  <GranularityLevel>Fine</GranularityLevel>
  <Pagination>
    <EntriesPerPage>200</EntriesPerPage>
    <PageNumber>${page}</PageNumber>
  </Pagination>
</GetSellerListRequest>`
    );
    pages = totalPages(xml);
    listings.push(...parseTradingItems(xml));
  }
  return listings;
}

export interface SellerCatalogListing {
  itemId: string;
  sku: string;
  title: string;
  photoUrl: string;
  brand: string;
  size: string;
  color: string;
  category: string;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .trim();
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return match?.[1] ? decodeXml(match[1]) : "";
}

function specificValue(block: string, names: string[]): string {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const pattern = /<NameValueList>([\s\S]*?)<\/NameValueList>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block))) {
    const name = tag(match[1], "Name").toLowerCase();
    if (!wanted.has(name)) continue;
    const value = tag(match[1], "Value");
    if (value) return value;
  }
  return "";
}

// Active listings on the connected seller account. Read-only.
export function parseSellerCatalogItems(xml: string): SellerCatalogListing[] {
  const items: SellerCatalogListing[] = [];
  const pattern = /<Item\b[^>]*>([\s\S]*?)<\/Item>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const block = match[1];
    const itemId = tag(block, "ItemID").replace(/\D/g, "");
    if (!itemId) continue;
    const status = tag(block, "ListingStatus").toLowerCase();
    if (status === "completed" || status === "ended") continue;
    const categoryBlock = tag(block, "PrimaryCategory");
    items.push({
      itemId,
      sku: tag(block, "SKU").trim(),
      title: tag(block, "Title").trim(),
      photoUrl: tag(block, "GalleryURL") || tag(block, "PictureURL"),
      brand: specificValue(block, ["Brand"]),
      size: specificValue(block, ["Size"]),
      color: specificValue(block, ["Color", "Colour"]),
      category: categoryBlock ? tag(categoryBlock, "CategoryName") || categoryBlock : tag(block, "CategoryName"),
    });
  }
  return items;
}

const CATALOG_PAGE_CAP = 25;

export async function fetchActiveSellerCatalog(accessToken: string): Promise<SellerCatalogListing[]> {
  const listings: SellerCatalogListing[] = [];
  let pages = 1;
  for (let page = 1; page <= pages; page += 1) {
    const xml = await tradingCall(
      accessToken,
      "GetMyeBaySelling",
      `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>${page}</PageNumber>
    </Pagination>
  </ActiveList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`
    );
    pages = totalPages(xml, CATALOG_PAGE_CAP);
    listings.push(...parseSellerCatalogItems(xml));
  }
  return listings;
}

export async function fetchSellerItem(accessToken: string, itemId: string): Promise<ListingSnapshot | null> {
  try {
    const xml = await tradingCall(
      accessToken,
      "GetItem",
      `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId.replace(/[^\d]/g, "")}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemRequest>`
    );
    return parseTradingItems(xml)[0] ?? null;
  } catch {
    return null;
  }
}
