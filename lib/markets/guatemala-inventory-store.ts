import { getSql } from "@/lib/db";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import {
  GUATEMALA_INVENTORY_MESSAGES,
  GUATEMALA_INVENTORY_STATUS,
  inventoryLikePattern,
  prepareInventorySave,
  resolveInventoryInsert,
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

function storedFromRow(row: ItemRow, photos: InventoryPhoto[]): StoredInventoryItem {
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
    status: GUATEMALA_INVENTORY_STATUS,
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
  status: typeof GUATEMALA_INVENTORY_STATUS;
  cover: InventoryPhoto | null;
}

export async function listGuatemalaInventory(
  clientId: string,
  query: string
): Promise<{ available: number; items: InventoryListItem[] } | { ok: false; status: 403; error: string }> {
  await ensureGuatemalaInventoryTables();
  if (!(await clientIsGuatemala(clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  const sql = getSql();
  const pattern = inventoryLikePattern(query);
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
      status: GUATEMALA_INVENTORY_STATUS,
      cover:
        row.photo_id && row.data
          ? { id: String(row.photo_id), mediaType: String(row.media_type), data: String(row.data) }
          : null,
    })),
  };
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
  if (!row) return { ok: false, status: 404, error: "No se encontró la prenda." };
  return storedFromRow(row, await photosFor(itemId));
}
