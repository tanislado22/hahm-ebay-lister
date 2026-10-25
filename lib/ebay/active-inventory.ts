import { EBAY_TRADING } from "@/lib/ebay/config";
import { parseTradingItems, type ListingSnapshot } from "@/lib/ebay/ended-listing";

const COMPATIBILITY_LEVEL = "1423";
const SITE_ID = "0";
const PAGE_SIZE = 200;
const PAGE_SAFETY_CAP = 100;

async function tradingCall(accessToken: string, body: string): Promise<string> {
  const resp = await fetch(EBAY_TRADING, {
    method: "POST",
    headers: {
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
      "X-EBAY-API-SITEID": SITE_ID,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
    },
    body,
  });
  const text = await resp.text();
  if (!resp.ok || !/<Ack>(Success|Warning)<\/Ack>/i.test(text)) {
    throw new Error(`eBay GetMyeBaySelling failed (${resp.status})`);
  }
  return text;
}

export function activePageCount(xml: string, itemCount: number): number | null {
  const match = xml.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/i);
  if (match) {
    const pages = Number(match[1]);
    if (!Number.isFinite(pages) || pages < 1) return null;
    return pages;
  }
  if (itemCount < PAGE_SIZE) return 1;
  return null;
}

export async function fetchAllActiveSellerListings(
  accessToken: string
): Promise<{ ok: true; listings: ListingSnapshot[] } | { ok: false; error: string }> {
  const listings: ListingSnapshot[] = [];
  let reported = 1;
  try {
    for (let page = 1; page <= reported; page += 1) {
      if (page > PAGE_SAFETY_CAP) {
        return {
          ok: false,
          error: "eBay devolvió demasiadas páginas. No se marcó ninguna publicación como finalizada.",
        };
      }
      const xml = await tradingCall(
        accessToken,
        `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>${PAGE_SIZE}</EntriesPerPage>
      <PageNumber>${page}</PageNumber>
    </Pagination>
  </ActiveList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`
      );
      const parsed = parseTradingItems(xml);
      const pages = activePageCount(xml, parsed.length);
      if (pages == null) {
        return {
          ok: false,
          error: "eBay no indicó todas las páginas del inventario. No se marcó ninguna publicación como finalizada.",
        };
      }
      reported = pages;
      listings.push(...parsed.filter((listing) => listing.status === "active"));
    }
  } catch (error) {
    console.error("[ebay/active-inventory]", error instanceof Error ? error.name : "Error");
    return {
      ok: false,
      error: "No se pudo leer el inventario activo de eBay. No se marcó ninguna publicación como finalizada.",
    };
  }
  return { ok: true, listings };
}
