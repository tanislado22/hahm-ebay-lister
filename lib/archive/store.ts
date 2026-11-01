import crypto from "crypto";
import { ensureInventoryTables, getSql } from "@/lib/db";
import type { EbayItemDetail, EbayVariant } from "@/lib/archive/parse-item";
import { chooseSaleRecord, mergeArticleCore, planImportLink, type ArticleCore, type LocalRecord } from "@/lib/archive/link";
import { blankRun, type ImportError, type ImportProgress } from "@/lib/archive/import-progress";
import { ebayThumbUrl, exactSku, safeEbayImageUrl, searchNeedle } from "@/lib/archive/text";
import { photoForWorkspace, restoreGroup } from "@/lib/archive/workspace";
import type { PlatformListing } from "@/lib/inventory/links";
import type { ItemGroup, Photo, VintedStatus } from "@/lib/types";

export const ARCHIVE_PAGE_SIZE = 20;

export interface ArchiveCard {
  id: string;
  sku: string;
  title: string;
  price: string;
  currency: string;
  ebayItemId: string;
  ebayUrl: string;
  listingStatus: string;
  vintedListingUrl: string;
  thumbUrl: string;
}

export interface ArchiveDetail extends ArchiveCard {
  description: string;
  quantitySold: number | null;
  variants: EbayVariant[];
  vintedListingId: string;
  vintedTitle: string;
  vintedStatus: string;
  photos: { id: string; url: string }[];
}

interface ArchiveRow extends ArticleCore {
  id: string;
  accountKey: string;
  ebayUserId: string;
  ebayItemId: string;
  sourceJobId: string;
  workspaceGroup: unknown;
  workspaceHidden: boolean;
  origin: string;
}

function asText(value: unknown): string {
  return value == null ? "" : String(value);
}

function asBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

function asJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function asVariants(value: unknown): EbayVariant[] {
  const parsed = asJson<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const specifics = Array.isArray(record.specifics)
      ? record.specifics.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const pair = item as Record<string, unknown>;
          const name = asText(pair.name).trim();
          const specificValue = asText(pair.value).trim();
          return name && specificValue ? [{ name, value: specificValue }] : [];
        })
      : [];
    return [{
      sku: exactSku(asText(record.sku)),
      price: asText(record.price).trim(),
      currency: asText(record.currency).trim(),
      quantity: asText(record.quantity).trim(),
      specifics,
    }];
  });
}

function coreFromRow(row: Record<string, unknown>): ArchiveRow {
  const quantity = row.quantity_sold;
  return {
    id: asText(row.id),
    accountKey: asText(row.account_key),
    ebayUserId: asText(row.ebay_user_id),
    ebayItemId: asText(row.ebay_item_id),
    sourceJobId: asText(row.source_job_id),
    workspaceGroup: row.workspace_group ?? null,
    workspaceHidden: asBool(row.workspace_hidden),
    origin: asText(row.origin),
    sku: exactSku(asText(row.sku)),
    title: asText(row.title),
    description: asText(row.description),
    price: asText(row.price),
    currency: asText(row.currency),
    ebayUrl: asText(row.ebay_url),
    listingStatus: asText(row.listing_status),
    quantitySold: quantity == null || quantity === "" ? null : Number(quantity),
    variants: asVariants(row.variants),
    vintedListingUrl: asText(row.vinted_listing_url),
    vintedListingId: asText(row.vinted_listing_id),
    vintedTitle: asText(row.vinted_title),
    vintedStatus: asText(row.vinted_status),
  };
}

function thumbFor(photoId: string, remote: string, small: string, hasThumb: boolean): string {
  const ebay = safeEbayImageUrl(small) || safeEbayImageUrl(remote);
  if (ebay) return ebayThumbUrl(ebay) || ebay;
  if (photoId && (hasThumb || remote === "")) return `/api/archivo/foto/${encodeURIComponent(photoId)}?size=thumb`;
  return "";
}

function accountParts(accountKey: string): { workMode: "store" | "client"; clientId: string | null } {
  if (accountKey.startsWith("client:")) return { workMode: "client", clientId: accountKey.slice("client:".length) };
  return { workMode: "store", clientId: null };
}

