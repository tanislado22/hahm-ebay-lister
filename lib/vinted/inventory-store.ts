import crypto from "crypto";
import { ensureInventoryTables, getSql } from "@/lib/db";
import {
  matchVintedListing,
  prepareCollectedItem,
  reserveUniqueSkus,
  skuFromStoredText,
  uniqueVerifiedVintedUrl,
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
  ebayItemId: string;
  reviewedAt: string;
}

export interface VintedInventoryCounts {
  collected: number;
  identified: number;
  duplicates: number;
  soldPending: number;
  needsReview: number;
  reviewed: number;
  pending: number;
  possible: number;
  unmatched: number;
  identifyRemaining: number;
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
    ebayItemId: text(row.ebay_item_id).replace(/\D/g, ""),
    reviewedAt: timeText(row.reviewed_at),
  };
}

export async function listEbayMatchCandidates(): Promise<EbayInventoryCandidate[]> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT sku, ebay_title, vinted_title, ebay_item_id, prepared
    FROM platform_listings
    WHERE sku IS NOT NULL AND btrim(sku) <> ''
  `;
  const watches = await sql`
    SELECT ebay_item_id, sku, title
    FROM ebay_listing_watches
    WHERE ebay_item_id IS NOT NULL AND btrim(ebay_item_id) <> ''
  `;
  const listings = rows.map((row) => {
    const record = row as Record<string, unknown>;
    const prepared = record.prepared && typeof record.prepared === "object" ? (record.prepared as Record<string, unknown>) : {};
    return {
      sku: text(record.sku).trim(),
      ebayTitle: text(record.ebay_title),
      vintedTitle: text(record.vinted_title),
      brand: text(prepared.brand),
      size: text(prepared.size),
      photoUrl: text(prepared.photoUrl || prepared.photo),
      color: text(prepared.color),
      category: text(prepared.category || prepared.itemType),
      ebayItemId: text(record.ebay_item_id).replace(/\D/g, ""),
    };
  });
  return attachKnownEbayItems(
    listings,
    watches.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        sku: text(record.sku).trim(),
        title: text(record.title),
        ebayItemId: text(record.ebay_item_id).replace(/\D/g, ""),
      };
    })
  );
}

function attachKnownEbayItems(
  listings: EbayInventoryCandidate[],
  watches: { sku: string; title: string; ebayItemId: string }[]
): EbayInventoryCandidate[] {
  const bySku = new Map<string, EbayInventoryCandidate>();
  for (const listing of listings) {
    if (!listing.sku) continue;
    const id = validItemId(listing.ebayItemId || "");
    const current = bySku.get(listing.sku);
    if (!current) {
      bySku.set(listing.sku, { ...listing, ebayItemId: id });
      continue;
    }
    const ids = new Set([current.ebayItemId || "", id].filter(Boolean));
    current.ebayItemId = ids.size === 1 ? [...ids][0] : "";
    if (!current.ebayTitle && listing.ebayTitle) current.ebayTitle = listing.ebayTitle;
    if (!current.vintedTitle && listing.vintedTitle) current.vintedTitle = listing.vintedTitle;
  }
  const watchIds = new Map<string, Set<string>>();
  for (const watch of watches) {
    const id = validItemId(watch.ebayItemId);
    if (!watch.sku || !id) continue;
    const ids = watchIds.get(watch.sku) ?? new Set<string>();
    ids.add(id);
    watchIds.set(watch.sku, ids);
    if (!bySku.has(watch.sku)) {
      bySku.set(watch.sku, {
        sku: watch.sku,
        ebayTitle: watch.title,
        vintedTitle: "",
        brand: "",
        size: "",
        photoUrl: "",
        color: "",
        category: "",
        ebayItemId: "",
      });
    }
  }
  for (const [sku, ids] of watchIds) {
    const candidate = bySku.get(sku);
    if (!candidate || candidate.ebayItemId) continue;
    candidate.ebayItemId = ids.size === 1 ? [...ids][0] : "";
  }
  return [...bySku.values()];
}

function validItemId(value: string): string {
  const id = value.replace(/\D/g, "");
  return id.length >= 10 && id.length <= 15 ? id : "";
}

async function saveMatch(item: VintedCollectedItem, match: VintedInventoryMatch): Promise<"inserted" | "kept" | "updated"> {
  const sql = getSql();
  await ensureInventoryTables();
  const prepared = prepareCollectedItem(item);
  const id = crypto.randomUUID();
  const verifiedAt = match.status === "verified" ? new Date().toISOString() : null;
  const title = prepared.title || item.title;
  const inserted = await sql`
    INSERT INTO vinted_inventory_links (
      id, vinted_item_id, title, url, photo_url, brand, size,
      sku, suggested_sku, match_status, detail, listed_sku, ebay_item_id, synced_at, verified_at, created_at, updated_at
    )
    VALUES (
      ${id},
      ${prepared.vintedItemId},
      ${title},
      ${prepared.url},
      ${prepared.photoUrl},
      ${prepared.brand},
      ${prepared.size},
      ${match.sku},
      ${match.suggestedSku},
      ${match.status},
      ${match.detail},
      ${prepared.listedSku || ""},
      ${match.ebayItemId || ""},
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
      title = CASE WHEN ${title} <> '' THEN ${title} ELSE title END,
      url = ${prepared.url},
      photo_url = CASE WHEN ${prepared.photoUrl} <> '' THEN ${prepared.photoUrl} ELSE photo_url END,
      brand = CASE WHEN ${prepared.brand} <> '' THEN ${prepared.brand} ELSE brand END,
      size = CASE WHEN ${prepared.size} <> '' THEN ${prepared.size} ELSE size END,
      listed_sku = CASE WHEN ${prepared.listedSku || ""} <> '' THEN ${prepared.listedSku || ""} ELSE listed_sku END,
      ebay_item_id = CASE
        WHEN btrim(ebay_item_id) <> '' THEN ebay_item_id
        WHEN ${match.sku} <> '' AND ${match.sku} = sku AND ${match.ebayItemId || ""} <> '' THEN ${match.ebayItemId || ""}
        ELSE ebay_item_id
      END,
      synced_at = NOW(),
      updated_at = NOW()
    WHERE vinted_item_id = ${prepared.vintedItemId}
      AND match_status = 'verified'
    RETURNING id
  `;
  if (kept.length > 0) return "kept";

  await sql`
    UPDATE vinted_inventory_links
    SET
      title = CASE WHEN ${title} <> '' THEN ${title} ELSE title END,
      url = ${prepared.url},
      photo_url = ${prepared.photoUrl},
      brand = CASE WHEN ${prepared.brand} <> '' THEN ${prepared.brand} ELSE brand END,
      size = CASE WHEN ${prepared.size} <> '' THEN ${prepared.size} ELSE size END,
      listed_sku = CASE WHEN ${prepared.listedSku || ""} <> '' THEN ${prepared.listedSku || ""} ELSE listed_sku END,
      sku = CASE WHEN btrim(ebay_item_id) <> '' THEN sku ELSE ${match.sku} END,
      suggested_sku = CASE WHEN btrim(ebay_item_id) <> '' THEN suggested_sku ELSE ${match.suggestedSku} END,
      match_status = CASE WHEN btrim(ebay_item_id) <> '' THEN match_status ELSE ${match.status} END,
      detail = CASE WHEN btrim(ebay_item_id) <> '' THEN detail ELSE ${match.detail} END,
      ebay_item_id = CASE WHEN btrim(ebay_item_id) <> '' THEN ebay_item_id ELSE ${match.ebayItemId || ""} END,
      verified_at = CASE
        WHEN btrim(ebay_item_id) <> '' THEN verified_at
        WHEN ${match.status} = 'verified' THEN ${verifiedAt}
        ELSE NULL
      END,
      synced_at = NOW(),
      updated_at = NOW()
    WHERE vinted_item_id = ${prepared.vintedItemId}
      AND match_status <> 'verified'
  `;
  return "updated";
}

export async function syncVintedInventory(items: VintedCollectedItem[]): Promise<{
  received: number;
  inserted: number;
  updated: number;
  keptVerified: number;
  existing: number;
}> {
  const candidates = await listEbayMatchCandidates();
  const result = { received: items.length, inserted: 0, updated: 0, keptVerified: 0, existing: 0 };
  for (const item of items) {
    const prepared = prepareCollectedItem(item);
    const outcome = await saveMatch(prepared, matchVintedListing(prepared, candidates));
    if (outcome === "inserted") result.inserted += 1;
    else if (outcome === "kept") result.keptVerified += 1;
    else result.updated += 1;
  }
  result.existing = result.keptVerified + result.updated;
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
          OR ebay_item_id ILIKE ${needle}
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
  const rows = await sql`SELECT match_status, duplicate_status, sold_status, sku, reviewed_at, identify_checked_at FROM vinted_inventory_links`;
  const counts: VintedInventoryCounts = {
    collected: rows.length,
    identified: 0,
    duplicates: 0,
    soldPending: 0,
    needsReview: 0,
    reviewed: 0,
    pending: 0,
    possible: 0,
    unmatched: 0,
    identifyRemaining: 0,
  };
  for (const row of rows) {
    const record = row as {
      match_status?: string;
      duplicate_status?: string;
      sold_status?: string;
      sku?: string;
      reviewed_at?: unknown;
      identify_checked_at?: unknown;
    };
    if (record.match_status === "verified") counts.identified += 1;
    if (record.match_status === "review") counts.possible += 1;
    if (record.match_status === "unmatched") counts.unmatched += 1;
    if (record.duplicate_status === "suspected" || record.duplicate_status === "confirmed") counts.duplicates += 1;
    if (record.sold_status === "pending_removal") counts.soldPending += 1;
    const needsSku = record.match_status !== "verified" && !text(record.sku).trim();
    if (record.match_status === "review" || record.match_status === "unmatched" || record.sold_status === "review" || needsSku) {
      counts.needsReview += 1;
    }
    if (record.reviewed_at) counts.reviewed += 1;
    else counts.pending += 1;
    if (record.match_status !== "verified" && !record.identify_checked_at) counts.identifyRemaining += 1;
  }
  return counts;
}

export async function identifySkuBatch(limit = 30): Promise<VintedInventoryCounts & { processed: number }> {
  const sql = getSql();
  await ensureInventoryTables();
  const cap = Math.min(30, Math.max(1, limit));
  const candidates = await listEbayMatchCandidates();
  const verified = await sql`
    SELECT sku
    FROM vinted_inventory_links
    WHERE match_status = 'verified' AND btrim(sku) <> ''
  `;
  const rows = await sql`
    SELECT vinted_item_id, title, url, photo_url, brand, size, listed_sku, detail
    FROM vinted_inventory_links
    WHERE match_status <> 'verified'
      AND identify_checked_at IS NULL
    ORDER BY created_at ASC, vinted_item_id ASC
    LIMIT ${cap}
  `;
  const proposals = rows.map((row) => {
    const record = row as Record<string, unknown>;
    const title = text(record.title);
    const detail = text(record.detail);
    const listedSku = text(record.listed_sku).trim() || skuFromStoredText(title, detail);
    return {
      id: text(record.vinted_item_id),
      match: matchVintedListing(
        {
          vintedItemId: text(record.vinted_item_id),
          title,
          url: text(record.url),
          photoUrl: text(record.photo_url),
          brand: text(record.brand),
          size: text(record.size),
          listedSku,
          cardText: detail,
        },
        candidates
      ),
    };
  });
  const settled = reserveUniqueSkus(
    proposals,
    verified.map((row) => text((row as { sku?: string }).sku))
  );
  let processed = 0;
  for (const proposal of settled) {
    if (!proposal.id) continue;
    const updated = await sql`
      UPDATE vinted_inventory_links
      SET
        sku = ${proposal.match.sku},
        suggested_sku = ${proposal.match.suggestedSku},
        match_status = ${proposal.match.status},
        detail = ${proposal.match.detail},
        ebay_item_id = CASE
          WHEN btrim(ebay_item_id) <> '' THEN ebay_item_id
          ELSE ${proposal.match.ebayItemId || ""}
        END,
        verified_at = CASE WHEN ${proposal.match.status} = 'verified' THEN NOW() ELSE verified_at END,
        identify_checked_at = NOW(),
        updated_at = NOW()
      WHERE vinted_item_id = ${proposal.id}
        AND match_status <> 'verified'
        AND identify_checked_at IS NULL
      RETURNING id
    `;
    if (updated.length) processed += 1;
  }
  return { ...(await vintedInventoryCounts()), processed };
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
  action: "confirm_duplicate" | "not_duplicate" | "withdrawn" | "not_sold" | "mark_reviewed" | "set_ebay_item" | "reject_suggestion";
  relatedIds: string[];
  ebayItemId?: string;
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
  if (input.action === "reject_suggestion") {
    const updated = await sql`
      UPDATE vinted_inventory_links
      SET
        suggested_sku = '',
        sku = '',
        match_status = 'unmatched',
        detail = 'Sugerencia rechazada.',
        updated_at = NOW()
      WHERE vinted_item_id = ${id}
        AND match_status <> 'verified'
      RETURNING id
    `;
    if (!updated.length) return { ok: false, error: "Esa asociación ya está verificada o no existe." };
    await recordEvent(id, "reject_suggestion", "Sugerencia rechazada. No se borró la publicación.");
    return { ok: true };
  }
  if (input.action === "mark_reviewed") {
    const updated = await sql`
      UPDATE vinted_inventory_links
      SET reviewed_at = NOW(), updated_at = NOW()
      WHERE vinted_item_id = ${id}
      RETURNING id
    `;
    if (!updated.length) return { ok: false, error: "No existe esa publicación." };
    await recordEvent(id, "mark_reviewed", "Marcado como revisado.");
    return { ok: true };
  }
  if (input.action === "set_ebay_item") {
    const ebayItemId = validItemId(input.ebayItemId || "");
    if (!ebayItemId) return { ok: false, error: "El Item ID de eBay debe tener entre 10 y 15 dígitos." };
    const known = await sql`
      SELECT sku FROM platform_listings WHERE regexp_replace(COALESCE(ebay_item_id, ''), '\\D', '', 'g') = ${ebayItemId}
      UNION
      SELECT sku FROM ebay_listing_watches WHERE regexp_replace(COALESCE(ebay_item_id, ''), '\\D', '', 'g') = ${ebayItemId}
    `;
    const skus = [...new Set(known.map((row) => text((row as { sku?: string }).sku).trim()).filter(Boolean))];
    if (skus.length > 1) return { ok: false, error: "Ese Item ID aparece en varios SKU. No se cambió la relación." };
    const sku = skus[0] || "";
    const updated = await sql`
      UPDATE vinted_inventory_links
      SET
        ebay_item_id = ${ebayItemId},
        sku = CASE WHEN ${sku} <> '' THEN ${sku} ELSE sku END,
        suggested_sku = CASE WHEN ${sku} <> '' THEN '' ELSE suggested_sku END,
        match_status = CASE WHEN ${sku} <> '' THEN 'verified' ELSE match_status END,
        detail = 'Item ID de eBay guardado manualmente.',
        verified_at = CASE WHEN ${sku} <> '' THEN NOW() ELSE verified_at END,
        updated_at = NOW()
      WHERE vinted_item_id = ${id}
      RETURNING id
    `;
    if (!updated.length) return { ok: false, error: "No existe esa publicación." };
    await recordEvent(id, "set_ebay_item", sku ? `${ebayItemId} ${sku}` : ebayItemId);
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
  `;
  return uniqueVerifiedVintedUrl(rows.map((row) => text((row as { url?: string }).url)));
}
