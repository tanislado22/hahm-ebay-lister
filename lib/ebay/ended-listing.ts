export type ListingWatchStatus = "active" | "ended" | "other";

export interface ListingSnapshot {
  itemId: string;
  sku: string;
  title: string;
  status: ListingWatchStatus;
  quantitySold: number;
  endTime: string;
}

export interface ListingWatch {
  itemId: string;
  status: ListingWatchStatus;
  notifiedEventId: string | null;
}

export type EndedListingDecision =
  | { action: "baseline"; status: ListingWatchStatus }
  | { action: "keep"; status: ListingWatchStatus }
  | {
      action: "ignore";
      reason: "ebay-sale" | "already-notified" | "missing-sku" | "missing-title" | "not-ended";
      status: ListingWatchStatus;
    }
  | { action: "notify"; eventId: string; sku: string; title: string };

export function endingEventId(itemId: string, endTime: string): string {
  const when = endTime.trim() || "ended";
  return `${itemId.trim()}:${when}`;
}

export function normalizeListingStatus(value: string): ListingWatchStatus {
  const status = value.trim().toLowerCase();
  if (status === "active") return "active";
  if (status === "completed" || status === "ended") return "ended";
  return "other";
}

// A listing notifies only after we have already seen it active. The first
// observation, including listings that were already ended, is a baseline.
export function decideEndedListing(
  previous: ListingWatch | null,
  current: ListingSnapshot,
  hasConfirmedEbayOrder: boolean
): EndedListingDecision {
  const soldOnEbay = current.quantitySold > 0 || hasConfirmedEbayOrder;
  if (soldOnEbay) {
    return { action: "ignore", reason: "ebay-sale", status: "ended" };
  }
  if (current.status !== "ended") {
    if (!previous) return { action: "baseline", status: current.status };
    return { action: "keep", status: current.status };
  }
  if (!previous) return { action: "baseline", status: "ended" };
  const eventId = endingEventId(current.itemId, current.endTime);
  if (previous.notifiedEventId === eventId) {
    return { action: "ignore", reason: "already-notified", status: "ended" };
  }
  if (previous.status !== "active") {
    return { action: "ignore", reason: "not-ended", status: "ended" };
  }
  const sku = current.sku.trim();
  const title = current.title.trim();
  if (!sku) return { action: "ignore", reason: "missing-sku", status: "ended" };
  if (!title) return { action: "ignore", reason: "missing-title", status: "ended" };
  return { action: "notify", eventId, sku, title };
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

export function parseTradingItems(xml: string): ListingSnapshot[] {
  const items: ListingSnapshot[] = [];
  const pattern = /<Item\b[^>]*>([\s\S]*?)<\/Item>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const block = match[1];
    const itemId = tag(block, "ItemID");
    if (!itemId) continue;
    const quantity = Number(tag(block, "QuantitySold") || "0");
    items.push({
      itemId,
      sku: tag(block, "SKU"),
      title: tag(block, "Title"),
      status: normalizeListingStatus(tag(block, "ListingStatus")),
      quantitySold: Number.isFinite(quantity) ? quantity : 0,
      endTime: tag(block, "EndTime"),
    });
  }
  return items;
}