async function ensureJobsTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      work_mode TEXT NOT NULL,
      client_id TEXT,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function archivedJobIsHidden(jobId: string): Promise<boolean> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT id FROM article_archive
    WHERE source_job_id = ${jobId} AND workspace_hidden = TRUE
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function listArchivePage(accountKey: string, query: string, page: number): Promise<{ total: number; articles: ArchiveCard[] }> {
  const sql = getSql();
  await ensureInventoryTables();
  const needle = searchNeedle(query);
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const offset = (safePage - 1) * ARCHIVE_PAGE_SIZE;
  const totalRows = await sql`
    SELECT COUNT(*)::int AS total
    FROM article_archive
    WHERE account_key = ${accountKey}
      AND (
        ${needle} = ''
        OR strpos(lower(sku), ${needle}) > 0
        OR strpos(lower(title), ${needle}) > 0
        OR strpos(ebay_item_id, ${needle}) > 0
      )
  `;
  const rows = await sql`
    SELECT
      a.id, a.sku, a.title, a.price, a.currency, a.ebay_item_id, a.ebay_url,
      a.listing_status, a.vinted_listing_url,
      thumb.id AS thumb_id,
      thumb.url AS thumb_remote,
      thumb.thumb_url AS thumb_small,
      COALESCE(thumb.has_thumb, FALSE) AS has_thumb
    FROM article_archive a
    LEFT JOIN LATERAL (
      SELECT id, url, thumb_url, (thumb_bytes <> '') AS has_thumb
      FROM article_archive_photos
      WHERE article_id = a.id
      ORDER BY position ASC, id ASC
      LIMIT 1
    ) thumb ON TRUE
    WHERE a.account_key = ${accountKey}
      AND (
        ${needle} = ''
        OR strpos(lower(a.sku), ${needle}) > 0
        OR strpos(lower(a.title), ${needle}) > 0
        OR strpos(a.ebay_item_id, ${needle}) > 0
      )
    ORDER BY a.updated_at DESC, a.id DESC
    LIMIT ${ARCHIVE_PAGE_SIZE}
    OFFSET ${offset}
  `;
  return {
    total: Number((totalRows[0] as { total?: number } | undefined)?.total ?? 0),
    articles: rows.map((row) => {
      const record = row as Record<string, unknown>;
      const thumbId = asText(record.thumb_id);
      return {
        id: asText(record.id),
        sku: exactSku(asText(record.sku)),
        title: asText(record.title),
        price: asText(record.price),
        currency: asText(record.currency),
        ebayItemId: asText(record.ebay_item_id),
        ebayUrl: asText(record.ebay_url),
        listingStatus: asText(record.listing_status),
        vintedListingUrl: asText(record.vinted_listing_url),
        thumbUrl: thumbFor(thumbId, asText(record.thumb_remote), asText(record.thumb_small), asBool(record.has_thumb)),
      };
    }),
  };
}

