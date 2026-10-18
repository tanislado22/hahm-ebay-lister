import { getSql } from "@/lib/db";
import { boundGuatemalaClientId, clientIsGuatemala } from "@/lib/markets/client-market";
import {
  GUATEMALA_CATALOG_MESSAGES,
  publicCatalogCards,
  publicCatalogDetailView,
  publicCatalogFacets,
  type CatalogFilters,
  type CatalogSourceItem,
  type PublicCatalogCard,
  type PublicCatalogDetail,
  type PublicCatalogFacets,
} from "@/lib/markets/guatemala-catalog";
import { GUATEMALA_MARKET } from "@/lib/markets/guatemala";
import {
  changePublication,
  isolatedPublicationSku,
  PUBLICATION_MESSAGES,
  type PublicationAction,
  type PublicationEvent,
  type StaffPublicationItem,
} from "@/lib/markets/guatemala-publish";
import { EXISTING_PRUEBA1_TEST_SALE } from "@/lib/markets/guatemala-recorded-test";
import {
  GUATEMALA_PURGE_MESSAGES,
  purgeConfirmText,
  purgeCounts,
  samePurgeCounts,
  type PurgeCorrection,
  type PurgeCounts,
  type PurgeGarment,
  type PurgePhoto,
  type PurgeSale,
} from "@/lib/markets/guatemala-purge";
import {
  GUATEMALA_CORRECTION_MESSAGES,
  saleReasonText,
} from "@/lib/markets/guatemala-sale-correction";
import {
  guatemalaSalesRange,
  parseSalesReportPeriod,
  type SalesReportPeriod,
} from "@/lib/markets/guatemala-sales-report";
import { listGuatemalaExpenses } from "@/lib/markets/guatemala-expenses-store";
import { summarizeGuatemalaProfit, type ProfitSummary } from "@/lib/markets/guatemala-expenses";
import {
  GUATEMALA_COST_MESSAGES,
  GUATEMALA_INVENTORY_MESSAGES,
  GUATEMALA_INVENTORY_STATUS,
  GUATEMALA_SALE_MESSAGES,
  GUATEMALA_SOLD_STATUS,
  GUATEMALA_WITHDRAWN_STATUS,
  inventoryLikePattern,
  inventoryListFilter,
  prepareGarmentCost,
  prepareInventorySave,
  quetzalPriceText,
  resolveInventoryInsert,
  type GuatemalaSaleSnapshot,
  type InventoryItemStatus,
  type InventoryListFilter,
  type InventoryPhoto,
  type PreparedInventoryItem,
  type PublicationEventView,
  type SaleActor,
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
  clientAllowed: (clientId: string) => Promise<boolean>,
  createdBy?: SaleActor | null
): Promise<InventorySaveResult> {
  const prepared = prepareInventorySave(input);
  if (!prepared.ok) return prepared;
  if (!(await clientAllowed(prepared.item.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  const item = { ...prepared.item, createdBy: createdBy ?? null };
  const inserted = await repository.insert(item);
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
  const retried = await repository.insert(item);
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
      sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_test BOOLEAN NOT NULL DEFAULT FALSE,
      sold_by_role TEXT,
      sold_by_account_id TEXT,
      sold_by_username TEXT
    )
  `;
  await sql`
    ALTER TABLE guatemala_inventory_sales
    ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE
  `;
  await sql`
    ALTER TABLE guatemala_inventory_sales
    ADD COLUMN IF NOT EXISTS sold_by_role TEXT
  `;
  await sql`
    ALTER TABLE guatemala_inventory_sales
    ADD COLUMN IF NOT EXISTS sold_by_account_id TEXT
  `;
  await sql`
    ALTER TABLE guatemala_inventory_sales
    ADD COLUMN IF NOT EXISTS sold_by_username TEXT
  `;
  await sql`
    ALTER TABLE guatemala_inventory_sales
    ADD COLUMN IF NOT EXISTS current_charged_price_gtq NUMERIC(12, 2)
  `;
  await sql`
    ALTER TABLE guatemala_inventory_sales
    ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_sale_corrections (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      action TEXT NOT NULL,
      previous_charged_price_gtq NUMERIC(12, 2) NOT NULL,
      new_charged_price_gtq NUMERIC(12, 2),
      reason TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_account_id TEXT,
      actor_username TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE guatemala_inventory_sales
    DROP CONSTRAINT IF EXISTS guatemala_inventory_sales_item_id_key
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS guatemala_inventory_sales_one_active_item
    ON guatemala_inventory_sales (item_id)
    WHERE voided_at IS NULL
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_schema_flags (
      flag TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE guatemala_inventory_items
    ADD COLUMN IF NOT EXISTS cost_gtq NUMERIC(12, 2)
  `;
  await sql`
    ALTER TABLE guatemala_inventory_items
    ADD COLUMN IF NOT EXISTS cost_includes_photography BOOLEAN NOT NULL DEFAULT FALSE
  `;
  await sql`
    ALTER TABLE guatemala_inventory_items
    ADD COLUMN IF NOT EXISTS created_by_role TEXT
  `;
  await sql`
    ALTER TABLE guatemala_inventory_items
    ADD COLUMN IF NOT EXISTS created_by_account_id TEXT
  `;
  await sql`
    ALTER TABLE guatemala_inventory_items
    ADD COLUMN IF NOT EXISTS created_by_username TEXT
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_publication_events (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_account_id TEXT,
      actor_username TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

// Marks the sale already stored for SKU 3002 on Tienda Guatemala as a test.
// The flag runs once. Later sales keep is_test false even if the SKU is 3002.
async function markRecordedSku3002SaleAsTest(): Promise<void> {
  const sql = getSql();
  await sql`
    WITH flag AS (
      INSERT INTO guatemala_schema_flags (flag)
      VALUES ('mark-existing-guatemala-sku-3002-sale-as-test')
      ON CONFLICT DO NOTHING
      RETURNING applied_at
    )
    UPDATE guatemala_inventory_sales AS sale
    SET is_test = TRUE
    FROM flag
    WHERE sale.sku = '3002'
      AND sale.sold_at <= flag.applied_at
      AND EXISTS (
        SELECT 1
        FROM client_markets AS market
        WHERE market.client_id = sale.client_id
          AND market.market_code = ${GUATEMALA_MARKET.code}
      )
  `;
}

// Marks the one preview sale of prueba1, Q40 published and Q20 charged at 03:22 Guatemala.
// The flag runs once and does not change price, date, or author. Later prueba1 sales stay real.
async function markRecordedPrueba1SaleAsTest(): Promise<void> {
  const sql = getSql();
  await sql`
    WITH flag AS (
      INSERT INTO guatemala_schema_flags (flag)
      VALUES ('mark-existing-guatemala-prueba1-q40-q20-20261017T0922-sale-as-test')
      ON CONFLICT DO NOTHING
      RETURNING applied_at
    )
    UPDATE guatemala_inventory_sales AS sale
    SET is_test = TRUE
    FROM flag
    WHERE sale.sku = ${EXISTING_PRUEBA1_TEST_SALE.sku}
      AND sale.published_price_gtq = ${EXISTING_PRUEBA1_TEST_SALE.publishedPriceGtq}::numeric
      AND sale.charged_price_gtq = ${EXISTING_PRUEBA1_TEST_SALE.chargedPriceGtq}::numeric
      AND sale.sold_at >= ${EXISTING_PRUEBA1_TEST_SALE.soldFromInclusive}::timestamptz
      AND sale.sold_at < ${EXISTING_PRUEBA1_TEST_SALE.soldToExclusive}::timestamptz
      AND sale.sold_at <= flag.applied_at
      AND EXISTS (
        SELECT 1
        FROM client_markets AS market
        WHERE market.client_id = sale.client_id
          AND market.market_code = ${GUATEMALA_MARKET.code}
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
  cost_gtq?: string | null;
  cost_includes_photography?: boolean | string | null;
  created_by_role?: string | null;
  created_by_account_id?: string | null;
  created_by_username?: string | null;
}

function itemStatus(value: unknown): InventoryItemStatus {
  if (value === GUATEMALA_SOLD_STATUS) return GUATEMALA_SOLD_STATUS;
  if (value === GUATEMALA_WITHDRAWN_STATUS) return GUATEMALA_WITHDRAWN_STATUS;
  return GUATEMALA_INVENTORY_STATUS;
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
    costGtq: optionalCostText(row.cost_gtq),
    costIncludesPhotography: optionalCostText(row.cost_gtq) != null && flag(row.cost_includes_photography),
    createdBy: createdByFrom(row),
  };
}

function createdByFrom(row: ItemRow): SaleActor | null {
  const role = row.created_by_role === "encargado" || row.created_by_role === "propietario" ? row.created_by_role : null;
  if (!role) return null;
  return {
    role,
    accountId: row.created_by_account_id ? String(row.created_by_account_id) : null,
    username: row.created_by_username ? String(row.created_by_username) : null,
  };
}

function flag(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

function optionalCostText(value: unknown): string | null {
  if (value == null || value === "") return null;
  return quetzalPriceText(normalizePriceText(value));
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
                 price_gtq::text AS price_gtq, status,
                 created_by_role, created_by_account_id, created_by_username
          FROM guatemala_inventory_items
          WHERE client_id = ${clientId} AND sku = ${value}
          LIMIT 1
        `
      : await sql`
          SELECT id, client_id, source_group_id, sku, title, description, brand, size, condition,
                 price_gtq::text AS price_gtq, status,
                 created_by_role, created_by_account_id, created_by_username
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
        brand, size, condition, price_gtq, currency, status,
        created_by_role, created_by_account_id, created_by_username
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
        ${GUATEMALA_INVENTORY_STATUS},
        ${item.createdBy?.role ?? null},
        ${item.createdBy?.accountId ?? null},
        ${item.createdBy?.username ?? null}
      )
      ON CONFLICT DO NOTHING
      RETURNING id, client_id, source_group_id, sku, title, description, brand, size, condition,
        price_gtq::text AS price_gtq, status,
        created_by_role, created_by_account_id, created_by_username
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
      price_gtq, status, created_by_role, created_by_account_id, created_by_username
    FROM inserted
  `;
  const row = rows[0] as ItemRow | undefined;
  if (!row) return null;
  return storedFromRow(row, item.photos);
}

export async function saveGuatemalaInventoryItem(
  input: SaveBody,
  createdBy?: SaleActor | null
): Promise<InventorySaveResult> {
  await ensureGuatemalaInventoryTables();
  return runInventorySave(postgresRepository(), input, clientIsGuatemala, createdBy);
}

export async function guatemalaSkuTaken(clientId: string, sku: string): Promise<boolean> {
  await ensureGuatemalaInventoryTables();
  const stored = await findRow(clientId, "sku", sku);
  return Boolean(stored);
}

export async function removeIsolatedGuatemalaPublication(
  clientId: string,
  itemId: string
): Promise<{ ok: true; sku: string } | { ok: false; status: 404; error: string }> {
  await ensureGuatemalaInventoryTables();
  const sql = getSql();
  const rows = await sql`
    WITH target AS (
      SELECT id, sku
      FROM guatemala_inventory_items
      WHERE id = ${itemId}
        AND client_id = ${clientId}
        AND sku ~ '^prueba-publicar-[a-z0-9]{8,24}$'
        AND NOT EXISTS (
          SELECT 1
          FROM guatemala_inventory_sales AS sale
          WHERE sale.item_id = guatemala_inventory_items.id
        )
    ),
    removed_photos AS (
      DELETE FROM guatemala_inventory_photos
      WHERE item_id IN (SELECT id FROM target)
      RETURNING item_id
    ),
    removed AS (
      DELETE FROM guatemala_inventory_items
      WHERE id IN (SELECT id FROM target)
      RETURNING sku
    )
    SELECT sku FROM removed
  `;
  const sku = rows[0]?.sku ? String(rows[0].sku) : "";
  if (!sku || !isolatedPublicationSku(sku)) {
    return { ok: false, status: 404, error: "No se eliminó ninguna prenda real." };
  }
  return { ok: true, sku };
}

export interface InventoryListItem {
  id: string;
  sku: string;
  title: string;
  size: string;
  priceGtq: string;
  status: InventoryItemStatus;
  cover: InventoryPhoto | null;
  chargedPriceGtq: string | null;
  publishedPriceGtq: string | null;
  saleIsTest: boolean;
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
  await markRecordedSku3002SaleAsTest();
  await markRecordedPrueba1SaleAsTest();
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
          photo.id AS photo_id, photo.media_type, photo.data,
          COALESCE(sale.current_charged_price_gtq, sale.charged_price_gtq)::text AS charged_price_gtq,
          sale.published_price_gtq::text AS published_price_gtq,
          sale.is_test AS sale_is_test
        FROM guatemala_inventory_items AS item
        LEFT JOIN guatemala_inventory_sales AS sale
          ON sale.item_id = item.id AND sale.client_id = item.client_id AND sale.voided_at IS NULL
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
          photo.id AS photo_id, photo.media_type, photo.data,
          COALESCE(sale.current_charged_price_gtq, sale.charged_price_gtq)::text AS charged_price_gtq,
          sale.published_price_gtq::text AS published_price_gtq,
          sale.is_test AS sale_is_test
        FROM guatemala_inventory_items AS item
        LEFT JOIN guatemala_inventory_sales AS sale
          ON sale.item_id = item.id AND sale.client_id = item.client_id AND sale.voided_at IS NULL
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
      chargedPriceGtq: row.charged_price_gtq ? normalizePriceText(row.charged_price_gtq) : null,
      publishedPriceGtq: row.published_price_gtq ? normalizePriceText(row.published_price_gtq) : null,
      saleIsTest: row.sale_is_test === true || row.sale_is_test === "t" || row.sale_is_test === "true",
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
  if (filter === "retiradas") return GUATEMALA_WITHDRAWN_STATUS;
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
      price_gtq::text AS price_gtq, status,
      cost_gtq::text AS cost_gtq, cost_includes_photography,
      created_by_role, created_by_account_id, created_by_username
    FROM guatemala_inventory_items
    WHERE id = ${itemId} AND client_id = ${clientId}
    LIMIT 1
  `;
  const row = rows[0] as ItemRow | undefined;
  if (!row) return { ok: false, status: 404, error: GUATEMALA_SALE_MESSAGES.notFound };
  const stored = storedFromRow(row, await photosFor(itemId), await saleFor(clientId, itemId));
  return { ...stored, publicationEvents: await publicationEventsFor(clientId, itemId) };
}

export async function withdrawGuatemalaPublication(
  clientId: string,
  itemId: string,
  actor: SaleActor
): Promise<PublicationWriteResult> {
  return writePublication(clientId, itemId, "retirar", null, actor);
}

export async function republishGuatemalaPublication(
  clientId: string,
  itemId: string,
  actor: SaleActor
): Promise<PublicationWriteResult> {
  return writePublication(clientId, itemId, "republicar", null, actor);
}

export async function correctGuatemalaPublication(
  clientId: string,
  itemId: string,
  input: SaveBody,
  actor: SaleActor
): Promise<PublicationWriteResult> {
  await ensureGuatemalaInventoryTables();
  const loaded = await loadPublicationItem(clientId, itemId);
  if (!loaded.ok) return loaded;
  const prepared = prepareInventorySave({
    ...input,
    clientId,
    sourceGroupId: loaded.sourceGroupId,
    sku: loaded.item.sku,
  });
  if (!prepared.ok) return prepared;
  return writePublication(clientId, itemId, "corregir", prepared.item, actor);
}

type PublicationWriteResult =
  | {
      ok: true;
      already: boolean;
      message: string;
      item: { id: string; sku: string; status: InventoryItemStatus; priceGtq: string };
    }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

async function writePublication(
  clientId: string,
  itemId: string,
  action: PublicationAction,
  prepared: PreparedInventoryItem | null,
  actor: SaleActor
): Promise<PublicationWriteResult> {
  await ensureGuatemalaInventoryTables();
  const loaded = await loadPublicationItem(clientId, itemId);
  if (!loaded.ok) return loaded;
  const planned = changePublication(
    loaded.item,
    clientId,
    action,
    prepared
      ? {
          title: prepared.title,
          description: prepared.description,
          brand: prepared.brand,
          size: prepared.size,
          condition: prepared.condition,
          priceGtq: prepared.priceGtq,
          photoCount: prepared.photos.length,
        }
      : null,
    actor,
    new Date()
  );
  if (!planned.ok) return planned;
  if (planned.already || !planned.event) {
    return { ok: true, already: true, message: planned.message, item: publicationSummary(loaded.item) };
  }
  if (action === "corregir" && !prepared) {
    return { ok: false, status: 400, error: PUBLICATION_MESSAGES.retry };
  }
  const saved =
    action === "corregir" && prepared
      ? await updatePublicationContents(clientId, itemId, prepared)
      : await updatePublicationStatus(clientId, itemId, action === "republicar" ? "republicar" : "retirar");
  if (!saved) {
    const again = await loadPublicationItem(clientId, itemId);
    if (again.ok && again.item.status === planned.item.status && action !== "corregir") {
      return { ok: true, already: true, message: planned.message, item: publicationSummary(again.item) };
    }
    return { ok: false, status: 409, error: PUBLICATION_MESSAGES.retry };
  }
  await recordPublicationEvent(clientId, itemId, planned.event);
  return { ok: true, already: false, message: planned.message, item: saved };
}

async function loadPublicationItem(
  clientId: string,
  itemId: string
): Promise<
  | { ok: true; item: StaffPublicationItem; sourceGroupId: string }
  | { ok: false; status: 403 | 404; error: string }
> {
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
  const row = rows[0];
  if (!row) return { ok: false, status: 404, error: PUBLICATION_MESSAGES.notFound };
  const photos = await photosFor(itemId);
  const sales = await sql`
    SELECT 1
    FROM guatemala_inventory_sales
    WHERE item_id = ${itemId} AND client_id = ${clientId} AND voided_at IS NULL
    LIMIT 1
  `;
  return {
    ok: true,
    sourceGroupId: String(row.source_group_id),
    item: {
      id: String(row.id),
      clientId: String(row.client_id),
      sku: String(row.sku),
      title: String(row.title ?? ""),
      description: String(row.description ?? ""),
      brand: String(row.brand ?? ""),
      size: String(row.size ?? ""),
      condition: String(row.condition ?? ""),
      priceGtq: normalizePriceText(row.price_gtq),
      status: itemStatus(row.status),
      photoCount: photos.length,
      sold: sales.length > 0,
    },
  };
}

function publicationSummary(item: StaffPublicationItem): {
  id: string;
  sku: string;
  status: InventoryItemStatus;
  priceGtq: string;
} {
  return { id: item.id, sku: item.sku, status: item.status, priceGtq: item.priceGtq };
}

async function updatePublicationStatus(
  clientId: string,
  itemId: string,
  action: "retirar" | "republicar"
): Promise<{ id: string; sku: string; status: InventoryItemStatus; priceGtq: string } | null> {
  const sql = getSql();
  const next = action === "retirar" ? GUATEMALA_WITHDRAWN_STATUS : GUATEMALA_INVENTORY_STATUS;
  const current = action === "retirar" ? GUATEMALA_INVENTORY_STATUS : GUATEMALA_WITHDRAWN_STATUS;
  const rows = await sql`
    UPDATE guatemala_inventory_items AS item
    SET status = ${next}
    WHERE item.id = ${itemId}
      AND item.client_id = ${clientId}
      AND item.status = ${current}
      AND NOT EXISTS (
        SELECT 1
        FROM guatemala_inventory_sales AS sale
        WHERE sale.item_id = item.id
          AND sale.client_id = item.client_id
          AND sale.voided_at IS NULL
      )
    RETURNING id, sku, status, price_gtq::text AS price_gtq
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    sku: String(row.sku),
    status: itemStatus(row.status),
    priceGtq: normalizePriceText(row.price_gtq),
  };
}

async function updatePublicationContents(
  clientId: string,
  itemId: string,
  item: PreparedInventoryItem
): Promise<{ id: string; sku: string; status: InventoryItemStatus; priceGtq: string } | null> {
  const sql = getSql();
  const photoJson = JSON.stringify(
    item.photos.map((photo, position) => ({
      id: photo.id,
      photo_position: position,
      media_type: photo.mediaType,
      data: photo.data,
    }))
  );
  const rows = await sql`
    WITH updated AS (
      UPDATE guatemala_inventory_items AS item
      SET title = ${item.title},
          description = ${item.description},
          brand = ${item.brand},
          size = ${item.size},
          condition = ${item.condition},
          price_gtq = ${item.priceGtq}::numeric
      WHERE item.id = ${itemId}
        AND item.client_id = ${clientId}
        AND item.sku = ${item.sku}
        AND item.status IN (${GUATEMALA_INVENTORY_STATUS}, ${GUATEMALA_WITHDRAWN_STATUS})
        AND NOT EXISTS (
          SELECT 1
          FROM guatemala_inventory_sales AS sale
          WHERE sale.item_id = item.id
            AND sale.client_id = item.client_id
            AND sale.voided_at IS NULL
        )
      RETURNING id, sku, status, price_gtq::text AS price_gtq
    ),
    removed AS (
      DELETE FROM guatemala_inventory_photos
      WHERE item_id IN (SELECT id FROM updated)
      RETURNING item_id
    ),
    saved_photos AS (
      INSERT INTO guatemala_inventory_photos (id, item_id, position, media_type, data)
      SELECT photo.id, updated.id, photo.photo_position, photo.media_type, photo.data
      FROM jsonb_to_recordset(${photoJson}::jsonb)
        AS photo(id text, photo_position int, media_type text, data text)
      CROSS JOIN updated
      RETURNING item_id
    )
    SELECT updated.id, updated.sku, updated.status, updated.price_gtq
    FROM updated
    WHERE (SELECT COUNT(*) FROM removed) >= 0
      AND (SELECT COUNT(*) FROM saved_photos) >= 0
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    sku: String(row.sku),
    status: itemStatus(row.status),
    priceGtq: normalizePriceText(row.price_gtq),
  };
}

async function recordPublicationEvent(clientId: string, itemId: string, event: PublicationEvent): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO guatemala_publication_events (
      id, item_id, client_id, action, actor_role, actor_account_id, actor_username, created_at
    )
    VALUES (
      ${crypto.randomUUID()},
      ${itemId},
      ${clientId},
      ${event.action},
      ${event.actor.role},
      ${event.actor.accountId},
      ${event.actor.username},
      ${event.at}::timestamptz
    )
  `;
}

async function publicationEventsFor(clientId: string, itemId: string): Promise<PublicationEventView[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT action, actor_role, actor_username, created_at
    FROM guatemala_publication_events
    WHERE item_id = ${itemId} AND client_id = ${clientId}
    ORDER BY created_at ASC
  `;
  return rows.flatMap((row) => {
    const action = row.action === "retirar" || row.action === "corregir" || row.action === "republicar" ? row.action : null;
    const actorRole = row.actor_role === "encargado" || row.actor_role === "propietario" ? row.actor_role : null;
    if (!action || !actorRole) return [];
    return [
      {
        action,
        actorRole,
        actorUsername: row.actor_username ? String(row.actor_username) : null,
        createdAt: isoTimestamp(row.created_at),
      },
    ];
  });
}

export async function updateGuatemalaGarmentCost(input: {
  clientId: string;
  itemId: string;
  cost: unknown;
  includesPhotography: unknown;
}): Promise<
  | { ok: true; costGtq: string | null; costIncludesPhotography: boolean; message: string }
  | { ok: false; status: 400 | 403 | 404; error: string }
> {
  const prepared = prepareGarmentCost({
    cost: input.cost,
    includesPhotography: input.includesPhotography,
  });
  if (!prepared.ok) return prepared;
  await ensureGuatemalaInventoryTables();
  if (!(await clientIsGuatemala(input.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  const sql = getSql();
  const rows = prepared.costGtq
    ? await sql`
        UPDATE guatemala_inventory_items
        SET cost_gtq = ${prepared.costGtq}::numeric,
            cost_includes_photography = ${prepared.includesPhotography}
        WHERE id = ${input.itemId} AND client_id = ${input.clientId}
        RETURNING cost_gtq::text AS cost_gtq, cost_includes_photography
      `
    : await sql`
        UPDATE guatemala_inventory_items
        SET cost_gtq = NULL,
            cost_includes_photography = FALSE
        WHERE id = ${input.itemId} AND client_id = ${input.clientId}
        RETURNING cost_gtq::text AS cost_gtq, cost_includes_photography
      `;
  if (!rows[0]) return { ok: false, status: 404, error: GUATEMALA_COST_MESSAGES.notFound };
  const costGtq = optionalCostText(rows[0].cost_gtq);
  return {
    ok: true,
    costGtq,
    costIncludesPhotography: costGtq != null && flag(rows[0].cost_includes_photography),
    message: GUATEMALA_COST_MESSAGES.saved,
  };
}

async function saleFor(clientId: string, itemId: string): Promise<GuatemalaSaleSnapshot | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, sku, published_price_gtq::text AS published_price_gtq,
      charged_price_gtq::text AS charged_price_gtq,
      current_charged_price_gtq::text AS current_charged_price_gtq,
      sold_at, is_test, voided_at, sold_by_role, sold_by_username
    FROM guatemala_inventory_sales
    WHERE item_id = ${itemId} AND client_id = ${clientId}
    ORDER BY (voided_at IS NULL) DESC, sold_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const corrections = await sql`
    SELECT id, action, previous_charged_price_gtq::text AS previous_charged_price_gtq,
      new_charged_price_gtq::text AS new_charged_price_gtq, reason, created_at, actor_role, actor_username
    FROM guatemala_sale_corrections
    WHERE item_id = ${itemId} AND client_id = ${clientId}
    ORDER BY created_at ASC
  `;
  const original = normalizePriceText(row.charged_price_gtq);
  return {
    id: String(row.id),
    sku: String(row.sku),
    publishedPriceGtq: normalizePriceText(row.published_price_gtq),
    originalChargedPriceGtq: original,
    chargedPriceGtq: row.current_charged_price_gtq
      ? normalizePriceText(row.current_charged_price_gtq)
      : original,
    soldAt: isoTimestamp(row.sold_at),
    isTest: row.is_test === true || row.is_test === "t" || row.is_test === "true",
    voidedAt: row.voided_at ? isoTimestamp(row.voided_at) : null,
    soldByRole: row.sold_by_role === "encargado" || row.sold_by_role === "propietario" ? row.sold_by_role : null,
    soldByUsername: row.sold_by_username ? String(row.sold_by_username) : null,
    corrections: corrections.map((correction) => ({
      id: String(correction.id),
      action: correction.action === "anular" ? "anular" : "corregir",
      previousChargedPriceGtq: normalizePriceText(correction.previous_charged_price_gtq),
      newChargedPriceGtq: correction.new_charged_price_gtq
        ? normalizePriceText(correction.new_charged_price_gtq)
        : null,
      reason: String(correction.reason ?? ""),
      createdAt: isoTimestamp(correction.created_at),
      actorRole: "propietario" as const,
      actorUsername: correction.actor_username ? String(correction.actor_username) : null,
    })),
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
  soldBy?: SaleActor | null;
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
  const soldByRole = input.soldBy?.role ?? null;
  const soldByAccountId = input.soldBy?.accountId ?? null;
  const soldByUsername = input.soldBy?.username ?? null;
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
          id, item_id, client_id, sku, published_price_gtq, charged_price_gtq, sold_at,
          sold_by_role, sold_by_account_id, sold_by_username
        )
        SELECT ${saleId}, sold_item.id, sold_item.client_id, sold_item.sku,
          sold_item.price_gtq, ${chargedPriceGtq}::numeric, NOW(),
          ${soldByRole}, ${soldByAccountId}, ${soldByUsername}
        FROM sold_item
        RETURNING item_id, sku, published_price_gtq::text AS published_price_gtq,
          charged_price_gtq::text AS charged_price_gtq, sold_at, sold_by_role, sold_by_username
      )
      SELECT item_id, sku, published_price_gtq, charged_price_gtq, sold_at, sold_by_role, sold_by_username
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
    soldByRole:
      saved.sold_by_role === "encargado" || saved.sold_by_role === "propietario"
        ? saved.sold_by_role
        : null,
    soldByUsername: saved.sold_by_username ? String(saved.sold_by_username) : null,
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

export async function correctGuatemalaSale(input: {
  clientId: string;
  itemId: string;
  action: "corregir" | "anular";
  correctionId: string;
  reason: unknown;
  chargedPrice?: unknown;
  expectedChargedPrice: unknown;
  actor: SaleActor;
}): Promise<
  | { ok: true; available: number; sale: GuatemalaSaleSnapshot }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string }
> {
  if (input.actor.role !== "propietario") {
    return { ok: false, status: 403, error: GUATEMALA_CORRECTION_MESSAGES.forbidden };
  }
  const correctionId = input.correctionId.trim();
  const reason = saleReasonText(input.reason);
  if (!correctionId || !reason) {
    return { ok: false, status: 400, error: GUATEMALA_CORRECTION_MESSAGES.reasonRequired };
  }
  const nextPrice = input.action === "corregir" ? quetzalPriceText(input.chargedPrice) : null;
  if (input.action === "corregir" && !nextPrice) {
    return { ok: false, status: 400, error: GUATEMALA_SALE_MESSAGES.priceInvalid };
  }
  const expected = quetzalPriceText(input.expectedChargedPrice);
  if (!expected) return { ok: false, status: 409, error: GUATEMALA_CORRECTION_MESSAGES.stale };
  await ensureGuatemalaInventoryTables();
  if (!(await clientIsGuatemala(input.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  const replay = await replayCorrection(input.clientId, input.itemId, correctionId, input.action);
  if (replay) return replay;
  const sql = getSql();
  let saved: Record<string, unknown> | undefined;
  try {
    const rows =
      input.action === "anular"
        ? await sql`
            WITH sale_row AS (
              SELECT id, item_id, client_id,
                COALESCE(current_charged_price_gtq, charged_price_gtq) AS effective
              FROM guatemala_inventory_sales
              WHERE item_id = ${input.itemId}
                AND client_id = ${input.clientId}
                AND voided_at IS NULL
            ),
            opened AS (
              UPDATE guatemala_inventory_items AS item
              SET status = ${GUATEMALA_INVENTORY_STATUS}
              FROM sale_row
              WHERE item.id = sale_row.item_id
                AND item.client_id = sale_row.client_id
                AND item.status = ${GUATEMALA_SOLD_STATUS}
                AND sale_row.effective = ${expected}::numeric
              RETURNING item.id
            ),
            voided AS (
              UPDATE guatemala_inventory_sales AS sale
              SET voided_at = NOW()
              FROM sale_row, opened
              WHERE sale.id = sale_row.id
              RETURNING sale.id
            )
            INSERT INTO guatemala_sale_corrections (
              id, sale_id, client_id, item_id, action,
              previous_charged_price_gtq, new_charged_price_gtq,
              reason, actor_role, actor_account_id, actor_username
            )
            SELECT ${correctionId}, voided.id, ${input.clientId}, ${input.itemId}, 'anular',
              ${expected}::numeric, NULL, ${reason}, 'propietario', ${input.actor.accountId}, ${input.actor.username}
            FROM voided
            RETURNING sale_id
          `
        : await sql`
            WITH sale_row AS (
              SELECT sale.id, sale.item_id,
                COALESCE(sale.current_charged_price_gtq, sale.charged_price_gtq) AS effective
              FROM guatemala_inventory_sales AS sale
              INNER JOIN guatemala_inventory_items AS item
                ON item.id = sale.item_id AND item.client_id = sale.client_id
              WHERE sale.item_id = ${input.itemId}
                AND sale.client_id = ${input.clientId}
                AND sale.voided_at IS NULL
                AND item.status = ${GUATEMALA_SOLD_STATUS}
            ),
            updated AS (
              UPDATE guatemala_inventory_sales AS sale
              SET current_charged_price_gtq = ${nextPrice}::numeric
              FROM sale_row
              WHERE sale.id = sale_row.id
                AND sale_row.effective = ${expected}::numeric
                AND sale_row.effective <> ${nextPrice}::numeric
              RETURNING sale.id
            )
            INSERT INTO guatemala_sale_corrections (
              id, sale_id, client_id, item_id, action,
              previous_charged_price_gtq, new_charged_price_gtq,
              reason, actor_role, actor_account_id, actor_username
            )
            SELECT ${correctionId}, updated.id, ${input.clientId}, ${input.itemId}, 'corregir',
              ${expected}::numeric, ${nextPrice}::numeric, ${reason}, 'propietario',
              ${input.actor.accountId}, ${input.actor.username}
            FROM updated
            RETURNING sale_id
          `;
    saved = rows[0];
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await replayCorrection(input.clientId, input.itemId, correctionId, input.action);
      if (raced) return raced;
      return { ok: false, status: 409, error: GUATEMALA_CORRECTION_MESSAGES.stale };
    }
    throw error;
  }
  if (!saved) {
    const current = await saleFor(input.clientId, input.itemId);
    if (!current) return { ok: false, status: 404, error: GUATEMALA_CORRECTION_MESSAGES.notFound };
    if (current.voidedAt) return { ok: false, status: 409, error: GUATEMALA_CORRECTION_MESSAGES.voided };
    if (input.action === "corregir" && current.chargedPriceGtq === nextPrice) {
      return { ok: false, status: 400, error: GUATEMALA_CORRECTION_MESSAGES.priceUnchanged };
    }
    return { ok: false, status: 409, error: GUATEMALA_CORRECTION_MESSAGES.stale };
  }
  const counts = await sql`
    SELECT COUNT(*)::int AS available
    FROM guatemala_inventory_items
    WHERE client_id = ${input.clientId} AND status = ${GUATEMALA_INVENTORY_STATUS}
  `;
  const sale = await saleFor(input.clientId, input.itemId);
  if (!sale) return { ok: false, status: 404, error: GUATEMALA_CORRECTION_MESSAGES.notFound };
  return { ok: true, available: Number(counts[0]?.available ?? 0), sale };
}

async function replayCorrection(
  clientId: string,
  itemId: string,
  correctionId: string,
  action: "corregir" | "anular"
): Promise<{ ok: true; available: number; sale: GuatemalaSaleSnapshot } | { ok: false; status: 409; error: string } | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT sale_id, item_id, client_id, action
    FROM guatemala_sale_corrections
    WHERE id = ${correctionId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (String(row.client_id) !== clientId || String(row.item_id) !== itemId || String(row.action) !== action) {
    return { ok: false, status: 409, error: GUATEMALA_CORRECTION_MESSAGES.stale };
  }
  const counts = await sql`
    SELECT COUNT(*)::int AS available
    FROM guatemala_inventory_items
    WHERE client_id = ${clientId} AND status = ${GUATEMALA_INVENTORY_STATUS}
  `;
  const sale = await saleFor(clientId, itemId);
  if (!sale) return { ok: false, status: 409, error: GUATEMALA_CORRECTION_MESSAGES.stale };
  return { ok: true, available: Number(counts[0]?.available ?? 0), sale };
}

export interface SalesReportRow {
  itemId: string;
  sku: string;
  title: string;
  publishedPriceGtq: string;
  chargedPriceGtq: string;
  soldAt: string;
  isTest: boolean;
  costGtq: string | null;
  costIncludesPhotography: boolean;
  cover: InventoryPhoto | null;
}

export async function listGuatemalaSalesReport(input: {
  clientId: string;
  period: unknown;
  from?: unknown;
  to?: unknown;
  includeTests: boolean;
  now?: Date;
}): Promise<
  | {
      ok: true;
      timezone: typeof GUATEMALA_MARKET.timezone;
      period: SalesReportPeriod;
      from: string;
      to: string;
      fromLabel: string;
      toLabel: string;
      includeTests: boolean;
      count: number;
      totalChargedGtq: string;
      sales: SalesReportRow[];
      profit: ProfitSummary;
    }
  | { ok: false; status: 400 | 403; error: string }
> {
  const period = parseSalesReportPeriod(input.period);
  const built = guatemalaSalesRange({
    period,
    from: input.from,
    to: input.to,
    now: input.now,
  });
  if (!built.ok) return { ok: false, status: 400, error: built.error };
  await ensureGuatemalaInventoryTables();
  if (!(await clientIsGuatemala(input.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  await markRecordedSku3002SaleAsTest();
  await markRecordedPrueba1SaleAsTest();
  const sql = getSql();
  const rows = await sql`
    SELECT sale.item_id, sale.sku, item.title,
      sale.published_price_gtq::text AS published_price_gtq,
      COALESCE(sale.current_charged_price_gtq, sale.charged_price_gtq)::text AS charged_price_gtq,
      sale.sold_at, sale.is_test,
      item.cost_gtq::text AS cost_gtq,
      item.cost_includes_photography,
      photo.id AS photo_id, photo.media_type, photo.data
    FROM guatemala_inventory_sales AS sale
    INNER JOIN guatemala_inventory_items AS item
      ON item.id = sale.item_id AND item.client_id = sale.client_id
    LEFT JOIN LATERAL (
      SELECT id, media_type, data
      FROM guatemala_inventory_photos
      WHERE item_id = sale.item_id
      ORDER BY position ASC
      LIMIT 1
    ) AS photo ON TRUE
    WHERE sale.client_id = ${input.clientId}
      AND sale.sold_at >= ${built.range.start}
      AND sale.sold_at < ${built.range.end}
      AND sale.voided_at IS NULL
      AND (${input.includeTests} OR sale.is_test = FALSE)
    ORDER BY sale.sold_at DESC
  `;
  const sales: SalesReportRow[] = rows.map((row) => ({
    itemId: String(row.item_id),
    sku: String(row.sku),
    title: String(row.title ?? ""),
    publishedPriceGtq: normalizePriceText(row.published_price_gtq),
    chargedPriceGtq: normalizePriceText(row.charged_price_gtq),
    soldAt: isoTimestamp(row.sold_at),
    isTest: row.is_test === true || row.is_test === "t" || row.is_test === "true",
    costGtq: optionalCostText(row.cost_gtq),
    costIncludesPhotography: optionalCostText(row.cost_gtq) != null && flag(row.cost_includes_photography),
    cover:
      row.photo_id && row.data
        ? { id: String(row.photo_id), mediaType: String(row.media_type), data: String(row.data) }
        : null,
  }));
  const cents = sales.reduce((sum, sale) => {
    const [whole, fraction] = sale.chargedPriceGtq.split(".");
    return sum + Number(whole) * 100 + Number((fraction ?? "00").slice(0, 2));
  }, 0);
  const expenses = await listGuatemalaExpenses({
    clientId: input.clientId,
    from: built.range.from,
    to: built.range.to,
  });
  const profit = summarizeGuatemalaProfit({
    includeTests: input.includeTests,
    expenses,
    garments: sales.map((sale) => ({
      itemId: sale.itemId,
      soldInPeriod: true,
      isTest: sale.isTest,
      voided: false,
      chargedPriceGtq: sale.chargedPriceGtq,
      costGtq: sale.costGtq,
      costIncludesPhotography: sale.costIncludesPhotography,
    })),
  });
  return {
    ok: true,
    timezone: GUATEMALA_MARKET.timezone,
    period,
    from: built.range.from,
    to: built.range.to,
    fromLabel: built.range.fromLabel,
    toLabel: built.range.toLabel,
    includeTests: input.includeTests,
    count: sales.length,
    totalChargedGtq: `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`,
    sales,
    profit,
  };
}

export async function listGuatemalaSaleReferences(clientId: string): Promise<
  {
    sku: string;
    title: string;
    brand: string;
    size: string;
    condition: string;
    priceGtq: number;
    soldAt: string;
  }[]
> {
  await ensureGuatemalaInventoryTables();
  await markRecordedSku3002SaleAsTest();
  await markRecordedPrueba1SaleAsTest();
  const sql = getSql();
  const rows = await sql`
    SELECT sale.sku, item.title, item.brand, item.size, item.condition,
      COALESCE(sale.current_charged_price_gtq, sale.charged_price_gtq)::text AS charged_price_gtq,
      sale.sold_at
    FROM guatemala_inventory_sales AS sale
    INNER JOIN guatemala_inventory_items AS item
      ON item.id = sale.item_id AND item.client_id = sale.client_id
    WHERE sale.client_id = ${clientId}
      AND sale.voided_at IS NULL
      AND sale.is_test = FALSE
    ORDER BY sale.sold_at DESC
    LIMIT 400
  `;
  return rows.flatMap((row) => {
    const priceGtq = Number(normalizePriceText(row.charged_price_gtq));
    if (!Number.isFinite(priceGtq) || priceGtq <= 0) return [];
    return [
      {
        sku: String(row.sku ?? ""),
        title: String(row.title ?? ""),
        brand: String(row.brand ?? ""),
        size: String(row.size ?? ""),
        condition: String(row.condition ?? ""),
        priceGtq,
        soldAt: isoTimestamp(row.sold_at),
      },
    ];
  });
}

export async function listPublicGuatemalaCatalog(
  filters: CatalogFilters
): Promise<
  { ok: true; items: PublicCatalogCard[]; facets: PublicCatalogFacets } | { ok: false; status: 404; error: string }
> {
  const clientId = await readyPublicCatalogClient();
  if (!clientId) return { ok: false, status: 404, error: GUATEMALA_CATALOG_MESSAGES.unavailable };
  const sql = getSql();
  const rows = await sql`
    SELECT item.id, item.sku, item.title, item.brand, item.size, item.condition, item.price_gtq::text AS price_gtq,
      photo.id AS photo_id, photo.media_type
    FROM guatemala_inventory_items AS item
    LEFT JOIN LATERAL (
      SELECT id, media_type
      FROM guatemala_inventory_photos
      WHERE item_id = item.id
        AND media_type ~ '^image/(jpeg|png|webp)$'
      ORDER BY position ASC
      LIMIT 1
    ) AS photo ON TRUE
    WHERE item.client_id = ${clientId}
      AND item.status = ${GUATEMALA_INVENTORY_STATUS}
      AND NOT EXISTS (
        SELECT 1
        FROM guatemala_inventory_sales AS sale
        WHERE sale.item_id = item.id
          AND sale.client_id = item.client_id
          AND (sale.is_test = TRUE OR sale.voided_at IS NULL)
      )
    ORDER BY item.created_at DESC
  `;
  const sources = rows.map((row) => publicSource(clientId, row));
  return {
    ok: true,
    items: publicCatalogCards(sources, clientId, filters),
    facets: publicCatalogFacets(sources, clientId),
  };
}

export async function readPublicGuatemalaCatalogItem(
  itemId: string
): Promise<{ ok: true; item: PublicCatalogDetail } | { ok: false; status: 404; error: string }> {
  const clientId = await readyPublicCatalogClient();
  if (!clientId) return { ok: false, status: 404, error: GUATEMALA_CATALOG_MESSAGES.unavailable };
  const sql = getSql();
  const rows = await sql`
    SELECT item.id, item.sku, item.title, item.description, item.brand, item.size, item.condition,
      item.price_gtq::text AS price_gtq
    FROM guatemala_inventory_items AS item
    WHERE item.id = ${itemId}
      AND item.client_id = ${clientId}
      AND item.status = ${GUATEMALA_INVENTORY_STATUS}
      AND NOT EXISTS (
        SELECT 1
        FROM guatemala_inventory_sales AS sale
        WHERE sale.item_id = item.id
          AND sale.client_id = item.client_id
          AND (sale.is_test = TRUE OR sale.voided_at IS NULL)
      )
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { ok: false, status: 404, error: GUATEMALA_CATALOG_MESSAGES.notFound };
  const photos = await photoIdsFor(String(row.id));
  return { ok: true, item: publicCatalogDetailView(publicSource(clientId, row, photos)) };
}

export async function readPublicCatalogPhoto(
  photoId: string
): Promise<{ ok: true; mediaType: string; data: string } | { ok: false; status: 404; error: string }> {
  const clientId = await readyPublicCatalogClient();
  if (!clientId) return { ok: false, status: 404, error: GUATEMALA_CATALOG_MESSAGES.unavailable };
  const sql = getSql();
  const rows = await sql`
    SELECT photo.media_type, photo.data
    FROM guatemala_inventory_photos AS photo
    INNER JOIN guatemala_inventory_items AS item ON item.id = photo.item_id
    WHERE photo.id = ${photoId}
      AND item.client_id = ${clientId}
      AND item.status = ${GUATEMALA_INVENTORY_STATUS}
      AND NOT EXISTS (
        SELECT 1
        FROM guatemala_inventory_sales AS sale
        WHERE sale.item_id = item.id
          AND sale.client_id = item.client_id
          AND (sale.is_test = TRUE OR sale.voided_at IS NULL)
      )
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.data) return { ok: false, status: 404, error: GUATEMALA_CATALOG_MESSAGES.notFound };
  const mediaType = String(row.media_type || "");
  if (!/^image\/(jpeg|png|webp)$/.test(mediaType)) {
    return { ok: false, status: 404, error: GUATEMALA_CATALOG_MESSAGES.notFound };
  }
  return { ok: true, mediaType, data: String(row.data) };
}

function publicSource(
  clientId: string,
  row: Record<string, unknown>,
  photos: { id: string; mediaType: string }[] = []
): CatalogSourceItem {
  const cover =
    !photos.length && row.photo_id
      ? [{ id: String(row.photo_id), mediaType: String(row.media_type ?? "image/jpeg") }]
      : photos;
  return {
    id: String(row.id),
    clientId,
    sku: String(row.sku),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    brand: String(row.brand ?? ""),
    size: String(row.size ?? ""),
    condition: String(row.condition ?? ""),
    priceGtq: normalizePriceText(row.price_gtq),
    status: "disponible",
    photos: cover.map((photo) => ({ ...photo, data: "" })),
    sales: [],
  };
}

async function photoIdsFor(itemId: string): Promise<{ id: string; mediaType: string }[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, media_type
    FROM guatemala_inventory_photos
    WHERE item_id = ${itemId}
      AND media_type ~ '^image/(jpeg|png|webp)$'
    ORDER BY position ASC
  `;
  return rows.map((row) => ({ id: String(row.id), mediaType: String(row.media_type) }));
}

async function readyPublicCatalogClient(): Promise<string | null> {
  await ensureGuatemalaInventoryTables();
  const clientId = await boundGuatemalaClientId();
  if (!clientId || !(await clientIsGuatemala(clientId))) return null;
  return clientId;
}

function purgeFlag(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

export async function listGuatemalaPurgePlan(clientId: string): Promise<
  { ok: true; garments: PurgeGarment[] } | { ok: false; status: 403; error: string }
> {
  await ensureGuatemalaInventoryTables();
  if (!(await clientIsGuatemala(clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  return { ok: true, garments: await purgeGarmentsFor(clientId, null) };
}

export async function confirmGuatemalaPurge(input: {
  clientId: string;
  itemIds: string[];
  confirmText: string;
  expected: PurgeCounts;
}): Promise<
  | { ok: true; removed: PurgeGarment[] }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string; garments?: PurgeGarment[] }
> {
  await ensureGuatemalaInventoryTables();
  if (!(await clientIsGuatemala(input.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  const wanted = [...new Set(input.itemIds.map((id) => id.trim()).filter(Boolean))];
  if (wanted.length === 0) return { ok: false, status: 400, error: GUATEMALA_PURGE_MESSAGES.empty };
  const garments = await purgeGarmentsFor(input.clientId, wanted);
  if (garments.length !== wanted.length) {
    return { ok: false, status: 404, error: GUATEMALA_PURGE_MESSAGES.notFound };
  }
  if (input.confirmText !== purgeConfirmText(garments)) {
    return { ok: false, status: 400, error: GUATEMALA_PURGE_MESSAGES.confirm };
  }
  const counts = purgeCounts(garments);
  if (!samePurgeCounts(counts, input.expected)) {
    return { ok: false, status: 409, error: GUATEMALA_PURGE_MESSAGES.stale, garments };
  }
  const sql = getSql();
  const removed = await sql`
    WITH chosen AS (
      SELECT id
      FROM guatemala_inventory_items
      WHERE client_id = ${input.clientId}
        AND id = ANY(${wanted})
    ),
    counts AS (
      SELECT
        (SELECT COUNT(*)::int FROM chosen) AS garments,
        (SELECT COUNT(*)::int FROM guatemala_inventory_photos AS photo WHERE photo.item_id IN (SELECT id FROM chosen)) AS photos,
        (SELECT COUNT(*)::int FROM guatemala_inventory_sales AS sale WHERE sale.client_id = ${input.clientId} AND sale.item_id IN (SELECT id FROM chosen)) AS sales,
        (SELECT COUNT(*)::int FROM guatemala_sale_corrections AS correction WHERE correction.client_id = ${input.clientId} AND correction.item_id IN (SELECT id FROM chosen)) AS corrections
    ),
    gate AS (
      SELECT 1
      FROM counts
      WHERE garments = ${counts.garments}
        AND photos = ${counts.photos}
        AND sales = ${counts.sales}
        AND corrections = ${counts.corrections}
    ),
    removed_corrections AS (
      DELETE FROM guatemala_sale_corrections AS correction
      WHERE correction.client_id = ${input.clientId}
        AND correction.item_id IN (SELECT id FROM chosen)
        AND EXISTS (SELECT 1 FROM gate)
      RETURNING correction.id
    ),
    removed_sales AS (
      DELETE FROM guatemala_inventory_sales AS sale
      WHERE sale.client_id = ${input.clientId}
        AND sale.item_id IN (SELECT id FROM chosen)
        AND EXISTS (SELECT 1 FROM gate)
      RETURNING sale.id
    ),
    removed_photos AS (
      DELETE FROM guatemala_inventory_photos AS photo
      WHERE photo.item_id IN (SELECT id FROM chosen)
        AND EXISTS (SELECT 1 FROM gate)
      RETURNING photo.id
    ),
    removed_items AS (
      DELETE FROM guatemala_inventory_items AS item
      WHERE item.client_id = ${input.clientId}
        AND item.id IN (SELECT id FROM chosen)
        AND EXISTS (SELECT 1 FROM gate)
      RETURNING item.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM removed_items) AS garments,
      (SELECT COUNT(*)::int FROM removed_photos) AS photos,
      (SELECT COUNT(*)::int FROM removed_sales) AS sales,
      (SELECT COUNT(*)::int FROM removed_corrections) AS corrections
  `;
  const deleted = removed[0];
  if (!deleted || !samePurgeCounts(counts, {
    garments: Number(deleted.garments ?? 0),
    photos: Number(deleted.photos ?? 0),
    sales: Number(deleted.sales ?? 0),
    corrections: Number(deleted.corrections ?? 0),
  })) {
    return {
      ok: false,
      status: 409,
      error: GUATEMALA_PURGE_MESSAGES.stale,
      garments: await purgeGarmentsFor(input.clientId, wanted),
    };
  }
  return { ok: true, removed: garments };
}

async function purgeGarmentsFor(clientId: string, itemIds: string[] | null): Promise<PurgeGarment[]> {
  const sql = getSql();
  const items = itemIds
    ? await sql`
        SELECT id, sku, title, status, price_gtq::text AS price_gtq
        FROM guatemala_inventory_items
        WHERE client_id = ${clientId}
          AND id = ANY(${itemIds})
        ORDER BY sku
      `
    : await sql`
        SELECT id, sku, title, status, price_gtq::text AS price_gtq
        FROM guatemala_inventory_items
        WHERE client_id = ${clientId}
        ORDER BY sku
      `;
  if (items.length === 0) return [];
  const ids = items.map((item) => String(item.id));
  const photos = await sql`
    SELECT id, item_id, position
    FROM guatemala_inventory_photos
    WHERE item_id = ANY(${ids})
    ORDER BY item_id, position
  `;
  const sales = await sql`
    SELECT id, item_id, sku, published_price_gtq::text AS published_price_gtq,
      charged_price_gtq::text AS charged_price_gtq,
      current_charged_price_gtq::text AS current_charged_price_gtq,
      sold_at, is_test, voided_at, sold_by_role, sold_by_username
    FROM guatemala_inventory_sales
    WHERE client_id = ${clientId}
      AND item_id = ANY(${ids})
    ORDER BY sold_at
  `;
  const corrections = await sql`
    SELECT id, sale_id, item_id, action, previous_charged_price_gtq::text AS previous_charged_price_gtq,
      new_charged_price_gtq::text AS new_charged_price_gtq, reason, created_at, actor_role
    FROM guatemala_sale_corrections
    WHERE client_id = ${clientId}
      AND item_id = ANY(${ids})
    ORDER BY created_at
  `;
  return items.map((item) => {
    const itemId = String(item.id);
    const itemSales: PurgeSale[] = sales
      .filter((sale) => String(sale.item_id) === itemId)
      .map((sale) => ({
        id: String(sale.id),
        sku: String(sale.sku),
        publishedPriceGtq: normalizePriceText(sale.published_price_gtq),
        chargedPriceGtq: normalizePriceText(sale.charged_price_gtq),
        currentChargedPriceGtq: sale.current_charged_price_gtq
          ? normalizePriceText(sale.current_charged_price_gtq)
          : null,
        soldAt: isoTimestamp(sale.sold_at),
        isTest: purgeFlag(sale.is_test),
        voidedAt: sale.voided_at ? isoTimestamp(sale.voided_at) : null,
        soldByRole: sale.sold_by_role === "encargado" || sale.sold_by_role === "propietario" ? sale.sold_by_role : null,
        soldByUsername: sale.sold_by_username ? String(sale.sold_by_username) : null,
      }));
    const itemPhotos: PurgePhoto[] = photos
      .filter((photo) => String(photo.item_id) === itemId)
      .map((photo) => ({ id: String(photo.id), position: Number(photo.position) }));
    const itemCorrections: PurgeCorrection[] = corrections
      .filter((correction) => String(correction.item_id) === itemId)
      .map((correction) => ({
        id: String(correction.id),
        saleId: String(correction.sale_id),
        action: correction.action === "anular" ? "anular" : "corregir",
        previousChargedPriceGtq: normalizePriceText(correction.previous_charged_price_gtq),
        newChargedPriceGtq: correction.new_charged_price_gtq
          ? normalizePriceText(correction.new_charged_price_gtq)
          : null,
        reason: String(correction.reason ?? ""),
        createdAt: isoTimestamp(correction.created_at),
        actorRole: "propietario",
      }));
    return {
      id: itemId,
      clientId,
      sku: String(item.sku),
      title: String(item.title ?? ""),
      status: item.status === "vendida" ? "vendida" : item.status === "retirada" ? "retirada" : "disponible",
      priceGtq: normalizePriceText(item.price_gtq),
      suggested: itemSales.some((sale) => sale.isTest),
      photos: itemPhotos,
      sales: itemSales,
      corrections: itemCorrections,
    };
  });
}
