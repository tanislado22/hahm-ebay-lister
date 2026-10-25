import { fetchSellerItem } from "@/lib/ebay/seller-listings";
import { normalizeListingStatus, type ListingSnapshot } from "@/lib/ebay/ended-listing";
import {
  ebayItemIdText,
  planEbayRelinks,
  type EbayRelinkSummary,
  type OldListingState,
  type StoredEbayArticle,
} from "@/lib/ebay/relist-link";
import { ensureInventoryTables, getSql } from "@/lib/db";

export interface EbayRelinkResult extends EbayRelinkSummary {
  ok: boolean;
  error: string;
}

type ArticleSource = "platform" | "vinted";

interface LinkedArticle extends StoredEbayArticle {
  source: ArticleSource;
  recordId: string;
}

function mapArticle(row: Record<string, unknown>, source: ArticleSource): LinkedArticle {
  const recordId = String(row.id ?? "");
  return {
    id: `${source}:${recordId}`,
    recordId,
    source,
    sku: String(row.sku ?? ""),
    itemId: String(row.ebay_item_id ?? ""),
  };
}

async function storedArticles(): Promise<LinkedArticle[]> {
  const sql = getSql();
  await ensureInventoryTables();
  const listings = await sql`
    SELECT id, sku, ebay_item_id
    FROM platform_listings
    WHERE ebay_item_id IS NOT NULL AND btrim(ebay_item_id) <> ''
  `;
  const vinted = await sql`
    SELECT id, sku, ebay_item_id
    FROM vinted_inventory_links
    WHERE ebay_item_id IS NOT NULL AND btrim(ebay_item_id) <> ''
  `;
  return [
    ...listings.map((row) => mapArticle(row as Record<string, unknown>, "platform")),
    ...vinted.map((row) => mapArticle(row as Record<string, unknown>, "vinted")),
  ];
}

async function replaceItemId(article: LinkedArticle, nextItemId: string): Promise<void> {
  const sql = getSql();
  await ensureInventoryTables();
  const previousItemId = ebayItemIdText(article.itemId);
  if (article.source === "platform") {
    await sql`
      UPDATE platform_listings
      SET ebay_item_id = ${nextItemId}, updated_at = NOW()
      WHERE id = ${article.recordId}
        AND regexp_replace(ebay_item_id, '[^0-9]', '', 'g') = ${previousItemId}
    `;
    return;
  }
  await sql`
    UPDATE vinted_inventory_links
    SET ebay_item_id = ${nextItemId}, updated_at = NOW()
    WHERE id = ${article.recordId}
      AND regexp_replace(ebay_item_id, '[^0-9]', '', 'g') = ${previousItemId}
  `;
}

const LOOKUP_BUDGET_MS = 20000;
const LOOKUP_TIMEOUT_MS = 8000;

export async function acquireRelinkLock(): Promise<boolean> {
  const sql = getSql();
  await ensureInventoryTables();
  await sql`
    CREATE TABLE IF NOT EXISTS ebay_relink_lock (
      id TEXT PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL
    )
  `;
  const rows = await sql`
    INSERT INTO ebay_relink_lock (id, started_at)
    VALUES ('store', NOW())
    ON CONFLICT (id) DO UPDATE
    SET started_at = EXCLUDED.started_at
    WHERE ebay_relink_lock.started_at < NOW() - INTERVAL '2 minutes'
    RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0;
}

export async function releaseRelinkLock(): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM ebay_relink_lock WHERE id = 'store'`;
}

export async function refreshEbayLinksFromListings(
  accessToken: string,
  listings: readonly ListingSnapshot[]
): Promise<EbayRelinkResult> {
  const articles = await storedArticles();
  const activeIds = new Set(listings.filter((listing) => listing.status === "active").map((listing) => ebayItemIdText(listing.itemId)));
  const states = new Map<string, OldListingState>();
  const lookupStarted = Date.now();
  for (const article of articles) {
    const itemId = ebayItemIdText(article.itemId);
    if (!itemId || states.has(itemId) || activeIds.has(itemId)) continue;
    if (Date.now() - lookupStarted > LOOKUP_BUDGET_MS) {
      states.set(itemId, "unknown");
      continue;
    }
    const listing = await Promise.race([
      fetchSellerItem(accessToken, itemId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS)),
    ]);
    if (!listing) {
      states.set(itemId, "unknown");
      continue;
    }
    const status = normalizeListingStatus(listing.status);
    states.set(itemId, status === "ended" ? "ended" : status === "active" ? "active" : "unknown");
  }
  const summary = planEbayRelinks({
    articles,
    active: listings,
    catalogComplete: true,
    oldState: (itemId) => (activeIds.has(itemId) ? "active" : states.get(itemId) ?? "unknown"),
  });
  const articlesById = new Map(articles.map((article) => [article.id, article]));
  for (const plan of summary.plans) {
    const article = articlesById.get(plan.id);
    if (!article || plan.outcome !== "updated" || !plan.nextItemId) continue;
    await replaceItemId(article, plan.nextItemId);
  }
  return { ...summary, ok: true, error: "" };
}