export async function getArchiveDetail(accountKey: string, articleId: string): Promise<ArchiveDetail | null> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT id, sku, title, description, price, currency, ebay_item_id, ebay_url, listing_status,
      quantity_sold, variants, vinted_listing_url, vinted_listing_id, vinted_title, vinted_status
    FROM article_archive
    WHERE id = ${articleId} AND account_key = ${accountKey}
    LIMIT 1
  `;
  if (!rows.length) return null;
  const article = coreFromRow(rows[0] as Record<string, unknown>);
  const photos = await sql`
    SELECT id, url, thumb_url, (thumb_bytes <> '') AS has_thumb, (bytes <> '') AS has_bytes
    FROM article_archive_photos
    WHERE article_id = ${article.id}
    ORDER BY position ASC, id ASC
  `;
  const photoRefs = photos.map((row) => {
    const record = row as Record<string, unknown>;
    const id = asText(record.id);
    const remote = safeEbayImageUrl(asText(record.url));
    return { id, url: remote || `/api/archivo/foto/${encodeURIComponent(id)}` };
  });
  const first = photos[0] as Record<string, unknown> | undefined;
  return {
    id: article.id,
    sku: article.sku,
    title: article.title,
    price: article.price,
    currency: article.currency,
    ebayItemId: article.ebayItemId,
    ebayUrl: article.ebayUrl,
    listingStatus: article.listingStatus,
    vintedListingUrl: article.vintedListingUrl,
    description: article.description,
    quantitySold: Number.isFinite(article.quantitySold) ? article.quantitySold : null,
    variants: article.variants,
    vintedListingId: article.vintedListingId,
    vintedTitle: article.vintedTitle,
    vintedStatus: article.vintedStatus,
    photos: photoRefs,
    thumbUrl: first
      ? thumbFor(asText(first.id), asText(first.url), asText(first.thumb_url), asBool(first.has_thumb) || asBool(first.has_bytes))
      : "",
  };
}

export async function getArchivePhoto(photoId: string): Promise<{ mediaType: string; bytes: Buffer; thumb: Buffer | null } | { redirect: string } | null> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT media_type, bytes, thumb_bytes, url
    FROM article_archive_photos
    WHERE id = ${photoId}
    LIMIT 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const remote = safeEbayImageUrl(asText(row.url));
  const bytes = asText(row.bytes);
  const thumb = asText(row.thumb_bytes);
  if (!bytes && remote) return { redirect: remote };
  if (!bytes && !thumb) return null;
  return {
    mediaType: asText(row.media_type) || "image/jpeg",
    bytes: Buffer.from(bytes || thumb, "base64"),
    thumb: thumb ? Buffer.from(thumb, "base64") : null,
  };
}

async function makeThumb(data: string): Promise<string> {
  try {
    const sharp = (await import("sharp")).default;
    const output = await sharp(Buffer.from(data, "base64")).rotate().resize(160, 160, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer();
    return output.toString("base64");
  } catch {
    return "";
  }
}

async function writeArticle(id: string, accountKey: string, ebayUserId: string, itemId: string, core: ArticleCore, sourceJobId: string, group: unknown, hidden: boolean, origin: string, isUpdate: boolean): Promise<void> {
  const sql = getSql();
  const variants = JSON.stringify(core.variants);
  const groupJson = JSON.stringify(group ?? null);
  if (!isUpdate) {
    await sql`
      INSERT INTO article_archive (
        id, account_key, ebay_user_id, ebay_item_id, sku, title, description, price, currency,
        ebay_url, listing_status, quantity_sold, variants, vinted_listing_url, vinted_listing_id,
        vinted_title, vinted_status, source_job_id, workspace_group, workspace_hidden, origin,
        created_at, updated_at
      )
      VALUES (
        ${id}, ${accountKey}, ${ebayUserId}, ${itemId}, ${core.sku}, ${core.title}, ${core.description},
        ${core.price}, ${core.currency}, ${core.ebayUrl}, ${core.listingStatus}, ${core.quantitySold},
        ${variants}::jsonb, ${core.vintedListingUrl}, ${core.vintedListingId}, ${core.vintedTitle},
        ${core.vintedStatus}, ${sourceJobId}, ${groupJson}::jsonb, ${hidden}, ${origin}, NOW(), NOW()
      )
    `;
    return;
  }
  await sql`
    UPDATE article_archive SET
      ebay_user_id = CASE WHEN ${ebayUserId} <> '' THEN ${ebayUserId} ELSE ebay_user_id END,
      ebay_item_id = CASE WHEN ${itemId} <> '' THEN ${itemId} ELSE ebay_item_id END,
      sku = ${core.sku},
      title = ${core.title},
      description = ${core.description},
      price = ${core.price},
      currency = ${core.currency},
      ebay_url = ${core.ebayUrl},
      listing_status = ${core.listingStatus},
      quantity_sold = ${core.quantitySold},
      variants = ${variants}::jsonb,
      vinted_listing_url = ${core.vintedListingUrl},
      vinted_listing_id = ${core.vintedListingId},
      vinted_title = ${core.vintedTitle},
      vinted_status = ${core.vintedStatus},
      source_job_id = CASE WHEN source_job_id <> '' THEN source_job_id ELSE ${sourceJobId} END,
      workspace_group = ${groupJson}::jsonb,
      origin = CASE WHEN origin <> '' THEN origin ELSE ${origin} END,
      updated_at = NOW()
    WHERE id = ${id}
  `;
}

async function replaceEbayPhotos(articleId: string, detail: EbayItemDetail): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM article_archive_photos WHERE article_id = ${articleId} AND source = 'ebay'`;
  let position = 1000;
  for (const url of detail.pictureUrls) {
    const safe = safeEbayImageUrl(url);
    if (!safe) continue;
    await sql`
      INSERT INTO article_archive_photos (id, article_id, position, source, media_type, bytes, thumb_bytes, url, thumb_url)
      VALUES (${crypto.randomUUID()}, ${articleId}, ${position}, 'ebay', 'image/jpeg', '', '', ${safe}, ${ebayThumbUrl(safe)})
    `;
    position += 1;
  }
}

