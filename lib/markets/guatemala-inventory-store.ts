import { getSql } from "@/lib/db";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import {
  GUATEMALA_INVENTORY_MESSAGES,
  GUATEMALA_INVENTORY_STATUS,
  GUATEMALA_SALE_MESSAGES,
  GUATEMALA_SOLD_STATUS,
  inventoryLikePattern,
  inventoryListFilter,
  prepareInventorySave,
  quetzalPriceText,
  resolveInventoryInsert,
  type GuatemalaSaleSnapshot,
  type InventoryItemStatus,
  type InventoryListFilter,
  type InventoryPhoto,
  type PreparedInventoryItem,
  type StoredInventoryItem,
} from "@/lib/markets/guatemala-inventory";

export interface InventoryRepository {
  findBySource(clientId: string, sourceGroupId: string): Promise<StoredInventoryItem | null>;
  findBySku(clientId: string, sku: string): Promise<StoredInventoryItem | null>;
  insert(item: PreparedInventoryItem): Promise<StoredInventoryItem | null>;
}

export type InventorySaveResult =
  | { ok: true; action: "created" | "already_saved"; item: StoredInventoryItem }
  | { ok: false; status: 400 | 403 | 409; error: string };

type SaveBody = Parameters<typeof prepareInventorySave>[0];

