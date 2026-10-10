import crypto from "crypto";
import { listEbayConnections } from "@/lib/ebay/client-connections";
import { decideEndedListing, type ListingSnapshot, type ListingWatch } from "@/lib/ebay/ended-listing";
import { fetchRecentOrderLines } from "@/lib/ebay/orders";
import { accessTokenFromCookie } from "@/lib/ebay/session";
import {
  fetchActiveSellerListings,
  fetchRecentlyEndedSellerListings,
  fetchSellerItem,
} from "@/lib/ebay/seller-listings";
import { ensureInventoryTables, getSql } from "@/lib/db";
import { endedListingMessage } from "@/lib/telegram/message";
import { sendTelegramPlain } from "@/lib/telegram/send";

const ORDER_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const ENDED_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_STORED_LOOKUPS = 40;

export interface EndedCheckResult {
  listings: number;
  baseline: number;
  notified: number;
  ebaySales: number;
  duplicates: number;
  skipped: number;
  errors: string[];
  planned: { itemId: string; sku: string; title: string; eventId: string }[];
}

async function storedEbayItems(): Promise<{ itemId: string; sku: string; title: string }[]> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT ebay_item_id, sku, ebay_title
    FROM platform_listings
    WHERE ebay_item_id IS NOT NULL
      AND ebay_item_id <> ''
  `;
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      itemId: String(record.ebay_item_id ?? ""),
      sku: String(record.sku ?? ""),
      title: String(record.ebay_title ?? ""),
    };
  });
}

async function loadWatches(): Promise<Map<string, ListingWatch>> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT ebay_item_id, listing_status, notified_event_id
    FROM ebay_listing_watches
  `;
  const watches = new Map<string, ListingWatch>();
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const itemId = String(record.ebay_item_id ?? "");
    const status = String(record.listing_status ?? "other");
    if (!itemId) continue;
    watches.set(itemId, {
      itemId,
      status: status === "active" || status === "ended" ? status : "other",
      notifiedEventId: record.notified_event_id ? String(record.notified_event_id) : null,
    });
  }
  return watches;
}

async function saveWatch(
  listing: ListingSnapshot,
  status: ListingWatch["status"],
  notifiedEventId: string | null
): Promise<void> {
  const sql = getSql();
  await ensureInventoryTables();
  await sql`
    INSERT INTO ebay_listing_watches (
      ebay_item_id, sku, title, listing_status, quantity_sold, end_time,
      notified_event_id, first_seen_at, last_seen_at
    )
    VALUES (
      ${listing.itemId},
      ${listing.sku || null},
      ${listing.title || null},
      ${status},
      ${listing.quantitySold},
      ${listing.endTime || null},
      ${notifiedEventId},
      NOW(),
      NOW()
    )
    ON CONFLICT (ebay_item_id) DO UPDATE SET
      sku = COALESCE(EXCLUDED.sku, ebay_listing_watches.sku),
      title = COALESCE(EXCLUDED.title, ebay_listing_watches.title),
      listing_status = EXCLUDED.listing_status,
      quantity_sold = EXCLUDED.quantity_sold,
      end_time = COALESCE(EXCLUDED.end_time, ebay_listing_watches.end_time),
      notified_event_id = COALESCE(EXCLUDED.notified_event_id, ebay_listing_watches.notified_event_id),
      last_seen_at = NOW()
  `;
}

async function claimEndedNotice(itemId: string, eventId: string): Promise<"owned" | "duplicate"> {
  const sql = getSql();
  await ensureInventoryTables();
  const id = crypto.randomUUID();
  const inserted = await sql`
    INSERT INTO ebay_ended_notices (
      id, ebay_item_id, event_id, status, created_at, updated_at
    )
    VALUES (
      ${id},
      ${itemId},
      ${eventId},
      'pending',
      NOW(),
      NOW()
    )
    ON CONFLICT (ebay_item_id, event_id) DO NOTHING
    RETURNING id
  `;
  if (inserted.length > 0) return "owned";
  const claimed = await sql`
    UPDATE ebay_ended_notices
    SET status = 'pending', updated_at = NOW()
    WHERE ebay_item_id = ${itemId}
      AND event_id = ${eventId}
      AND sent_at IS NULL
      AND (
        status = 'failed'
        OR (status = 'pending' AND updated_at < NOW() - INTERVAL '3 minutes')
      )
    RETURNING id
  `;
  return claimed.length > 0 ? "owned" : "duplicate";
}

async function finishEndedNotice(itemId: string, eventId: string, status: "sent" | "failed"): Promise<void> {
  const sql = getSql();
  await ensureInventoryTables();
  if (status === "sent") {
    await sql`
      UPDATE ebay_ended_notices
      SET status = 'sent', sent_at = NOW(), updated_at = NOW()
      WHERE ebay_item_id = ${itemId}
        AND event_id = ${eventId}
    `;
    return;
  }
  await sql`
    UPDATE ebay_ended_notices
    SET status = 'failed', updated_at = NOW()
    WHERE ebay_item_id = ${itemId}
      AND event_id = ${eventId}
      AND sent_at IS NULL
  `;
}