function storedGroup(value: unknown, fresh: Record<string, unknown>): Record<string, unknown> {
  if (!value || typeof value !== "object") return fresh;
  const group = value as Record<string, unknown>;
  const sku = typeof group.sku === "string" && group.sku !== "" ? group.sku : fresh.sku;
  return {
    ...fresh,
    ...group,
    sku,
    listingId: group.listingId || fresh.listingId,
    postStatus: group.postStatus === "posted" || fresh.postStatus === "posted" ? "posted" : group.postStatus || fresh.postStatus,
    listing: group.listing || fresh.listing,
    vintedListingUrl: group.vintedListingUrl || fresh.vintedListingUrl,
    vintedStatus: group.vintedStatus || fresh.vintedStatus,
  };
}

async function findExistingImport(accountKey: string, ebayUserId: string, itemId: string): Promise<ArchiveRow | null> {
  const sql = getSql();
  const byAccount = await sql`SELECT * FROM article_archive WHERE account_key = ${accountKey} AND ebay_item_id = ${itemId} LIMIT 1`;
  if (byAccount.length) return coreFromRow(byAccount[0] as Record<string, unknown>);
  if (!ebayUserId) return null;
  const byUser = await sql`SELECT * FROM article_archive WHERE ebay_user_id = ${ebayUserId} AND ebay_item_id = ${itemId} LIMIT 1`;
  return byUser.length ? coreFromRow(byUser[0] as Record<string, unknown>) : null;
}

export async function loadLinkCandidates(accountKey: string): Promise<LocalRecord[]> {
  const sql = getSql();
  await ensureInventoryTables();
  await ensureJobsTable();
  const { workMode, clientId } = accountParts(accountKey);
  const listings = await sql`
    SELECT id, sku, ebay_item_id, vinted_listing_url, vinted_listing_id, vinted_title, vinted_status
    FROM platform_listings
    WHERE workspace_key = ${accountKey}
  `;
  const jobs = workMode === "client" && clientId
    ? await sql`
        SELECT id,
          COALESCE(data->'group'->>'sku', '') AS sku,
          COALESCE(data->'group'->>'listingId', '') AS ebay_item_id,
          COALESCE(data->'group'->>'vintedListingUrl', '') AS vinted_listing_url,
          COALESCE(data->'group'->>'vintedStatus', '') AS vinted_status
        FROM jobs
        WHERE work_mode = 'client' AND client_id = ${clientId}
      `
    : await sql`
        SELECT id,
          COALESCE(data->'group'->>'sku', '') AS sku,
          COALESCE(data->'group'->>'listingId', '') AS ebay_item_id,
          COALESCE(data->'group'->>'vintedListingUrl', '') AS vinted_listing_url,
          COALESCE(data->'group'->>'vintedStatus', '') AS vinted_status
        FROM jobs
        WHERE work_mode = 'store'
      `;
  const locals: LocalRecord[] = [];
  for (const row of listings) {
    const record = row as Record<string, unknown>;
    locals.push({
      id: asText(record.id),
      source: "platform",
      sku: exactSku(asText(record.sku)),
      ebayItemId: asText(record.ebay_item_id).trim(),
      vintedListingUrl: asText(record.vinted_listing_url).trim(),
      vintedListingId: asText(record.vinted_listing_id).trim(),
      vintedTitle: asText(record.vinted_title).trim(),
      vintedStatus: asText(record.vinted_status).trim(),
    });
  }
  for (const row of jobs) {
    const record = row as Record<string, unknown>;
    locals.push({
      id: asText(record.id),
      source: "job",
      sku: exactSku(asText(record.sku)),
      ebayItemId: asText(record.ebay_item_id).replace(/\D/g, ""),
      vintedListingUrl: asText(record.vinted_listing_url).trim(),
      vintedListingId: "",
      vintedTitle: "",
      vintedStatus: asText(record.vinted_status).trim(),
    });
  }
  return locals;
}

