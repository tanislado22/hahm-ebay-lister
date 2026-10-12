import crypto from "crypto";
import { ensureInventoryTables, getSql } from "@/lib/db";
import {
  matchVintedListing,
  type EbayInventoryCandidate,
  type VintedCollectedItem,
  type VintedInventoryMatch,
  type VintedMatchStatus,
} from "@/lib/vinted/inventory-match";

export interface VintedInventoryRow {
  vintedItemId: string;
  title: string;
  url: string;
  photoUrl: string;
  brand: string;
  size: string;
  sku: string;
  suggestedSku: string;
  status: VintedMatchStatus;
  detail: string;
  syncedAt: string;
  verifiedAt: string;
}

export interface VintedInventoryCounts {
  collected: number;
  identified: number;
  review: number;
  unmatched: number;
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function mapRow(row: Record<string, unknown>): VintedInventoryRow {
  const status = text(row.match_status);
  return {
    vintedItemId: text(row.vinted_item_id),
    title: text(row.title),
    url: text(row.url),
    photoUrl: text(row.photo_url),
    brand: text(row.brand),
    size: text(row.size),
    sku: text(row.sku),
    suggestedSku: text(row.suggested_sku),
    status: status === "verified" || status === "review" ? status : "unmatched",
    detail: text(row.detail),
    syncedAt: text(row.synced_at),
    verifiedAt: text(row.verified_at),
  };
}

export async function listEbayMatchCandidates(): Promise<EbayInventoryCandidate[]> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT sku, ebay_title, vinted_title, prepared
    FROM platform_listings
    WHERE sku IS NOT NULL AND btrim(sku) <> ''
  `;
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    const prepared = record.prepared && typeof record.prepared === "object" ? (record.prepared as Record<string, unknown>) : {};
    return {
      sku: text(record.sku).trim(),
      ebayTitle: text(record.ebay_title),
      vintedTitle: text(record.vinted_title),
      brand: text(prepared.brand),
      size: text(prepared.size),
      photoUrl: "",
    };
  });
}

async function saveMatch(item: VintedCollectedItem, match: VintedInventoryMatch): Promise<"inserted" | "kept" | "updated"> {
  const sql = getSql();
  await ensureInventoryTables();
  const id = crypto.randomUUID();
  const verifiedAt = match.status === "verified" ? new Date().toISOString() : null;
  const inserted = await sql`
    INSERT INTO vinted_inventory_links (
      id, vinted_item_id, title, url, photo_url, brand, size,
      sku, suggested_sku, match_status, detail, synced_at, verified_at, created_at, updated_at
    )
    VALUES (
      ${id},
      ${item.vintedItemId},
      ${match.title || item.title},
      ${item.url},
      ${item.photoUrl},
      ${item.brand},
      ${item.size},
      ${match.sku},
      ${match.suggestedSku},
      ${match.status},
      ${match.detail},
      NOW(),
      ${verifiedAt},
      NOW(),
      NOW()
    )
    ON CONFLICT (vinted_item_id) DO NOTHING
    RETURNING id
  `;
  if (inserted.length > 0) return "inserted";

  const kept = await sql`
    UPDATE vinted_inventory_links
    SET
      url = ${item.url},
      photo_url = CASE WHEN ${item.photoUrl} <> '' THEN ${item.photoUrl} ELSE photo_url END,
      synced_at = NOW(),
      updated_at = NOW()
    WHERE vinted_item_id = ${item.vintedItemId}
      AND match_status = 'verified'
    RETURNING id
  `;
  if (kept.length > 0) return "kept";

  await sql`
    UPDATE vinted_inventory_links
    SET
      title = ${match.title || item.title},
      url = ${item.url},
      photo_url = ${item.photoUrl},
      brand = ${item.brand},
      size = ${item.size},
      sku = ${match.sku},
      suggested_sku = ${match.suggestedSku},
      match_status = ${match.status},
      detail = ${match.detail},
      synced_at = NOW(),
      verified_at = ${verifiedAt},
      updated_at = NOW()
    WHERE vinted_item_id = ${item.vintedItemId}
      AND match_status <> 'verified'
  `;
  return "updated";
}

export async function syncVintedInventory(items: VintedCollectedItem[]): Promise<{
  received: number;
  inserted: number;
  updated: number;
  keptVerified: number;
}> {
  const candidates = await listEbayMatchCandidates();
  const result = { received: items.length, inserted: 0, updated: 0, keptVerified: 0 };
  for (const item of items) {
    const outcome = await saveMatch(item, matchVintedListing(item, candidates));
    if (outcome === "inserted") result.inserted += 1;
    else if (outcome === "kept") result.keptVerified += 1;
    else result.updated += 1;
  }
  return result;
}

export async function listVintedInventory(query: string): Promise<VintedInventoryRow[]> {
  const sql = getSql();
  await ensureInventoryTables();
  const needle = `%${query.trim()}%`;
  const rows = query.trim()
    ? await sql`
        SELECT *
        FROM vinted_inventory_links
        WHERE title ILIKE ${needle}
          OR sku ILIKE ${needle}
          OR suggested_sku ILIKE ${needle}
          OR vinted_item_id ILIKE ${needle}
        ORDER BY updated_at DESC
        LIMIT 300
      `
    : await sql`
        SELECT *
        FROM vinted_inventory_links
        ORDER BY updated_at DESC
        LIMIT 300
      `;
  return rows.map((row) => mapRow(row as Record<string, unknown>));
}

export async function vintedInventoryCounts(): Promise<VintedInventoryCounts> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT match_status, COUNT(*)::int AS total
    FROM vinted_inventory_links
    GROUP BY match_status
  `;
  const counts = { collected: 0, identified: 0, review: 0, unmatched: 0 };
  for (const row of rows) {
    const record = row as { match_status?: string; total?: number };
    const total = Number(record.total || 0);
    counts.collected += total;
    if (record.match_status === "verified") counts.identified += total;
    else if (record.match_status === "review") counts.review += total;
    else counts.unmatched += total;
  }
  return counts;
}

export async function confirmVintedInventoryMatch(vintedItemId: string, sku: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const wantedId = vintedItemId.trim();
  const wantedSku = sku.trim();
  if (!wantedId || !wantedSku) return { ok: false, error: "Faltan el anuncio de Vinted o el SKU." };
  const sql = getSql();
  await ensureInventoryTables();
  const known = await sql`
    SELECT sku FROM platform_listings WHERE sku = ${wantedSku} LIMIT 1
  `;
  if (!known.length) return { ok: false, error: "Ese SKU no está en el inventario de eBay." };
  const updated = await sql`
    UPDATE vinted_inventory_links
    SET
      sku = ${wantedSku},
      suggested_sku = '',
      match_status = 'verified',
      detail = 'Confirmado manualmente.',
      verified_at = NOW(),
      updated_at = NOW()
    WHERE vinted_item_id = ${wantedId}
      AND match_status <> 'verified'
    RETURNING id
  `;
  if (!updated.length) return { ok: false, error: "Esa asociación ya está verificada o no existe." };
  return { ok: true };
}

export async function findVerifiedVintedUrl(sku: string): Promise<string | null> {
  const wanted = sku.trim();
  if (!wanted) return null;
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT url
    FROM vinted_inventory_links
    WHERE sku = ${wanted}
      AND match_status = 'verified'
      AND btrim(url) <> ''
    ORDER BY verified_at DESC NULLS LAST
    LIMIT 1
  `;
  const url = text((rows[0] as { url?: string } | undefined)?.url).trim();
  return url || null;
}
