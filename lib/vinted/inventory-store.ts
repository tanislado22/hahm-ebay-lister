import crypto from "crypto";
import { ensureInventoryTables, getSql } from "@/lib/db";
import {
  matchVintedListing,
  type EbayInventoryCandidate,
  type VintedCollectedItem,
  type VintedInventoryMatch,
  type VintedMatchStatus,
} from "@/lib/vinted/inventory-match";
import {
  classifySoldListing,
  findPossibleDuplicates,
  type DuplicateGroup,
  type KnownSale,
} from "@/lib/vinted/inventory-review";

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
  listedSku: string;
  duplicateStatus: "" | "suspected" | "confirmed" | "dismissed";
  duplicateWith: string;
  soldStatus: "" | "pending_removal" | "review" | "withdrawn" | "not_sold";
  soldPlatform: string;
  soldAt: string;
  soldDetail: string;
}

export interface VintedInventoryCounts {
  collected: number;
  identified: number;
  duplicates: number;
  soldPending: number;
  needsReview: number;
  reviewed: number;
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function timeText(value: unknown): string {
  if (value == null || value === "") return "";
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function reviewListing(item: VintedInventoryRow): { vintedItemId: string; sku: string; title: string; photoUrl: string } {
  return {
    vintedItemId: item.vintedItemId,
    sku: item.sku || item.listedSku,
    title: item.title,
    photoUrl: item.photoUrl,
  };
}

function asDuplicate(value: string): VintedInventoryRow["duplicateStatus"] {
  if (value === "suspected" || value === "confirmed" || value === "dismissed") return value;
  return "";
}

function asSold(value: string): VintedInventoryRow["soldStatus"] {
  if (value === "pending_removal" || value === "review" || value === "withdrawn" || value === "not_sold") return value;
  return "";
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
    listedSku: text(row.listed_sku),
    duplicateStatus: asDuplicate(text(row.duplicate_status)),
    duplicateWith: text(row.duplicate_with),
    soldStatus: asSold(text(row.sold_status)),
    soldPlatform: text(row.sold_platform),
    soldAt: timeText(row.sold_at),
    soldDetail: text(row.sold_detail),
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
      sku, suggested_sku, match_status, detail, listed_sku, synced_at, verified_at, created_at, updated_at
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
      ${item.listedSku || ""},
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
      listed_sku = ${item.listedSku || ""},
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
  await refreshInventorySignals();
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
          OR listed_sku ILIKE ${needle}
          OR vinted_item_id ILIKE ${needle}
        ORDER BY updated_at DESC
        LIMIT 800
      `
    : await sql`
        SELECT *
        FROM vinted_inventory_links
        ORDER BY updated_at DESC
        LIMIT 800
      `;
  return rows.map((row) => mapRow(row as Record<string, unknown>));
}

export async function vintedInventoryCounts(): Promise<VintedInventoryCounts> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`SELECT match_status, duplicate_status, sold_status, sku FROM vinted_inventory_links`;
  const reviewed = await sql`
    SELECT COUNT(DISTINCT vinted_item_id)::int AS total
    FROM vinted_inventory_events
    WHERE event_type IN ('confirm_match', 'confirm_duplicate', 'not_duplicate', 'withdrawn', 'not_sold')
  `;
  const counts: VintedInventoryCounts = {
    collected: rows.length,
    identified: 0,
    duplicates: 0,
    soldPending: 0,
    needsReview: 0,
    reviewed: Number((reviewed[0] as { total?: number } | undefined)?.total || 0),
  };
  for (const row of rows) {
    const record = row as { match_status?: string; duplicate_status?: string; sold_status?: string; sku?: string };
    if (record.match_status === "verified") counts.identified += 1;
    if (record.duplicate_status === "suspected" || record.duplicate_status === "confirmed") counts.duplicates += 1;
    if (record.sold_status === "pending_removal") counts.soldPending += 1;
    const needsSku = record.match_status !== "verified" && !text(record.sku).trim();
    if (record.match_status === "review" || record.match_status === "unmatched" || record.sold_status === "review" || needsSku) {
      counts.needsReview += 1;
    }
  }
  return counts;
}

async function recordEvent(vintedItemId: string, eventType: string, detail: string): Promise<void> {
  const sql = getSql();
  await ensureInventoryTables();
  await sql`
    INSERT INTO vinted_inventory_events (id, vinted_item_id, event_type, detail, created_at)
    VALUES (${crypto.randomUUID()}, ${vintedItemId}, ${eventType}, ${detail}, NOW())
  `;
}

async function loadKnownSales(): Promise<KnownSale[]> {
  const sql = getSql();
  await ensureInventoryTables();
  const notices = await sql`
    SELECT platform, sku, title, COALESCE(sent_at, created_at) AS sold_at
    FROM telegram_sale_notices
    WHERE status = 'sent' AND platform IN ('ebay', 'depop', 'poshmark')
  `;
  const events = await sql`
    SELECT platform, sku, title, detected_at AS sold_at
    FROM sale_events
    WHERE status = 'sent' AND platform IN ('ebay', 'depop', 'poshmark')
  `;
  const sales: KnownSale[] = [];
  for (const row of [...notices, ...events]) {
    const record = row as { platform?: string; sku?: string; title?: string; sold_at?: string };
    const platform = record.platform;
    if (platform !== "ebay" && platform !== "depop" && platform !== "poshmark") continue;
    sales.push({
      platform,
      sku: text(record.sku).trim(),
      title: text(record.title),
      soldAt: timeText(record.sold_at),
    });
  }
  return sales;
}

export async function refreshInventorySignals(): Promise<void> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`SELECT * FROM vinted_inventory_links`;
  const dismissals = await sql`SELECT item_a, item_b FROM vinted_duplicate_dismissals`;
  const pairs = dismissals.map((row) => {
    const record = row as { item_a?: string; item_b?: string };
    return [text(record.item_a), text(record.item_b)] as [string, string];
  });
  const listings = rows.map((row) => mapRow(row as Record<string, unknown>));
  const groups = findPossibleDuplicates(listings.map(reviewListing), pairs);
  const grouped = new Map<string, string[]>();
  for (const group of groups) {
    for (const id of group.itemIds) {
      const others = group.itemIds.filter((itemId) => itemId !== id);
      grouped.set(id, [...new Set([...(grouped.get(id) ?? []), ...others])]);
    }
  }
  const sales = await loadKnownSales();
  const activeWithSku = new Map<string, number>();
  for (const item of listings) {
    if (item.soldStatus === "withdrawn" || !item.sku) continue;
    activeWithSku.set(item.sku, (activeWithSku.get(item.sku) ?? 0) + 1);
  }
  for (const item of listings) {
    const partners = grouped.get(item.vintedItemId) ?? [];
    const duplicateStatus = item.duplicateStatus === "confirmed"
      ? "confirmed"
      : partners.length
        ? "suspected"
        : item.duplicateStatus === "dismissed"
          ? "dismissed"
          : "";
    const duplicateWith = partners.join(",");
    let soldStatus = item.soldStatus;
    let soldPlatform = item.soldPlatform;
    let soldAt = item.soldAt || null;
    let soldDetail = item.soldDetail;
    if (soldStatus !== "withdrawn" && soldStatus !== "not_sold") {
      const decision = classifySoldListing({
        sku: item.sku,
        title: item.title,
        listingsWithSku: item.sku ? activeWithSku.get(item.sku) ?? 0 : 0,
        sales,
      });
      soldStatus = decision.soldStatus;
      soldPlatform = decision.platform;
      soldAt = decision.soldAt || null;
      soldDetail = decision.detail;
      if (decision.soldStatus === "pending_removal" && item.soldStatus !== "pending_removal") {
        await recordEvent(item.vintedItemId, "sold_detected", decision.detail);
      }
    }
    await sql`
      UPDATE vinted_inventory_links
      SET
        duplicate_status = ${duplicateStatus},
        duplicate_with = ${duplicateWith},
        sold_status = ${soldStatus},
        sold_platform = ${soldPlatform},
        sold_at = ${soldAt},
        sold_detail = ${soldDetail},
        updated_at = updated_at
      WHERE vinted_item_id = ${item.vintedItemId}
    `;
  }
}

export async function listDuplicateGroups(): Promise<DuplicateGroup[]> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`SELECT * FROM vinted_inventory_links`;
  const dismissals = await sql`SELECT item_a, item_b FROM vinted_duplicate_dismissals`;
  return findPossibleDuplicates(
    rows.map((row) => reviewListing(mapRow(row as Record<string, unknown>))),
    dismissals.map((row) => {
      const record = row as { item_a?: string; item_b?: string };
      return [text(record.item_a), text(record.item_b)] as [string, string];
    })
  );
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
  await recordEvent(wantedId, "confirm_match", wantedSku);
  await refreshInventorySignals();
  return { ok: true };
}

export async function reviewVintedInventory(input: {
  vintedItemId: string;
  action: "confirm_duplicate" | "not_duplicate" | "withdrawn" | "not_sold";
  relatedIds: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = input.vintedItemId.trim();
  if (!id) return { ok: false, error: "Falta la publicación de Vinted." };
  const sql = getSql();
  await ensureInventoryTables();
  const related = [...new Set(input.relatedIds.map((itemId) => itemId.trim()).filter((itemId) => itemId && itemId !== id))];
  if (input.action === "confirm_duplicate") {
    const ids = [id, ...related];
    for (const itemId of ids) {
      await sql`
        UPDATE vinted_inventory_links
        SET duplicate_status = 'confirmed', duplicate_with = ${ids.filter((other) => other !== itemId).join(",")}, updated_at = NOW()
        WHERE vinted_item_id = ${itemId}
      `;
      await recordEvent(itemId, "confirm_duplicate", ids.join(","));
    }
    return { ok: true };
  }
  if (input.action === "not_duplicate") {
    const ids = [id, ...related];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [itemA, itemB] = [ids[i], ids[j]].sort();
        await sql`
          INSERT INTO vinted_duplicate_dismissals (item_a, item_b, created_at)
          VALUES (${itemA}, ${itemB}, NOW())
          ON CONFLICT (item_a, item_b) DO NOTHING
        `;
      }
    }
    for (const itemId of ids) {
      await sql`
        UPDATE vinted_inventory_links
        SET duplicate_status = CASE WHEN duplicate_status = 'confirmed' THEN '' ELSE duplicate_status END
        WHERE vinted_item_id = ${itemId}
      `;
    }
    await recordEvent(id, "not_duplicate", ids.join(","));
    await refreshInventorySignals();
    return { ok: true };
  }
  if (input.action === "withdrawn") {
    const updated = await sql`
      UPDATE vinted_inventory_links
      SET sold_status = 'withdrawn', withdrawn_at = NOW(), updated_at = NOW()
      WHERE vinted_item_id = ${id}
      RETURNING id
    `;
    if (!updated.length) return { ok: false, error: "No existe esa publicación." };
    await recordEvent(id, "withdrawn", "Marcado como retirado de Vinted después de comprobarlo.");
    return { ok: true };
  }
  const updated = await sql`
    UPDATE vinted_inventory_links
    SET sold_status = 'not_sold', sold_detail = 'Revisado: no es una venta pendiente.', updated_at = NOW()
    WHERE vinted_item_id = ${id}
    RETURNING id
  `;
  if (!updated.length) return { ok: false, error: "No existe esa publicación." };
  await recordEvent(id, "not_sold", "Se dejó de tratar como vendido.");
  return { ok: true };
}

export async function listReviewedVintedIds(): Promise<string[]> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT DISTINCT vinted_item_id
    FROM vinted_inventory_events
    WHERE event_type IN ('confirm_match', 'confirm_duplicate', 'not_duplicate', 'withdrawn', 'not_sold')
  `;
  return rows.map((row) => text((row as { vinted_item_id?: string }).vinted_item_id)).filter(Boolean);
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