export async function saveImportedArticle(input: {
  accountKey: string;
  ebayUserId: string;
  detail: EbayItemDetail;
  locals: LocalRecord[];
}): Promise<{ kind: "imported" | "existing"; note: string }> {
  await ensureInventoryTables();
  const existing = await findExistingImport(input.accountKey, input.ebayUserId, input.detail.itemId);
  const plan = planImportLink({
    ebayItemId: input.detail.itemId,
    ebaySku: input.detail.sku,
    existingArchiveId: existing?.id ?? null,
    locals: input.locals,
  });
  const core = mergeArticleCore(existing, {
    sku: input.detail.sku,
    title: input.detail.title,
    description: input.detail.description,
    price: input.detail.price,
    currency: input.detail.currency,
    ebayUrl: input.detail.ebayUrl,
    listingStatus: input.detail.listingStatus,
    quantitySold: input.detail.quantitySold,
    variants: input.detail.variants,
    vintedListingUrl: "",
    vintedListingId: "",
    vintedTitle: "",
    vintedStatus: "",
  }, plan.vintedFrom);
  const id = existing?.id || crypto.randomUUID();
  const sourceJobId = existing?.sourceJobId || plan.sourceJobId || "";
  const group = storedGroup(existing?.workspaceGroup, {
    id: sourceJobId || id,
    sku: core.sku,
    name: core.title || core.sku || input.detail.itemId,
    photoIds: [],
    listing: {
      title: core.title,
      description: core.description,
      suggested_price: core.price,
      currency: core.currency || undefined,
    },
    status: "done",
    postStatus: "posted",
    listingId: input.detail.itemId,
    vintedStatus: core.vintedStatus || undefined,
    vintedListingUrl: core.vintedListingUrl || undefined,
  });
  await writeArticle(id, existing?.accountKey || input.accountKey, input.ebayUserId || existing?.ebayUserId || "", input.detail.itemId, core, sourceJobId, group, false, existing?.origin || "ebay-import", Boolean(existing));
  if (input.detail.pictureUrls.length) await replaceEbayPhotos(id, input.detail);
  if (plan.linkPlatformId) {
    const sql = getSql();
    await sql`
      UPDATE platform_listings SET
        ebay_item_id = ${input.detail.itemId},
        ebay_title = CASE WHEN ${input.detail.title} <> '' THEN ${input.detail.title} ELSE ebay_title END,
        published_on_ebay = TRUE,
        updated_at = NOW()
      WHERE id = ${plan.linkPlatformId}
        AND (ebay_item_id IS NULL OR btrim(ebay_item_id) = '' OR ebay_item_id = ${input.detail.itemId})
    `;
  }
  return { kind: existing ? "existing" : "imported", note: plan.note };
}

