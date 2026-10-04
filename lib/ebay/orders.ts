import { EBAY_MARKETPLACE_ID } from "@/lib/ebay/config";

const FULFILLMENT_BASE = "https://api.ebay.com/sell/fulfillment/v1";

export interface EbaySaleLine {
  orderId: string;
  lineItemId: string;
  sku: string;
  title: string;
  legacyItemId: string;
  cancelled: boolean;
}

interface EbayOrderJson {
  orderId?: string;
  cancelStatus?: { cancelState?: string };
  lineItems?: {
    lineItemId?: string;
    legacyItemId?: string;
    sku?: string;
    title?: string;
  }[];
}

// Read-only order lookup. This does not create, revise, or end listings.
export async function fetchRecentOrderLines(
  accessToken: string,
  since: Date
): Promise<EbaySaleLine[]> {
  const filter = `creationdate:[${since.toISOString()}..]`;
  let url = `${FULFILLMENT_BASE}/order?filter=${encodeURIComponent(filter)}&limit=50`;
  const lines: EbaySaleLine[] = [];

  for (let page = 0; page < 10 && url; page++) {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
      },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`eBay order lookup failed (${resp.status}): ${text.slice(0, 200)}`);
    }
    const data = (await resp.json()) as { orders?: EbayOrderJson[]; next?: string };
    for (const order of data.orders ?? []) {
      const cancelState = order.cancelStatus?.cancelState ?? "";
      const cancelled = cancelState === "CANCELED" || cancelState === "CANCELLED";
      const orderId = order.orderId ?? "";
      for (const item of order.lineItems ?? []) {
        if (!orderId || !item.lineItemId) continue;
        lines.push({
          orderId,
          lineItemId: item.lineItemId,
          sku: (item.sku ?? "").trim(),
          title: (item.title ?? "").trim(),
          legacyItemId: (item.legacyItemId ?? "").trim(),
          cancelled,
        });
      }
    }
    if (!data.next) break;
    url = data.next.startsWith("http") ? data.next : `https://api.ebay.com${data.next}`;
  }

  return lines;
}