function fillFromStored(
  listing: ListingSnapshot,
  stored: { sku: string; title: string } | undefined
): ListingSnapshot {
  if (!stored) return listing;
  return {
    ...listing,
    sku: listing.sku.trim() || stored.sku.trim(),
    title: listing.title.trim() || stored.title.trim(),
  };
}

export async function runEbayEndedCheck(options: { send: boolean }): Promise<EndedCheckResult> {
  const result: EndedCheckResult = {
    listings: 0,
    baseline: 0,
    notified: 0,
    ebaySales: 0,
    duplicates: 0,
    skipped: 0,
    errors: [],
    planned: [],
  };
  const connections = await listEbayConnections();
  const watches = await loadWatches();
  const stored = await storedEbayItems();
  const sinceOrders = new Date(Date.now() - ORDER_LOOKBACK_MS);
  const endedFrom = new Date(Date.now() - ENDED_LOOKBACK_MS);
  const endedTo = new Date(Date.now() + 60 * 60 * 1000);

  for (const connection of connections) {
    let accessToken: string | null = null;
    try {
      accessToken = await accessTokenFromCookie(connection.sealedConnection);
    } catch (error) {
      result.errors.push(`${connection.connectionKey}: ${(error as Error).message}`);
      continue;
    }
    if (!accessToken) {
      result.errors.push(`${connection.connectionKey}: stored eBay connection could not be opened`);
      continue;
    }

    const byItem = new Map<string, ListingSnapshot>();
    try {
      for (const listing of await fetchActiveSellerListings(accessToken)) {
        byItem.set(listing.itemId, listing);
      }
      for (const listing of await fetchRecentlyEndedSellerListings(accessToken, endedFrom, endedTo)) {
        byItem.set(listing.itemId, listing);
      }
    } catch (error) {
      result.errors.push(`${connection.connectionKey}: ${(error as Error).message}`);
      continue;
    }

    const storedById = new Map(stored.map((row) => [row.itemId, row]));
    let lookups = 0;
    for (const row of stored) {
      if (byItem.has(row.itemId) || lookups >= MAX_STORED_LOOKUPS) continue;
      lookups += 1;
      const listing = await fetchSellerItem(accessToken, row.itemId);
      if (listing) byItem.set(listing.itemId, listing);
    }

    let soldItemIds = new Set<string>();
    try {
      const lines = await fetchRecentOrderLines(accessToken, sinceOrders);
      soldItemIds = new Set(lines.filter((line) => !line.cancelled && line.legacyItemId).map((line) => line.legacyItemId));
    } catch (error) {
      result.errors.push(`${connection.connectionKey}: order lookup failed, withdrawal notices skipped`);
      console.error("[ebay-ended] orders", connection.connectionKey, error);
      continue;
    }

    for (const listing of byItem.values()) {
      result.listings += 1;
      const filled = fillFromStored(listing, storedById.get(listing.itemId));
      const previous = watches.get(filled.itemId) ?? null;
      const decision = decideEndedListing(previous, filled, soldItemIds.has(filled.itemId));
      const nextStatus = decision.action === "notify" ? "ended" : decision.status;
      let nextEvent = previous?.notifiedEventId ?? null;

      if (decision.action === "notify") {
        result.planned.push({
          itemId: filled.itemId,
          sku: decision.sku,
          title: decision.title,
          eventId: decision.eventId,
        });
        if (!options.send) {
          result.notified += 1;
          nextEvent = decision.eventId;
        } else {
          const claim = await claimEndedNotice(filled.itemId, decision.eventId);
          if (claim === "duplicate") {
            result.duplicates += 1;
            continue;
          } else {
            try {
              await sendTelegramPlain(endedListingMessage(decision.sku, decision.title));
              await finishEndedNotice(filled.itemId, decision.eventId, "sent");
              nextEvent = decision.eventId;
              result.notified += 1;
            } catch (error) {
              await finishEndedNotice(filled.itemId, decision.eventId, "failed");
              result.errors.push(`${filled.itemId}: Telegram failed`);
              console.error("[ebay-ended] telegram", filled.itemId, error);
              continue;
            }
          }
        }
      } else if (decision.action === "baseline") result.baseline += 1;
      else if (decision.action === "ignore" && decision.reason === "ebay-sale") result.ebaySales += 1;
      else if (decision.action === "ignore" && decision.reason === "already-notified") result.duplicates += 1;
      else result.skipped += 1;

      watches.set(filled.itemId, {
        itemId: filled.itemId,
        status: nextStatus,
        notifiedEventId: nextEvent,
      });
      if (!options.send) continue;
      try {
        await saveWatch(filled, nextStatus, nextEvent);
      } catch (error) {
        result.errors.push(`${filled.itemId}: ${(error as Error).message}`);
      }
    }
  }

  return result;
}