export async function runInventorySave(
  repository: InventoryRepository,
  input: SaveBody,
  clientAllowed: (clientId: string) => Promise<boolean>
): Promise<InventorySaveResult> {
  const prepared = prepareInventorySave(input);
  if (!prepared.ok) return prepared;
  if (!(await clientAllowed(prepared.item.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  const inserted = await repository.insert(prepared.item);
  if (inserted) return { ok: true, action: "created", item: inserted };
  const existingBySource = await repository.findBySource(
    prepared.item.clientId,
    prepared.item.sourceGroupId
  );
  const existingBySku = await repository.findBySku(prepared.item.clientId, prepared.item.sku);
  const decision = resolveInventoryInsert(prepared.item, existingBySource, existingBySku);
  if (decision.action === "already_saved") {
    return { ok: true, action: "already_saved", item: decision.item };
  }
  if (decision.action === "reject") return { ok: false, status: decision.status, error: decision.error };
  const retried = await repository.insert(prepared.item);
  if (retried) return { ok: true, action: "created", item: retried };
  return { ok: false, status: 409, error: GUATEMALA_INVENTORY_MESSAGES.retry };
}

let ensuring: Promise<void> | null = null;

export function ensureGuatemalaInventoryTables(): Promise<void> {
  if (!ensuring) {
    ensuring = createGuatemalaInventoryTables().catch((error) => {
      ensuring = null;
      throw error;
    });
  }
  return ensuring;
}

async function createGuatemalaInventoryTables(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_inventory_items (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      source_group_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      condition TEXT NOT NULL DEFAULT '',
      price_gtq NUMERIC(12, 2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GTQ',
      status TEXT NOT NULL DEFAULT 'disponible',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (client_id, sku),
      UNIQUE (client_id, source_group_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_inventory_photos (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      data TEXT NOT NULL,
      UNIQUE (item_id, position)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS guatemala_inventory_items_client_idx
    ON guatemala_inventory_items (client_id)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_inventory_sales (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL UNIQUE,
      client_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      published_price_gtq NUMERIC(12, 2) NOT NULL CHECK (published_price_gtq > 0),
      charged_price_gtq NUMERIC(12, 2) NOT NULL CHECK (charged_price_gtq > 0),
      sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

interface ItemRow {
  id: string;
  client_id: string;
  source_group_id: string;
  sku: string;
  title: string;
  description: string;
  brand: string;
  size: string;
  condition: string;
  price_gtq: string;
  status: string;
}

function itemStatus(value: unknown): InventoryItemStatus {
  return value === GUATEMALA_SOLD_STATUS ? GUATEMALA_SOLD_STATUS : GUATEMALA_INVENTORY_STATUS;
}

function storedFromRow(
  row: ItemRow,
  photos: InventoryPhoto[],
  sale: GuatemalaSaleSnapshot | null = null
): StoredInventoryItem {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    sourceGroupId: String(row.source_group_id),
    sku: String(row.sku),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    brand: String(row.brand ?? ""),
    size: String(row.size ?? ""),
    condition: String(row.condition ?? ""),
    priceGtq: normalizePriceText(row.price_gtq),
    photos,
    status: itemStatus(row.status),
    sale,
  };
}

function normalizePriceText(value: unknown): string {
  const text = String(value ?? "");
  const match = /^(\d+)\.(\d+)$/.exec(text);
  if (!match) return text;
  return `${match[1]}.${match[2].slice(0, 2).padEnd(2, "0")}`;
}

async function photosFor(itemId: string): Promise<InventoryPhoto[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, media_type, data
    FROM guatemala_inventory_photos
    WHERE item_id = ${itemId}
    ORDER BY position ASC
  `;
  return rows.map((row) => ({
    id: String(row.id),
    mediaType: String(row.media_type),
    data: String(row.data),
  }));
}

async function findRow(clientId: string, column: "source_group_id" | "sku", value: string): Promise<StoredInventoryItem | null> {
  const sql = getSql();
  const rows =
    column === "sku"
      ? await sql`
          SELECT id, client_id, source_group_id, sku, title, description, brand, size, condition,
                 price_gtq::text AS price_gtq, status
          FROM guatemala_inventory_items
          WHERE client_id = ${clientId} AND sku = ${value}
          LIMIT 1
        `
      : await sql`
          SELECT id, client_id, source_group_id, sku, title, description, brand, size, condition,
                 price_gtq::text AS price_gtq, status
          FROM guatemala_inventory_items
          WHERE client_id = ${clientId} AND source_group_id = ${value}
          LIMIT 1
        `;
  const row = rows[0] as ItemRow | undefined;
  if (!row) return null;
  return storedFromRow(row, await photosFor(String(row.id)));
}

function postgresRepository(): InventoryRepository {
  return {
    findBySource: (clientId, sourceGroupId) => findRow(clientId, "source_group_id", sourceGroupId),
    findBySku: (clientId, sku) => findRow(clientId, "sku", sku),
    insert: insertItem,
  };
}

async function insertItem(item: PreparedInventoryItem): Promise<StoredInventoryItem | null> {
  const sql = getSql();
  const id = crypto.randomUUID();
  const photoJson = JSON.stringify(
    item.photos.map((photo, position) => ({
      id: photo.id,
      photo_position: position,
      media_type: photo.mediaType,
      data: photo.data,
    }))
  );
  const rows = await sql`
    WITH inserted AS (
      INSERT INTO guatemala_inventory_items (
        id, client_id, source_group_id, sku, title, description,
        brand, size, condition, price_gtq, currency, status
      )
      VALUES (
        ${id},
        ${item.clientId},
        ${item.sourceGroupId},
        ${item.sku},
        ${item.title},
        ${item.description},
        ${item.brand},
        ${item.size},
        ${item.condition},
        ${item.priceGtq}::numeric,
        'GTQ',
        ${GUATEMALA_INVENTORY_STATUS}
      )
      ON CONFLICT DO NOTHING
      RETURNING id, client_id, source_group_id, sku, title, description, brand, size, condition,
        price_gtq::text AS price_gtq, status
    ),
    saved_photos AS (
      INSERT INTO guatemala_inventory_photos (id, item_id, position, media_type, data)
      SELECT photo.id, inserted.id, photo.photo_position, photo.media_type, photo.data
      FROM jsonb_to_recordset(${photoJson}::jsonb)
        AS photo(id text, photo_position int, media_type text, data text)
      CROSS JOIN inserted
      RETURNING item_id
    )
    SELECT id, client_id, source_group_id, sku, title, description, brand, size, condition,
      price_gtq, status
    FROM inserted
  `;
  const row = rows[0] as ItemRow | undefined;
  if (!row) return null;
  return storedFromRow(row, item.photos);
}

export async function saveGuatemalaInventoryItem(input: SaveBody): Promise<InventorySaveResult> {
  await ensureGuatemalaInventoryTables();
  return runInventorySave(postgresRepository(), input, clientIsGuatemala);
}

export interface InventoryListItem {
  id: string;
  sku: string;
  title: string;
  size: string;
  priceGtq: string;
  status: InventoryItemStatus;
  cover: InventoryPhoto | null;
}

export async function listGuatemalaInventory(
  clientId: string,
  query: string,
  filterInput: unknown = "disponibles"
): Promise<{ available: number; items: InventoryListItem[] } | { ok: false; status: 403; error: string }> {
  await ensureGuatemalaInventoryTables();
  if (!(await clientIsGuatemala(clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  const sql = getSql();
  const pattern = inventoryLikePattern(query);
  const filter = inventoryListFilter(filterInput);
  const status = statusForFilter(filter);
  const counts = await sql`
    SELECT COUNT(*)::int AS available
    FROM guatemala_inventory_items
    WHERE client_id = ${clientId} AND status = ${GUATEMALA_INVENTORY_STATUS}
  `;
  const rows = pattern
    ? await sql`
        SELECT item.id, item.sku, item.title, item.size, item.price_gtq::text AS price_gtq, item.status,
          photo.id AS photo_id, photo.media_type, photo.data
        FROM guatemala_inventory_items AS item
        LEFT JOIN LATERAL (
          SELECT id, media_type, data
          FROM guatemala_inventory_photos
          WHERE item_id = item.id
          ORDER BY position ASC
          LIMIT 1
        ) AS photo ON TRUE
        WHERE item.client_id = ${clientId}
          AND (${status}::text IS NULL OR item.status = ${status})
          AND (item.sku ILIKE ${pattern} ESCAPE '\\' OR item.title ILIKE ${pattern} ESCAPE '\\')
        ORDER BY item.created_at DESC
      `
    : await sql`
        SELECT item.id, item.sku, item.title, item.size, item.price_gtq::text AS price_gtq, item.status,
          photo.id AS photo_id, photo.media_type, photo.data
        FROM guatemala_inventory_items AS item
        LEFT JOIN LATERAL (
          SELECT id, media_type, data
          FROM guatemala_inventory_photos
          WHERE item_id = item.id
          ORDER BY position ASC
          LIMIT 1
        ) AS photo ON TRUE
        WHERE item.client_id = ${clientId}
          AND (${status}::text IS NULL OR item.status = ${status})
        ORDER BY item.created_at DESC
      `;
  return {
    available: Number(counts[0]?.available ?? 0),
    items: rows.map((row) => ({
      id: String(row.id),
      sku: String(row.sku),
      title: String(row.title ?? ""),
      size: String(row.size ?? ""),
      priceGtq: normalizePriceText(row.price_gtq),
      status: itemStatus(row.status),
      cover:
        row.photo_id && row.data
          ? { id: String(row.photo_id), mediaType: String(row.media_type), data: String(row.data) }
          : null,
    })),
  };
}

function statusForFilter(filter: InventoryListFilter): string | null {
  if (filter === "disponibles") return GUATEMALA_INVENTORY_STATUS;
  if (filter === "vendidas") return GUATEMALA_SOLD_STATUS;
  return null;
}

export async function readGuatemalaInventoryItem(
  clientId: string,
  itemId: string
): Promise<StoredInventoryItem | { ok: false; status: 403 | 404; error: string }> {
  await ensureGuatemalaInventoryTables();
  if (!(await clientIsGuatemala(clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  const sql = getSql();
  const rows = await sql`
    SELECT id, client_id, source_group_id, sku, title, description, brand, size, condition,
      price_gtq::text AS price_gtq, status
    FROM guatemala_inventory_items
    WHERE id = ${itemId} AND client_id = ${clientId}
    LIMIT 1
  `;
  const row = rows[0] as ItemRow | undefined;
  if (!row) return { ok: false, status: 404, error: GUATEMALA_SALE_MESSAGES.notFound };
  return storedFromRow(row, await photosFor(itemId), await saleFor(clientId, itemId));
}

async function saleFor(clientId: string, itemId: string): Promise<GuatemalaSaleSnapshot | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT sku, published_price_gtq::text AS published_price_gtq,
      charged_price_gtq::text AS charged_price_gtq, sold_at
    FROM guatemala_inventory_sales
    WHERE item_id = ${itemId} AND client_id = ${clientId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    sku: String(row.sku),
    publishedPriceGtq: normalizePriceText(row.published_price_gtq),
    chargedPriceGtq: normalizePriceText(row.charged_price_gtq),
    soldAt: isoTimestamp(row.sold_at),
  };
}

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? String(value ?? "") : parsed.toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

export async function confirmGuatemalaSale(input: {
  clientId?: unknown;
  itemId?: unknown;
  chargedPrice?: unknown;
}): Promise<
  | {
      ok: true;
      available: number;
      item: { id: string; sku: string; status: InventoryItemStatus; priceGtq: string; sale: GuatemalaSaleSnapshot };
    }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string }
> {
  const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
  const itemId = typeof input.itemId === "string" ? input.itemId.trim() : "";
  if (!clientId || !itemId) {
    return { ok: false, status: 404, error: GUATEMALA_SALE_MESSAGES.notFound };
  }
  const chargedPriceGtq = quetzalPriceText(input.chargedPrice);
  if (!chargedPriceGtq) {
    return { ok: false, status: 400, error: GUATEMALA_SALE_MESSAGES.priceInvalid };
  }
  await ensureGuatemalaInventoryTables();
  if (!(await clientIsGuatemala(clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  const sql = getSql();
  const saleId = crypto.randomUUID();
  let rows: Record<string, unknown>[];
  try {
    rows = await sql`
      WITH sold_item AS (
        UPDATE guatemala_inventory_items
        SET status = ${GUATEMALA_SOLD_STATUS}
        WHERE id = ${itemId}
          AND client_id = ${clientId}
          AND status = ${GUATEMALA_INVENTORY_STATUS}
        RETURNING id, client_id, sku, price_gtq
      ),
      inserted_sale AS (
        INSERT INTO guatemala_inventory_sales (
          id, item_id, client_id, sku, published_price_gtq, charged_price_gtq, sold_at
        )
        SELECT ${saleId}, sold_item.id, sold_item.client_id, sold_item.sku,
          sold_item.price_gtq, ${chargedPriceGtq}::numeric, NOW()
        FROM sold_item
        RETURNING item_id, sku, published_price_gtq::text AS published_price_gtq,
          charged_price_gtq::text AS charged_price_gtq, sold_at
      )
      SELECT item_id, sku, published_price_gtq, charged_price_gtq, sold_at
      FROM inserted_sale
    `;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, status: 409, error: GUATEMALA_SALE_MESSAGES.alreadySold };
    }
    throw error;
  }
  const saved = rows[0];
  if (!saved) {
    const existing = await sql`
      SELECT status
      FROM guatemala_inventory_items
      WHERE id = ${itemId} AND client_id = ${clientId}
      LIMIT 1
    `;
    if (!existing[0]) return { ok: false, status: 404, error: GUATEMALA_SALE_MESSAGES.notFound };
    return { ok: false, status: 409, error: GUATEMALA_SALE_MESSAGES.alreadySold };
  }
  const counts = await sql`
    SELECT COUNT(*)::int AS available
    FROM guatemala_inventory_items
    WHERE client_id = ${clientId} AND status = ${GUATEMALA_INVENTORY_STATUS}
  `;
  const sale: GuatemalaSaleSnapshot = {
    sku: String(saved.sku),
    publishedPriceGtq: normalizePriceText(saved.published_price_gtq),
    chargedPriceGtq: normalizePriceText(saved.charged_price_gtq),
    soldAt: isoTimestamp(saved.sold_at),
  };
  return {
    ok: true,
    available: Number(counts[0]?.available ?? 0),
    item: {
      id: itemId,
      sku: sale.sku,
      status: GUATEMALA_SOLD_STATUS,
      priceGtq: sale.publishedPriceGtq,
      sale,
    },
  };
}