export async function saveWorkspaceArticle(input: {
  accountKey: string;
  group: ItemGroup;
  photos: { id: string; mediaType: string; data: string }[];
  vintedListingUrl: string;
  vintedListingId: string;
  vintedTitle: string;
  vintedStatus: string;
}): Promise<{ id: string }> {
  const sql = getSql();
  await ensureInventoryTables();
  const itemId = asText(input.group.listingId).replace(/\D/g, "");
  const byJob = await sql`
    SELECT * FROM article_archive
    WHERE account_key = ${input.accountKey} AND source_job_id = ${input.group.id}
    LIMIT 1
  `;
  const byItem = !byJob.length && itemId
    ? await sql`SELECT * FROM article_archive WHERE account_key = ${input.accountKey} AND ebay_item_id = ${itemId} LIMIT 1`
    : [];
  const existing = byJob.length ? coreFromRow(byJob[0] as Record<string, unknown>) : byItem.length ? coreFromRow(byItem[0] as Record<string, unknown>) : null;
  const rawPrice = input.group.listing?.suggested_price;
  const price = typeof rawPrice === "number" && Number.isFinite(rawPrice) ? rawPrice.toFixed(2) : typeof rawPrice === "string" ? rawPrice.trim() : "";
  const core: ArticleCore = {
    sku: exactSku(input.group.sku) || existing?.sku || "",
    title: input.group.listing?.title?.trim() || existing?.title || "",
    description: input.group.listing?.description || existing?.description || "",
    price: price || existing?.price || "",
    currency: input.group.listing?.currency?.trim() || existing?.currency || "",
    ebayUrl: itemId ? `https://www.ebay.com/itm/${itemId}` : existing?.ebayUrl || "",
    listingStatus: existing?.listingStatus || "",
    quantitySold: existing?.quantitySold ?? null,
    variants: existing?.variants || [],
    vintedListingUrl: input.vintedListingUrl || existing?.vintedListingUrl || "",
    vintedListingId: input.vintedListingId || existing?.vintedListingId || "",
    vintedTitle: input.vintedTitle || existing?.vintedTitle || "",
    vintedStatus: input.vintedStatus || existing?.vintedStatus || input.group.vintedStatus || "",
  };
  const id = existing?.id || input.group.id;
  const storedPhotos: { id: string; mediaType: string; data: string; thumb: string }[] = [];
  for (const photo of input.photos) {
    if (!photo.data) continue;
    storedPhotos.push({
      id: crypto.randomUUID(),
      mediaType: photo.mediaType || "image/jpeg",
      data: photo.data,
      thumb: await makeThumb(photo.data),
    });
  }
  const group = { ...input.group, photoIds: storedPhotos.map((photo) => photo.id) };
  await writeArticle(
    id,
    input.accountKey,
    existing?.ebayUserId || "",
    itemId || existing?.ebayItemId || "",
    core,
    input.group.id,
    group,
    false,
    existing?.origin === "ebay-import" ? "ebay-import" : "workspace",
    Boolean(existing)
  );
  await sql`DELETE FROM article_archive_photos WHERE article_id = ${id} AND source = 'local'`;
  let position = 0;
  for (const photo of storedPhotos) {
    await sql`
      INSERT INTO article_archive_photos (id, article_id, position, source, media_type, bytes, thumb_bytes, url, thumb_url)
      VALUES (${photo.id}, ${id}, ${position}, 'local', ${photo.mediaType}, ${photo.data}, ${photo.thumb}, '', '')
    `;
    position += 1;
  }
  const groupJson = JSON.stringify(group);
  await sql`
    UPDATE article_archive
    SET workspace_hidden = TRUE, workspace_group = ${groupJson}::jsonb, updated_at = NOW()
    WHERE id = ${id}
  `;
  return { id };
}

export async function setArchiveHidden(articleId: string, hidden: boolean): Promise<void> {
  const sql = getSql();
  await ensureInventoryTables();
  await sql`UPDATE article_archive SET workspace_hidden = ${hidden}, updated_at = NOW() WHERE id = ${articleId}`;
}

export async function restoreArchiveToWorkspace(accountKey: string, articleId: string): Promise<{ ok: true; jobId: string; already: boolean } | { ok: false; error: string }> {
  const sql = getSql();
  await ensureInventoryTables();
  await ensureJobsTable();
  const rows = await sql`SELECT * FROM article_archive WHERE id = ${articleId} AND account_key = ${accountKey} LIMIT 1`;
  if (!rows.length) return { ok: false, error: "Ese artículo no está en el archivo." };
  const article = coreFromRow(rows[0] as Record<string, unknown>);
  const photos = await sql`
    SELECT id, media_type, bytes, url
    FROM article_archive_photos
    WHERE article_id = ${article.id}
    ORDER BY position ASC, id ASC
  `;
  const workspacePhotos: Photo[] = photos.map((row) => {
    const record = row as Record<string, unknown>;
    return photoForWorkspace({
      id: asText(record.id),
      mediaType: asText(record.media_type),
      bytes: asText(record.bytes),
      url: safeEbayImageUrl(asText(record.url)),
    });
  });
  const group = restoreGroup({
    articleId: article.id,
    sourceJobId: article.sourceJobId,
    sku: article.sku,
    title: article.title,
    description: article.description,
    price: article.price,
    currency: article.currency,
    ebayItemId: article.ebayItemId,
    ebayUrl: article.ebayUrl,
    vintedStatus: article.vintedStatus,
    vintedListingUrl: article.vintedListingUrl,
    storedGroup: article.workspaceGroup,
    photoIds: workspacePhotos.map((photo) => photo.id),
  });
  const existingJob = await sql`SELECT id FROM jobs WHERE id = ${group.id} LIMIT 1`;
  if (existingJob.length && !article.workspaceHidden) return { ok: true, jobId: group.id, already: true };
  const { workMode, clientId } = accountParts(accountKey);
  const payload = JSON.stringify({ group, photos: workspacePhotos });
  await sql`
    INSERT INTO jobs (id, work_mode, client_id, data, updated_at)
    VALUES (${group.id}, ${workMode}, ${clientId}, ${payload}::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE SET
      work_mode = EXCLUDED.work_mode,
      client_id = EXCLUDED.client_id,
      data = EXCLUDED.data,
      updated_at = NOW()
  `;
  await sql`UPDATE article_archive SET workspace_hidden = FALSE, source_job_id = ${group.id}, updated_at = NOW() WHERE id = ${article.id}`;
  return { ok: true, jobId: group.id, already: false };
}

