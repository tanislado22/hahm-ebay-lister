import { getSql } from "@/lib/db";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import { GUATEMALA_INVENTORY_MESSAGES, GUATEMALA_SOLD_STATUS } from "@/lib/markets/guatemala-inventory";
import type { SaleActor } from "@/lib/markets/guatemala-inventory";
import {
  checkoutReportTitle,
  groupAvailable,
  prepareQuantityCheckout,
  prepareQuantityGroup,
  QUANTITY_MESSAGES,
  type QuantityGroupState,
  type QuantityGroupView,
  type TicketItem,
} from "@/lib/markets/guatemala-quantity";
import { prepareSalePayment } from "@/lib/markets/guatemala-sale-payment";

let ensuring: Promise<void> | null = null;

export function ensureGuatemalaQuantityTables(): Promise<void> {
  if (!ensuring) {
    ensuring = createQuantityTables().catch((error) => {
      ensuring = null;
      throw error;
    });
  }
  return ensuring;
}

async function createQuantityTables(): Promise<void> {
  const inventory = await import("@/lib/markets/guatemala-inventory-store");
  await inventory.ensureGuatemalaInventoryTables();
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_quantity_groups (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      lot_id TEXT NOT NULL,
      name TEXT NOT NULL,
      initial_quantity INTEGER NOT NULL CHECK (initial_quantity > 0),
      sold_quantity INTEGER NOT NULL DEFAULT 0 CHECK (sold_quantity >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (sold_quantity <= initial_quantity)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_checkout_sales (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      charged_price_gtq NUMERIC(12, 2) NOT NULL CHECK (charged_price_gtq > 0),
      payment_method TEXT,
      cash_received_gtq NUMERIC(12, 2),
      change_gtq NUMERIC(12, 2),
      sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sold_by_role TEXT,
      sold_by_account_id TEXT,
      sold_by_username TEXT,
      UNIQUE (client_id, request_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_checkout_lines (
      id TEXT PRIMARY KEY,
      checkout_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      group_id TEXT,
      item_id TEXT,
      lot_id TEXT,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      sku TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT ''
    )
  `;
  await sql`
    ALTER TABLE guatemala_inventory_sales
    ADD COLUMN IF NOT EXISTS checkout_id TEXT
  `;
}

export async function listGuatemalaQuantityGroups(clientId: string): Promise<
  { ok: true; groups: QuantityGroupView[] } | { ok: false; status: 403; error: string }
> {
  if (!(await clientIsGuatemala(clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  await ensureGuatemalaQuantityTables();
  return { ok: true, groups: await readGroups(clientId) };
}

export async function quantitySoldByLot(clientId: string): Promise<Map<string, number>> {
  await ensureGuatemalaQuantityTables();
  const sql = getSql();
  const rows = await sql`
    SELECT lot_id, COALESCE(SUM(sold_quantity), 0)::int AS sold
    FROM guatemala_quantity_groups
    WHERE client_id = ${clientId}
    GROUP BY lot_id
  `;
  return new Map(rows.map((row) => [String(row.lot_id), Number(row.sold) || 0]));
}

export async function createGuatemalaQuantityGroup(input: {
  clientId: string;
  actor: SaleActor;
  name?: unknown;
  lotId?: unknown;
  quantity?: unknown;
}): Promise<{ ok: true; group: QuantityGroupView } | { ok: false; status: 400 | 403; error: string }> {
  const prepared = prepareQuantityGroup(input);
  if (!prepared.ok) return { ok: false, status: 400, error: prepared.error };
  if (!(await clientIsGuatemala(input.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  await ensureGuatemalaQuantityTables();
  const sql = getSql();
  const lots = await sql`
    SELECT id, lot_number, name
    FROM guatemala_purchase_lots
    WHERE id = ${prepared.lotId} AND client_id = ${input.clientId} AND status = 'activo'
    LIMIT 1
  `;
  const lot = lots[0];
  if (!lot) return { ok: false, status: 400, error: QUANTITY_MESSAGES.lotRequired };
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO guatemala_quantity_groups (id, client_id, lot_id, name, initial_quantity, sold_quantity)
    VALUES (${id}, ${input.clientId}, ${prepared.lotId}, ${prepared.name}, ${prepared.quantity}, 0)
  `;
  return {
    ok: true,
    group: {
      id,
      name: prepared.name,
      lotId: prepared.lotId,
      lotNumber: Number(lot.lot_number),
      lotName: String(lot.name ?? ""),
      initialQuantity: prepared.quantity,
      soldQuantity: 0,
      available: prepared.quantity,
    },
  };
}

export async function confirmQuantityCheckout(input: {
  clientId: string;
  actor: SaleActor;
  requestId?: unknown;
  chargedPrice?: unknown;
  paymentMethod?: unknown;
  cashReceived?: unknown;
  pieceLines?: unknown;
  itemIds?: unknown;
}): Promise<
  | { ok: true; already: boolean; chargedPriceGtq: string; groups: QuantityGroupView[] }
  | { ok: false; status: 400 | 403 | 409; error: string }
> {
  if (!(await clientIsGuatemala(input.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  await ensureGuatemalaQuantityTables();
  const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
  const existing = requestId ? await readCheckout(input.clientId, requestId) : null;
  if (existing) {
    return { ok: true, already: true, chargedPriceGtq: existing, groups: await readGroups(input.clientId) };
  }
  const groups = await readGroupStates(input.clientId);
  const itemIds = Array.isArray(input.itemIds) ? input.itemIds : [];
  const items = await readTicketItems(input.clientId, itemIds.filter((id): id is string => typeof id === "string"));
  const pieceLines = Array.isArray(input.pieceLines) ? input.pieceLines : [];
  const prepared = prepareQuantityCheckout({
    groups,
    pieceLines: pieceLines.filter((line): line is { groupId?: unknown; quantity?: unknown } => typeof line === "object" && line != null),
    items,
    itemIds,
    chargedPrice: input.chargedPrice,
    requestId,
  });
  if (!prepared.ok) return { ok: false, status: 400, error: prepared.error };
  const payment = prepareSalePayment({
    method: input.paymentMethod,
    chargedPrice: prepared.chargedPriceGtq,
    cashReceived: input.cashReceived,
  });
  if (!payment.ok) return payment;
  const sql = getSql();
  const checkoutId = crypto.randomUUID();
  const groupsJson = JSON.stringify(prepared.pieces.map((line) => ({ group_id: line.groupId, quantity: line.quantity })));
  const itemsJson = JSON.stringify(prepared.itemIds.map((itemId) => ({ item_id: itemId })));
  try {
    const saved = await sql`
      WITH requested_groups AS (
        SELECT group_id, quantity
        FROM jsonb_to_recordset(${groupsJson}::jsonb) AS line(group_id text, quantity int)
      ),
      requested_items AS (
        SELECT item_id
        FROM jsonb_to_recordset(${itemsJson}::jsonb) AS line(item_id text)
      ),
      guard AS (
        SELECT (
          (SELECT COUNT(*) FROM requested_groups) = (
            SELECT COUNT(*)
            FROM requested_groups AS wanted
            INNER JOIN guatemala_quantity_groups AS grp
              ON grp.id = wanted.group_id AND grp.client_id = ${input.clientId}
            WHERE grp.sold_quantity + wanted.quantity <= grp.initial_quantity
          )
          AND (SELECT COUNT(*) FROM requested_items) = (
            SELECT COUNT(*)
            FROM requested_items AS wanted
            INNER JOIN guatemala_inventory_items AS item
              ON item.id = wanted.item_id AND item.client_id = ${input.clientId}
            WHERE item.status = 'disponible'
          )
          AND (SELECT COUNT(*) FROM requested_groups) + (SELECT COUNT(*) FROM requested_items) > 0
        ) AS ready
      ),
      updated_groups AS (
        UPDATE guatemala_quantity_groups AS grp
        SET sold_quantity = grp.sold_quantity + wanted.quantity
        FROM requested_groups AS wanted, guard
        WHERE guard.ready
          AND grp.id = wanted.group_id
          AND grp.client_id = ${input.clientId}
        RETURNING grp.id, grp.lot_id, grp.name
      ),
      updated_items AS (
        UPDATE guatemala_inventory_items AS item
        SET status = ${GUATEMALA_SOLD_STATUS}
        FROM requested_items AS wanted, guard
        WHERE guard.ready
          AND item.id = wanted.item_id
          AND item.client_id = ${input.clientId}
          AND item.status = 'disponible'
        RETURNING item.id, item.sku, item.price_gtq, item.lot_id, item.title
      ),
      inserted AS (
        INSERT INTO guatemala_checkout_sales (
          id, client_id, request_id, charged_price_gtq, payment_method,
          cash_received_gtq, change_gtq, sold_by_role, sold_by_account_id, sold_by_username
        )
        SELECT ${checkoutId}, ${input.clientId}, ${prepared.requestId}, ${payment.payment.incomeGtq}::numeric,
          ${payment.payment.method}, ${payment.payment.cashReceivedGtq}::numeric, ${payment.payment.changeGtq}::numeric,
          ${input.actor.role}, ${input.actor.accountId}, ${input.actor.username}
        FROM guard
        WHERE guard.ready
        RETURNING id
      ),
      group_lines AS (
        INSERT INTO guatemala_checkout_lines (
          id, checkout_id, client_id, kind, group_id, lot_id, quantity, label
        )
        SELECT gen_random_uuid()::text, inserted.id, ${input.clientId}, 'cantidad',
          updated_groups.id, updated_groups.lot_id, wanted.quantity, updated_groups.name
        FROM inserted
        INNER JOIN updated_groups ON TRUE
        INNER JOIN requested_groups AS wanted ON wanted.group_id = updated_groups.id
        RETURNING id
      ),
      item_lines AS (
        INSERT INTO guatemala_checkout_lines (
          id, checkout_id, client_id, kind, item_id, lot_id, quantity, sku, label
        )
        SELECT gen_random_uuid()::text, inserted.id, ${input.clientId}, 'sku',
          updated_items.id, updated_items.lot_id, 1, updated_items.sku, updated_items.title
        FROM inserted
        INNER JOIN updated_items ON TRUE
        RETURNING id
      ),
      item_sales AS (
        INSERT INTO guatemala_inventory_sales (
          id, item_id, client_id, sku, published_price_gtq, charged_price_gtq,
          sold_by_role, sold_by_account_id, sold_by_username, payment_method,
          cash_received_gtq, change_gtq, checkout_id
        )
        SELECT gen_random_uuid()::text, updated_items.id, ${input.clientId}, updated_items.sku,
          updated_items.price_gtq, updated_items.price_gtq,
          ${input.actor.role}, ${input.actor.accountId}, ${input.actor.username},
          ${payment.payment.method}, ${payment.payment.cashReceivedGtq}::numeric, ${payment.payment.changeGtq}::numeric,
          inserted.id
        FROM inserted
        INNER JOIN updated_items ON TRUE
        RETURNING id
      )
      SELECT inserted.id
      FROM inserted
      WHERE (SELECT COUNT(*) FROM group_lines) >= 0
        AND (SELECT COUNT(*) FROM item_lines) >= 0
        AND (SELECT COUNT(*) FROM item_sales) >= 0
    `;
    if (!saved[0]) {
      const again = await readGroupStates(input.clientId);
      const retry = prepareQuantityCheckout({
        groups: again,
        pieceLines: prepared.pieces,
        items: await readTicketItems(input.clientId, prepared.itemIds),
        itemIds: prepared.itemIds,
        chargedPrice: prepared.chargedPriceGtq,
        requestId: prepared.requestId,
      });
      return { ok: false, status: 409, error: retry.ok ? QUANTITY_MESSAGES.alreadySold : retry.error };
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replay = await readCheckout(input.clientId, prepared.requestId);
      if (replay) {
        return { ok: true, already: true, chargedPriceGtq: replay, groups: await readGroups(input.clientId) };
      }
    }
    throw error;
  }
  return {
    ok: true,
    already: false,
    chargedPriceGtq: payment.payment.incomeGtq,
    groups: await readGroups(input.clientId),
  };
}

export interface CheckoutReportRow {
  id: string;
  title: string;
  chargedPriceGtq: string;
  soldAt: string;
}

export async function listCheckoutReportRows(clientId: string, start: Date, end: Date): Promise<CheckoutReportRow[]> {
  await ensureGuatemalaQuantityTables();
  const sql = getSql();
  const rows = await sql`
    SELECT sale.id, sale.charged_price_gtq::text AS charged_price_gtq, sale.sold_at,
      line.kind, line.quantity, line.sku, line.label, lot.lot_number
    FROM guatemala_checkout_sales AS sale
    LEFT JOIN guatemala_checkout_lines AS line
      ON line.checkout_id = sale.id AND line.client_id = sale.client_id
    LEFT JOIN guatemala_purchase_lots AS lot
      ON lot.id = line.lot_id AND lot.client_id = sale.client_id
    WHERE sale.client_id = ${clientId}
      AND sale.sold_at >= ${start}
      AND sale.sold_at < ${end}
    ORDER BY sale.sold_at DESC
  `;
  const grouped = new Map<string, { charged: string; soldAt: string; lines: { kind: "cantidad" | "sku"; label: string; quantity: number }[] }>();
  for (const row of rows) {
    const id = String(row.id);
    const current = grouped.get(id) ?? {
      charged: money(row.charged_price_gtq),
      soldAt: new Date(String(row.sold_at)).toISOString(),
      lines: [],
    };
    if (row.kind === "cantidad" || row.kind === "sku") {
      const lotNumber = row.lot_number == null ? "" : `Lote ${Number(row.lot_number)}`;
      const name = String(row.label ?? "");
      current.lines.push({
        kind: row.kind,
        label: row.kind === "sku" ? String(row.sku ?? name) : [name, lotNumber].filter(Boolean).join(" · "),
        quantity: Number(row.quantity) || 1,
      });
    }
    grouped.set(id, current);
  }
  return [...grouped.entries()].map(([id, sale]) => ({
    id,
    title: checkoutReportTitle(sale.lines),
    chargedPriceGtq: sale.charged,
    soldAt: sale.soldAt,
  }));
}

async function readGroups(clientId: string): Promise<QuantityGroupView[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT grp.id, grp.name, grp.lot_id, grp.initial_quantity, grp.sold_quantity,
      lot.lot_number, lot.name AS lot_name
    FROM guatemala_quantity_groups AS grp
    LEFT JOIN guatemala_purchase_lots AS lot
      ON lot.id = grp.lot_id AND lot.client_id = grp.client_id
    WHERE grp.client_id = ${clientId}
    ORDER BY lot.lot_number ASC NULLS LAST, grp.created_at ASC
  `;
  return rows.map((row) => {
    const initialQuantity = Number(row.initial_quantity) || 0;
    const soldQuantity = Number(row.sold_quantity) || 0;
    return {
      id: String(row.id),
      name: String(row.name),
      lotId: String(row.lot_id),
      lotNumber: row.lot_number == null ? null : Number(row.lot_number),
      lotName: row.lot_name ? String(row.lot_name) : null,
      initialQuantity,
      soldQuantity,
      available: groupAvailable({ initialQuantity, soldQuantity }),
    };
  });
}

async function readGroupStates(clientId: string): Promise<QuantityGroupState[]> {
  const groups = await readGroups(clientId);
  return groups.map((group) => ({
    id: group.id,
    lotId: group.lotId,
    name: group.name,
    initialQuantity: group.initialQuantity,
    soldQuantity: group.soldQuantity,
  }));
}

async function readTicketItems(clientId: string, itemIds: string[]): Promise<TicketItem[]> {
  if (itemIds.length === 0) return [];
  const sql = getSql();
  const rows = await sql`
    SELECT id, sku, status, lot_id
    FROM guatemala_inventory_items
    WHERE client_id = ${clientId}
      AND id IN (SELECT item_id FROM jsonb_to_recordset(${JSON.stringify(itemIds.map((itemId) => ({ item_id: itemId })))}::jsonb) AS line(item_id text))
  `;
  return rows.map((row) => ({
    id: String(row.id),
    sku: String(row.sku ?? ""),
    status: String(row.status ?? ""),
    lotId: row.lot_id ? String(row.lot_id) : null,
  }));
}

async function readCheckout(clientId: string, requestId: string): Promise<string | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT charged_price_gtq::text AS charged_price_gtq
    FROM guatemala_checkout_sales
    WHERE client_id = ${clientId} AND request_id = ${requestId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? money(row.charged_price_gtq) : null;
}

function money(value: unknown): string {
  const match = /^(\d+)\.(\d+)$/.exec(String(value ?? ""));
  if (!match) return String(value ?? "");
  return `${match[1]}.${match[2].slice(0, 2).padEnd(2, "0")}`;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
