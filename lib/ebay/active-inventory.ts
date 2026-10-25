import { EBAY_TRADING } from "@/lib/ebay/config";
import { type ListingSnapshot } from "@/lib/ebay/ended-listing";

const COMPATIBILITY_LEVEL = "1423";
const SITE_ID = "0";
const PAGE_SIZE = 200;
const PAGE_SAFETY_CAP = 100;
const UNCLASSIFIED =
  "No se clasificó ningún vínculo ni se modificó ningún Item ID.";

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
    signal: AbortSignal.timeout(15000),
  });
  const text = await resp.text();
  if (!resp.ok || !/<Ack>(Success|Warning)<\/Ack>/i.test(text)) {
    throw new Error(`eBay ${callName} failed (${resp.status})`);
  }
  return text;
}

function tagValue(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  if (!match?.[1]) return "";
  return match[1]
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .trim();
}

export interface ActiveListRead {
  pages: number | null;
  entries: number | null;
  received: ListingSnapshot[];
  active: ListingSnapshot[];
  unrecognized: number;
}

/** Items inside ActiveList. A missing ListingStatus still means the listing is active. */
export function readActiveList(xml: string): ActiveListRead {
  const section = xml.match(/<ActiveList\b[^>]*>([\s\S]*?)<\/ActiveList>/i)?.[1] ?? "";
  const pagesMatch = section.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/i);
  const entriesMatch = section.match(/<TotalNumberOfEntries>(\d+)<\/TotalNumberOfEntries>/i);
  const pages = pagesMatch ? Number(pagesMatch[1]) : null;
  const entries = entriesMatch ? Number(entriesMatch[1]) : null;
  const received: ListingSnapshot[] = [];
  let unrecognized = 0;
  const pattern = /<Item\b[^>]*>([\s\S]*?)<\/Item>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(section))) {
    const block = match[1];
    const itemId = tagValue(block, "ItemID");
    if (!itemId) continue;
    const rawStatus = tagValue(block, "ListingStatus").toLowerCase();
    let status: ListingSnapshot["status"];
    if (!rawStatus || rawStatus === "active") status = "active";
    else if (rawStatus === "completed" || rawStatus === "ended") status = "ended";
    else {
      unrecognized += 1;
      status = "other";
    }
    const quantity = Number(tagValue(block, "QuantitySold") || "0");
    received.push({
      itemId,
      sku: tagValue(block, "SKU"),
      title: tagValue(block, "Title"),
      status,
      quantitySold: Number.isFinite(quantity) ? quantity : 0,
      endTime: tagValue(block, "EndTime"),
    });
  }
  return {
    pages: pages != null && Number.isFinite(pages) ? pages : null,
    entries: entries != null && Number.isFinite(entries) ? entries : null,
    received,
    active: received.filter((listing) => listing.status === "active"),
    unrecognized,
  };
}

export function ebaySellerUserId(xml: string): string {
  const user = xml.match(/<User\b[^>]*>([\s\S]*?)<\/User>/i)?.[1] ?? "";
  return tagValue(user, "UserID");
}

export async function fetchEbaySellerUser(accessToken: string): Promise<string | null> {
  try {
    const xml = await tradingCall(
      accessToken,
      "GetUser",
      `<?xml version="1.0" encoding="utf-8"?>
<GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents"></GetUserRequest>`
    );
    return ebaySellerUserId(xml) || null;
  } catch (error) {
    console.error("[ebay/user]", error instanceof Error ? error.name : "Error");
    return null;
  }
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
): Promise<
  | {
      ok: true;
      listings: ListingSnapshot[];
      pages: number;
      received: number;
      entries: number | null;
      withSku: number;
    }
  | { ok: false; error: string }
> {
  const listings: ListingSnapshot[] = [];
  let received = 0;
  let reported = 1;
  let entries: number | null = null;
  try {
    for (let page = 1; page <= reported; page += 1) {
      if (page > PAGE_SAFETY_CAP) {
        return {
          ok: false,
          error: `eBay devolvió demasiadas páginas. ${UNCLASSIFIED}`,
        };
      }
      // ReturnAll makes eBay ignore ActiveList and send every list. A large account then comes back truncated.
      const xml = await tradingCall(
        accessToken,
        "GetMyeBaySelling",
        `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>${PAGE_SIZE}</EntriesPerPage>
      <PageNumber>${page}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`
      );
      if (/<Ack>Warning<\/Ack>/i.test(xml) && /truncat/i.test(xml)) {
        return {
          ok: false,
          error: `eBay cortó la respuesta antes de entregar el inventario activo. ${UNCLASSIFIED}`,
        };
      }
      const parsed = readActiveList(xml);
      if (parsed.unrecognized > 0) {
        return {
          ok: false,
          error: `eBay devolvió un estado de anuncio que no se puede clasificar. ${UNCLASSIFIED}`,
        };
      }
      const pages = parsed.pages ?? (parsed.received.length < PAGE_SIZE ? 1 : null);
      if (pages == null || pages < 1) {
        if (pages === 0 && parsed.received.length === 0 && (parsed.entries ?? 0) === 0) {
          return { ok: true, listings: [], pages: 0, received: 0, entries: 0, withSku: 0 };
        }
        return {
          ok: false,
          error: `eBay no indicó todas las páginas del inventario. ${UNCLASSIFIED}`,
        };
      }
      if (page === 1) {
        reported = pages;
        entries = parsed.entries;
      } else if (pages !== reported || parsed.entries !== entries) {
        return {
          ok: false,
          error: `eBay cambió el total del inventario mientras se leían las páginas. ${UNCLASSIFIED}`,
        };
      }
      if (parsed.received.length === 0 && (entries ?? 0) > 0) {
        return {
          ok: false,
          error: `eBay indicó ${entries} anuncios en ${reported} páginas, pero una página no trajo ninguno. ${UNCLASSIFIED}`,
        };
      }
      received += parsed.received.length;
      listings.push(...parsed.active);
    }
  } catch (error) {
    console.error("[ebay/active-inventory]", error instanceof Error ? error.name : "Error");
    return {
      ok: false,
      error: `No se pudo leer el inventario activo de eBay. ${UNCLASSIFIED}`,
    };
  }
  if (entries != null && entries !== received) {
    return {
      ok: false,
      error: `eBay indicó ${entries} anuncios y se leyeron ${received}. ${UNCLASSIFIED}`,
    };
  }
  if ((entries ?? received) > 0 && listings.length === 0) {
    return {
      ok: false,
      error: `eBay indicó ${entries ?? received} anuncios en ${reported} páginas, pero el catálogo para comparar quedó vacío. ${UNCLASSIFIED}`,
    };
  }
  return {
    ok: true,
    listings,
    pages: reported,
    received,
    entries,
    withSku: listings.filter((listing) => listing.sku.trim()).length,
  };
}