function asStatus(value: string): VintedStatus {
  if (value === "ready" || value === "published" || value === "not_prepared") return value;
  return "not_prepared";
}

function toPlatformListing(row: ArchiveRow): PlatformListing {
  const publishedOnVinted = row.vintedStatus === "published" || Boolean(row.vintedListingUrl || row.vintedListingId);
  return {
    id: row.id,
    workspaceKey: row.accountKey,
    sku: row.sku,
    ebayItemId: row.ebayItemId || null,
    ebayTitle: row.title || null,
    vintedTitle: row.vintedTitle || null,
    vintedListingUrl: row.vintedListingUrl || null,
    vintedListingId: row.vintedListingId || null,
    publishedOnEbay: Boolean(row.ebayItemId),
    publishedOnVinted,
    vintedStatus: asStatus(row.vintedStatus || (publishedOnVinted ? "published" : "not_prepared")),
    prepared: null,
    createdAt: "",
    updatedAt: "",
  };
}

export async function findArchivedListingForSale(accountKey: string, sku: string, ebayItemId: string): Promise<{ kind: "none" } | { kind: "ambiguous" } | { kind: "one"; row: PlatformListing }> {
  await ensureInventoryTables();
  const exact = exactSku(sku);
  const itemId = ebayItemId.trim();
  if (!exact && !itemId) return { kind: "none" };
  const sql = getSql();
  const localRows = await sql`
    SELECT * FROM article_archive
    WHERE account_key = ${accountKey}
      AND ((${itemId} <> '' AND ebay_item_id = ${itemId}) OR (${exact} <> '' AND sku = ${exact}))
  `;
  const local = localRows.map((row) => coreFromRow(row as Record<string, unknown>));
  const localChoice = chooseSaleRecord(exact, itemId, local.map((row) => ({ id: row.id, sku: row.sku, ebayItemId: row.ebayItemId })));
  if (localChoice.kind === "ambiguous") return localChoice;
  if (localChoice.kind === "one") {
    const row = local.find((entry) => entry.id === localChoice.id);
    return row ? { kind: "one", row: toPlatformListing(row) } : { kind: "none" };
  }
  const globalRows = await sql`
    SELECT * FROM article_archive
    WHERE (${itemId} <> '' AND ebay_item_id = ${itemId}) OR (${exact} <> '' AND sku = ${exact})
  `;
  const global = globalRows.map((row) => coreFromRow(row as Record<string, unknown>));
  const globalChoice = chooseSaleRecord(exact, itemId, global.map((row) => ({ id: row.id, sku: row.sku, ebayItemId: row.ebayItemId })));
  if (globalChoice.kind !== "one") return globalChoice;
  const row = global.find((entry) => entry.id === globalChoice.id);
  return row ? { kind: "one", row: toPlatformListing(row) } : { kind: "none" };
}

export async function archiveSkuHits(sku: string): Promise<{ sku: string; title: string; ebayItemId: string; photoUrl: string; price: string; currency: string }[]> {
  const sql = getSql();
  await ensureInventoryTables();
  const wanted = exactSku(sku);
  if (!wanted) return [];
  const rows = await sql`
    SELECT a.sku, a.title, a.ebay_item_id, a.price, a.currency,
      (
        SELECT COALESCE(NULLIF(p.thumb_url, ''), NULLIF(p.url, ''))
        FROM article_archive_photos p
        WHERE p.article_id = a.id
        ORDER BY p.position ASC, p.id ASC
        LIMIT 1
      ) AS photo_url
    FROM article_archive a
    WHERE lower(btrim(a.sku)) = lower(${wanted})
  `;
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      sku: exactSku(asText(record.sku)),
      title: asText(record.title).trim(),
      ebayItemId: asText(record.ebay_item_id).replace(/\D/g, ""),
      photoUrl: safeEbayImageUrl(asText(record.photo_url)),
      price: asText(record.price).trim(),
      currency: asText(record.currency).trim() || "USD",
    };
  });
}

function asStringList(value: unknown): string[] {
  const parsed = asJson<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.map((entry) => asText(entry)).filter(Boolean) : [];
}

function progressFromRow(row: Record<string, unknown>): ImportProgress {
  const mode = row.mode === "all" ? "all" : "sample";
  const status = row.status === "done" || row.status === "error" ? row.status : "running";
  const errors = asJson<unknown>(row.errors, []);
  return {
    mode,
    status,
    ebayUserId: asText(row.ebay_user_id),
    listPage: Number(row.list_page ?? 0) || 0,
    totalPages: row.total_pages == null ? null : Number(row.total_pages),
    totalEntries: row.total_entries == null ? null : Number(row.total_entries),
    listComplete: asBool(row.list_complete),
    found: Number(row.found ?? 0) || 0,
    imported: Number(row.imported ?? 0) || 0,
    existing: Number(row.existing_count ?? 0) || 0,
    errors: Array.isArray(errors)
      ? errors.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const record = entry as Record<string, unknown>;
          return [{ itemId: asText(record.itemId), message: asText(record.message) }];
        })
      : [],
    notices: asStringList(row.notices),
    pendingIds: asStringList(row.pending_ids),
    failedIds: asStringList(row.failed_ids),
    attempts: asJson<Record<string, number>>(row.attempts, {}),
    detail: asText(row.detail),
  };
}

export async function loadImportRun(accountKey: string, mode: "sample" | "all"): Promise<ImportProgress | null> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`SELECT * FROM article_import_runs WHERE account_key = ${accountKey} AND mode = ${mode} LIMIT 1`;
  return rows.length ? progressFromRow(rows[0] as Record<string, unknown>) : null;
}

export async function saveImportRun(accountKey: string, run: ImportProgress): Promise<void> {
  const sql = getSql();
  await ensureInventoryTables();
  const id = `${accountKey}:${run.mode}`;
  await sql`
    INSERT INTO article_import_runs (
      id, account_key, mode, ebay_user_id, status, list_page, total_pages, total_entries,
      list_complete, found, imported, existing_count, error_count, errors, notices,
      pending_ids, failed_ids, attempts, detail, created_at, updated_at
    )
    VALUES (
      ${id}, ${accountKey}, ${run.mode}, ${run.ebayUserId}, ${run.status}, ${run.listPage},
      ${run.totalPages}, ${run.totalEntries}, ${run.listComplete}, ${run.found}, ${run.imported},
      ${run.existing}, ${run.errors.length}, ${JSON.stringify(run.errors)}::jsonb,
      ${JSON.stringify(run.notices)}::jsonb, ${JSON.stringify(run.pendingIds)}::jsonb,
      ${JSON.stringify(run.failedIds)}::jsonb, ${JSON.stringify(run.attempts)}::jsonb,
      ${run.detail}, NOW(), NOW()
    )
    ON CONFLICT (account_key, mode) DO UPDATE SET
      ebay_user_id = EXCLUDED.ebay_user_id,
      status = EXCLUDED.status,
      list_page = EXCLUDED.list_page,
      total_pages = EXCLUDED.total_pages,
      total_entries = EXCLUDED.total_entries,
      list_complete = EXCLUDED.list_complete,
      found = EXCLUDED.found,
      imported = EXCLUDED.imported,
      existing_count = EXCLUDED.existing_count,
      error_count = EXCLUDED.error_count,
      errors = EXCLUDED.errors,
      notices = EXCLUDED.notices,
      pending_ids = EXCLUDED.pending_ids,
      failed_ids = EXCLUDED.failed_ids,
      attempts = EXCLUDED.attempts,
      detail = EXCLUDED.detail,
      updated_at = NOW()
  `;
}

export function emptyRun(mode: "sample" | "all"): ImportProgress {
  return blankRun(mode);
}
