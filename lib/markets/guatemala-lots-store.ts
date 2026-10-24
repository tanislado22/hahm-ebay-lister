import { getSql } from "@/lib/db";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import { ensureGuatemalaExpenseTables } from "@/lib/markets/guatemala-expenses-store";
import { GUATEMALA_INVENTORY_MESSAGES, type SaleActor } from "@/lib/markets/guatemala-inventory";
import {
  activeLotTotalGtq,
  addLotExpenseOnce,
  assignItemToLot,
  correctLotExpense,
  GUATEMALA_LOT_MESSAGES,
  lotArticleCounts,
  lotAverageCost,
  nextLotNumber,
  nextLotSku,
  prepareLotExpense,
  preparePurchaseLot,
  voidLotExpense,
  type LotExpenseCategory,
  type LotExpenseRecord,
  type LotRecordStatus,
} from "@/lib/markets/guatemala-lots";

let ensuring: Promise<void> | null = null;

export function ensureGuatemalaLotTables(): Promise<void> {
  if (!ensuring) {
    ensuring = createGuatemalaLotTables().catch((error) => {
      ensuring = null;
      throw error;
    });
  }
  return ensuring;
}

async function createGuatemalaLotTables(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_purchase_lots (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      lot_number INTEGER NOT NULL CHECK (lot_number > 0),
      name TEXT NOT NULL,
      received_on DATE NOT NULL,
      supplier TEXT NOT NULL DEFAULT '',
      weight_text TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      sellable_count INTEGER,
      status TEXT NOT NULL DEFAULT 'activo',
      created_by_role TEXT,
      created_by_account_id TEXT,
      created_by_username TEXT,
      updated_by_role TEXT,
      updated_by_account_id TEXT,
      updated_by_username TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (client_id, lot_number)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_purchase_lot_revisions (
      id TEXT PRIMARY KEY,
      lot_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      previous_name TEXT NOT NULL,
      previous_received_on DATE NOT NULL,
      previous_supplier TEXT NOT NULL,
      previous_weight_text TEXT NOT NULL,
      previous_notes TEXT NOT NULL,
      previous_sellable_count INTEGER,
      previous_status TEXT NOT NULL,
      changed_by_role TEXT,
      changed_by_account_id TEXT,
      changed_by_username TEXT,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_lot_expenses (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      lot_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      spent_on DATE NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_gtq NUMERIC(12, 2) NOT NULL CHECK (amount_gtq > 0),
      payee TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'activo',
      created_by_role TEXT,
      created_by_account_id TEXT,
      created_by_username TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (client_id, request_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_lot_expense_revisions (
      id TEXT PRIMARY KEY,
      expense_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      previous_spent_on DATE NOT NULL,
      previous_category TEXT NOT NULL,
      previous_description TEXT NOT NULL,
      previous_amount_gtq NUMERIC(12, 2) NOT NULL,
      previous_payee TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      changed_by_role TEXT,
      changed_by_account_id TEXT,
      changed_by_username TEXT,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE guatemala_inventory_items
    ADD COLUMN IF NOT EXISTS lot_id TEXT
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS guatemala_inventory_items_lot_idx
    ON guatemala_inventory_items (client_id, lot_id)
  `;
}

export interface PurchaseLotView {
  id: string;
  clientId: string;
  lotNumber: number;
  name: string;
  receivedOn: string;
  supplier: string;
  weightText: string;
  notes: string;
  sellableCount: number | null;
  status: LotRecordStatus;
  totalGtq: string;
  averageLabel: string;
  averageGtq: string | null;
  registeredCount: number;
  availableCount: number;
  soldCount: number;
  createdByUsername: string | null;
  updatedByUsername: string | null;
  expenses: {
    id: string;
    spentOn: string;
    category: string;
    description: string;
    amountGtq: string;
    payee: string;
    status: LotRecordStatus;
    createdByUsername: string | null;
  }[];
}

function amountText(value: unknown): string {
  const text = String(value ?? "");
  const match = /^(\d+)\.(\d+)$/.exec(text);
  if (!match) return text;
  return `${match[1]}.${match[2].slice(0, 2).padEnd(2, "0")}`;
}

function civilDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${value.getUTCFullYear()}-${month}-${day}`;
  }
  return /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? ""))?.[1] ?? "";
}

function actorFrom(role: unknown, accountId: unknown, username: unknown): SaleActor | null {
  if (role !== "encargado" && role !== "propietario") return null;
  return {
    role,
    accountId: accountId ? String(accountId) : null,
    username: username ? String(username) : null,
  };
}

async function loadLotBook(clientId: string): Promise<{
  lots: PurchaseLotView[];
  expenses: LotExpenseRecord[];
}> {
  const sql = getSql();
  const lotRows = await sql`
    SELECT id, client_id, lot_number, name, received_on, supplier, weight_text, notes,
      sellable_count, status, created_by_username, updated_by_username
    FROM guatemala_purchase_lots
    WHERE client_id = ${clientId}
    ORDER BY lot_number ASC
  `;
  const expenseRows = await sql`
    SELECT id, lot_id, request_id, spent_on, category, description,
      amount_gtq::text AS amount_gtq, payee, status,
      created_by_role, created_by_account_id, created_by_username
    FROM guatemala_lot_expenses
    WHERE client_id = ${clientId}
    ORDER BY created_at ASC
  `;
  const countRows = await sql`
    SELECT lot_id, status, COUNT(*)::int AS copies
    FROM guatemala_inventory_items
    WHERE client_id = ${clientId} AND lot_id IS NOT NULL
    GROUP BY lot_id, status
  `;
  const expenses: LotExpenseRecord[] = expenseRows.map((row) => ({
    id: String(row.id),
    lotId: String(row.lot_id),
    requestId: String(row.request_id),
    spentOn: civilDate(row.spent_on),
    category: String(row.category) as LotExpenseCategory,
    description: String(row.description ?? ""),
    amountGtq: amountText(row.amount_gtq),
    payee: String(row.payee ?? ""),
    status: row.status === "anulado" ? "anulado" : "activo",
    createdBy: actorFrom(row.created_by_role, row.created_by_account_id, row.created_by_username),
  }));
  const items = countRows.flatMap((row) =>
    Array.from({ length: Number(row.copies) || 0 }, () => ({
      lotId: String(row.lot_id),
      status: String(row.status),
    }))
  );
  const lots = lotRows.map((row) => {
    const id = String(row.id);
    const ownExpenses = expenses.filter((expense) => expense.lotId === id);
    const sellableCount = row.sellable_count == null ? null : Number(row.sellable_count);
    const totalGtq = activeLotTotalGtq(ownExpenses);
    const average = lotAverageCost(totalGtq, sellableCount);
    const counts = lotArticleCounts(items, id);
    return {
      id,
      clientId: String(row.client_id),
      lotNumber: Number(row.lot_number),
      name: String(row.name),
      receivedOn: civilDate(row.received_on),
      supplier: String(row.supplier ?? ""),
      weightText: String(row.weight_text ?? ""),
      notes: String(row.notes ?? ""),
      sellableCount,
      status: row.status === "anulado" ? "anulado" as const : "activo" as const,
      totalGtq,
      averageLabel: average.label,
      averageGtq: average.averageGtq,
      registeredCount: counts.registered,
      availableCount: counts.available,
      soldCount: counts.sold,
      createdByUsername: row.created_by_username ? String(row.created_by_username) : null,
      updatedByUsername: row.updated_by_username ? String(row.updated_by_username) : null,
      expenses: ownExpenses.map((expense) => ({
        id: expense.id,
        spentOn: expense.spentOn,
        category: expense.category,
        description: expense.description,
        amountGtq: expense.amountGtq,
        payee: expense.payee,
        status: expense.status,
        createdByUsername: expense.createdBy?.username ?? null,
      })),
    };
  });
  return { lots, expenses };
}

export async function listGuatemalaPurchaseLots(clientId: string): Promise<
  { ok: true; lots: PurchaseLotView[] } | { ok: false; status: 403; error: string }
> {
  if (!(await clientIsGuatemala(clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  await ensureGuatemalaLotTables();
  const book = await loadLotBook(clientId);
  return { ok: true, lots: book.lots };
}

export async function createGuatemalaPurchaseLot(input: {
  clientId: string;
  actor: SaleActor;
  lotNumber?: unknown;
  name?: unknown;
  receivedOn?: unknown;
  supplier?: unknown;
  weight?: unknown;
  notes?: unknown;
  sellableCount?: unknown;
}): Promise<{ ok: true; lot: PurchaseLotView } | { ok: false; status: 400 | 403 | 409; error: string }> {
  const prepared = preparePurchaseLot(input);
  if (!prepared.ok) return prepared;
  if (!(await clientIsGuatemala(input.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  await ensureGuatemalaLotTables();
  const sql = getSql();
  const id = crypto.randomUUID();
  const requested = prepared.lot.lotNumber;
  const rows = await sql`
    WITH locked AS (
      SELECT pg_advisory_xact_lock(hashtext('guatemala-lot'), hashtext(${input.clientId})) AS locked
    ),
    chosen AS (
      SELECT CASE
        WHEN ${requested}::int IS NULL THEN (
          SELECT COALESCE(MAX(lot_number), 0) + 1
          FROM guatemala_purchase_lots
          WHERE client_id = ${input.clientId}
        )
        ELSE ${requested}::int
      END AS lot_number
    )
    INSERT INTO guatemala_purchase_lots (
      id, client_id, lot_number, name, received_on, supplier, weight_text, notes, sellable_count,
      created_by_role, created_by_account_id, created_by_username,
      updated_by_role, updated_by_account_id, updated_by_username
    )
    SELECT
      ${id},
      ${input.clientId},
      chosen.lot_number,
      ${prepared.lot.name},
      ${prepared.lot.receivedOn}::date,
      ${prepared.lot.supplier},
      ${prepared.lot.weightText},
      ${prepared.lot.notes},
      ${prepared.lot.sellableCount},
      ${input.actor.role},
      ${input.actor.accountId},
      ${input.actor.username},
      ${input.actor.role},
      ${input.actor.accountId},
      ${input.actor.username}
    FROM chosen, locked
    WHERE NOT EXISTS (
      SELECT 1 FROM guatemala_purchase_lots AS taken
      WHERE taken.client_id = ${input.clientId} AND taken.lot_number = chosen.lot_number
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  if (!rows[0]) return { ok: false, status: 409, error: GUATEMALA_LOT_MESSAGES.numberTaken };
  const book = await loadLotBook(input.clientId);
  const lot = book.lots.find((entry) => entry.id === id);
  if (!lot) return { ok: false, status: 409, error: GUATEMALA_LOT_MESSAGES.numberTaken };
  return { ok: true, lot };
}

export async function readGuatemalaLotSku(clientId: string, lotId: string): Promise<
  { ok: true; sku: string; lotNumber: number } | { ok: false; status: 404; error: string }
> {
  await ensureGuatemalaLotTables();
  const sql = getSql();
  const lots = await sql`
    SELECT lot_number FROM guatemala_purchase_lots
    WHERE id = ${lotId} AND client_id = ${clientId} AND status = 'activo'
    LIMIT 1
  `;
  const lotNumber = Number(lots[0]?.lot_number);
  if (!Number.isInteger(lotNumber) || lotNumber <= 0) {
    return { ok: false, status: 404, error: GUATEMALA_LOT_MESSAGES.notFound };
  }
  const rows = await sql`
    SELECT sku FROM guatemala_inventory_items
    WHERE client_id = ${clientId}
      AND sku ~ ${`^L${lotNumber}-[0-9]+$`}
  `;
  return { ok: true, lotNumber, sku: nextLotSku(lotNumber, rows.map((row) => String(row.sku))) };
}

export async function addGuatemalaLotExpense(input: {
  clientId: string;
  lotId: string;
  actor: SaleActor;
  requestId?: unknown;
  spentOn?: unknown;
  category?: unknown;
  description?: unknown;
  amount?: unknown;
  payee?: unknown;
}): Promise<{ ok: true; created: boolean; totalGtq: string; averageLabel: string } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const prepared = prepareLotExpense(input);
  if (!prepared.ok) return prepared;
  await ensureGuatemalaLotTables();
  await ensureGuatemalaExpenseTables();
  const book = await loadLotBook(input.clientId);
  const lot = book.lots.find((entry) => entry.id === input.lotId);
  if (!lot) return { ok: false, status: 404, error: GUATEMALA_LOT_MESSAGES.notFound };
  if (lot.status !== "activo") return { ok: false, status: 409, error: GUATEMALA_LOT_MESSAGES.voided };
  const record: LotExpenseRecord = {
    ...prepared.expense,
    id: crypto.randomUUID(),
    lotId: input.lotId,
    status: "activo",
    createdBy: input.actor,
  };
  const planned = addLotExpenseOnce(book.expenses.filter((expense) => expense.lotId === input.lotId), record);
  if (!planned.created) {
    const totalGtq = activeLotTotalGtq(planned.expenses);
    return {
      ok: true,
      created: false,
      totalGtq,
      averageLabel: lotAverageCost(totalGtq, lot.sellableCount).label,
    };
  }
  const sql = getSql();
  const rows = await sql`
    WITH locked AS (
      SELECT pg_advisory_xact_lock(
        hashtext('guatemala-lot-expense'),
        hashtext(${`${input.clientId}\u001f${prepared.expense.requestId}`})
      ) AS locked
    ),
    inserted AS (
      INSERT INTO guatemala_lot_expenses (
        id, client_id, lot_id, request_id, spent_on, category, description, amount_gtq, payee, status,
        created_by_role, created_by_account_id, created_by_username
      )
      SELECT
        ${record.id},
        ${input.clientId},
        ${input.lotId},
        ${prepared.expense.requestId},
        ${prepared.expense.spentOn}::date,
        ${prepared.expense.category},
        ${prepared.expense.description},
        ${prepared.expense.amountGtq}::numeric,
        ${prepared.expense.payee},
        'activo',
        ${input.actor.role},
        ${input.actor.accountId},
        ${input.actor.username}
      FROM locked
      WHERE NOT EXISTS (
        SELECT 1 FROM guatemala_lot_expenses AS taken
        WHERE taken.client_id = ${input.clientId} AND taken.request_id = ${prepared.expense.requestId}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    )
    INSERT INTO guatemala_expenses (
      id, client_id, spent_on, category, description, amount_gtq, payee,
      included_in_garment_cost, recorded_by_role, recorded_by_username, lot_expense_id
    )
    SELECT
      ${crypto.randomUUID()},
      ${input.clientId},
      ${prepared.expense.spentOn}::date,
      ${prepared.expense.category},
      ${prepared.expense.description},
      ${prepared.expense.amountGtq}::numeric,
      ${prepared.expense.payee},
      FALSE,
      ${input.actor.role},
      ${input.actor.username},
      inserted.id
    FROM inserted
    ON CONFLICT DO NOTHING
    RETURNING lot_expense_id
  `;
  const fresh = await loadLotBook(input.clientId);
  const current = fresh.lots.find((entry) => entry.id === input.lotId);
  return {
    ok: true,
    created: Boolean(rows[0]),
    totalGtq: current?.totalGtq ?? lot.totalGtq,
    averageLabel: current?.averageLabel ?? lot.averageLabel,
  };
}

export async function correctGuatemalaLotExpense(input: {
  clientId: string;
  expenseId: string;
  actor: SaleActor;
  spentOn?: unknown;
  category?: unknown;
  description?: unknown;
  amount?: unknown;
  payee?: unknown;
}): Promise<{ ok: true; totalGtq: string; averageLabel: string } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const prepared = prepareLotExpense({ ...input, requestId: "00000000-0000-4000-8000-000000000000" });
  if (!prepared.ok) return prepared;
  await ensureGuatemalaLotTables();
  const book = await loadLotBook(input.clientId);
  const corrected = correctLotExpense(
    book.expenses,
    input.expenseId,
    prepared.expense,
    input.actor
  );
  if (!corrected.ok) {
    return {
      ok: false,
      status: corrected.error === GUATEMALA_LOT_MESSAGES.expenseNotFound ? 404 : 409,
      error: corrected.error,
    };
  }
  const sql = getSql();
  const rows = await sql`
    WITH revised AS (
      INSERT INTO guatemala_lot_expense_revisions (
        id, expense_id, client_id, previous_spent_on, previous_category, previous_description,
        previous_amount_gtq, previous_payee, previous_status,
        changed_by_role, changed_by_account_id, changed_by_username
      )
      SELECT
        ${crypto.randomUUID()},
        id,
        client_id,
        spent_on,
        category,
        description,
        amount_gtq,
        payee,
        status,
        ${input.actor.role},
        ${input.actor.accountId},
        ${input.actor.username}
      FROM guatemala_lot_expenses
      WHERE id = ${input.expenseId} AND client_id = ${input.clientId} AND status = 'activo'
      RETURNING expense_id
    ),
    updated AS (
      UPDATE guatemala_lot_expenses
      SET spent_on = ${prepared.expense.spentOn}::date,
          category = ${prepared.expense.category},
          description = ${prepared.expense.description},
          amount_gtq = ${prepared.expense.amountGtq}::numeric,
          payee = ${prepared.expense.payee},
          updated_at = NOW()
      WHERE id IN (SELECT expense_id FROM revised)
      RETURNING id, lot_id
    ),
    mirrored AS (
      UPDATE guatemala_expenses
      SET spent_on = ${prepared.expense.spentOn}::date,
          category = ${prepared.expense.category},
          description = ${prepared.expense.description},
          amount_gtq = ${prepared.expense.amountGtq}::numeric,
          payee = ${prepared.expense.payee},
          updated_at = NOW()
      WHERE lot_expense_id IN (SELECT id FROM updated) AND voided_at IS NULL
      RETURNING lot_expense_id
    )
    SELECT id FROM updated
  `;
  if (!rows[0]) return { ok: false, status: 409, error: GUATEMALA_LOT_MESSAGES.expenseVoided };
  const fresh = await loadLotBook(input.clientId);
  const lotId = fresh.expenses.find((expense) => expense.id === input.expenseId)?.lotId;
  const lot = fresh.lots.find((entry) => entry.id === lotId);
  return { ok: true, totalGtq: lot?.totalGtq ?? "0.00", averageLabel: lot?.averageLabel ?? GUATEMALA_LOT_MESSAGES.notFound };
}

export async function voidGuatemalaLotExpense(input: {
  clientId: string;
  expenseId: string;
  actor: SaleActor;
}): Promise<{ ok: true; totalGtq: string; averageLabel: string } | { ok: false; status: 404 | 409; error: string }> {
  await ensureGuatemalaLotTables();
  const book = await loadLotBook(input.clientId);
  const voided = voidLotExpense(book.expenses, input.expenseId, input.actor);
  if (!voided.ok) {
    return {
      ok: false,
      status: voided.error === GUATEMALA_LOT_MESSAGES.expenseNotFound ? 404 : 409,
      error: voided.error,
    };
  }
  const sql = getSql();
  const rows = await sql`
    WITH revised AS (
      INSERT INTO guatemala_lot_expense_revisions (
        id, expense_id, client_id, previous_spent_on, previous_category, previous_description,
        previous_amount_gtq, previous_payee, previous_status,
        changed_by_role, changed_by_account_id, changed_by_username
      )
      SELECT
        ${crypto.randomUUID()},
        id, client_id, spent_on, category, description, amount_gtq, payee, status,
        ${input.actor.role}, ${input.actor.accountId}, ${input.actor.username}
      FROM guatemala_lot_expenses
      WHERE id = ${input.expenseId} AND client_id = ${input.clientId} AND status = 'activo'
      RETURNING expense_id
    ),
    updated AS (
      UPDATE guatemala_lot_expenses
      SET status = 'anulado', updated_at = NOW()
      WHERE id IN (SELECT expense_id FROM revised)
      RETURNING id
    ),
    mirrored AS (
      UPDATE guatemala_expenses
      SET voided_at = NOW(), updated_at = NOW()
      WHERE lot_expense_id IN (SELECT id FROM updated) AND voided_at IS NULL
      RETURNING lot_expense_id
    )
    SELECT id FROM updated
  `;
  if (!rows[0]) return { ok: false, status: 409, error: GUATEMALA_LOT_MESSAGES.expenseVoided };
  const fresh = await loadLotBook(input.clientId);
  const lotId = fresh.expenses.find((expense) => expense.id === input.expenseId)?.lotId;
  const lot = fresh.lots.find((entry) => entry.id === lotId);
  return { ok: true, totalGtq: lot?.totalGtq ?? "0.00", averageLabel: lot?.averageLabel ?? "" };
}

export async function updateGuatemalaPurchaseLot(input: {
  clientId: string;
  lotId: string;
  actor: SaleActor;
  name?: unknown;
  receivedOn?: unknown;
  supplier?: unknown;
  weight?: unknown;
  notes?: unknown;
  sellableCount?: unknown;
}): Promise<{ ok: true; lot: PurchaseLotView } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const prepared = preparePurchaseLot({ ...input, lotNumber: 1 });
  if (!prepared.ok) return prepared;
  await ensureGuatemalaLotTables();
  const sql = getSql();
  const rows = await sql`
    WITH revised AS (
      INSERT INTO guatemala_purchase_lot_revisions (
        id, lot_id, client_id, previous_name, previous_received_on, previous_supplier,
        previous_weight_text, previous_notes, previous_sellable_count, previous_status,
        changed_by_role, changed_by_account_id, changed_by_username
      )
      SELECT
        ${crypto.randomUUID()}, id, client_id, name, received_on, supplier, weight_text, notes,
        sellable_count, status, ${input.actor.role}, ${input.actor.accountId}, ${input.actor.username}
      FROM guatemala_purchase_lots
      WHERE id = ${input.lotId} AND client_id = ${input.clientId} AND status = 'activo'
      RETURNING lot_id
    )
    UPDATE guatemala_purchase_lots
    SET name = ${prepared.lot.name},
        received_on = ${prepared.lot.receivedOn}::date,
        supplier = ${prepared.lot.supplier},
        weight_text = ${prepared.lot.weightText},
        notes = ${prepared.lot.notes},
        sellable_count = ${prepared.lot.sellableCount},
        updated_by_role = ${input.actor.role},
        updated_by_account_id = ${input.actor.accountId},
        updated_by_username = ${input.actor.username},
        updated_at = NOW()
    WHERE id IN (SELECT lot_id FROM revised)
    RETURNING id
  `;
  if (!rows[0]) return { ok: false, status: 404, error: GUATEMALA_LOT_MESSAGES.notFound };
  const book = await loadLotBook(input.clientId);
  const lot = book.lots.find((entry) => entry.id === input.lotId);
  if (!lot) return { ok: false, status: 404, error: GUATEMALA_LOT_MESSAGES.notFound };
  return { ok: true, lot };
}

export async function voidGuatemalaPurchaseLot(input: {
  clientId: string;
  lotId: string;
  actor: SaleActor;
}): Promise<{ ok: true } | { ok: false; status: 404 | 409; error: string }> {
  await ensureGuatemalaLotTables();
  const sql = getSql();
  const rows = await sql`
    WITH revised AS (
      INSERT INTO guatemala_purchase_lot_revisions (
        id, lot_id, client_id, previous_name, previous_received_on, previous_supplier,
        previous_weight_text, previous_notes, previous_sellable_count, previous_status,
        changed_by_role, changed_by_account_id, changed_by_username
      )
      SELECT
        ${crypto.randomUUID()}, id, client_id, name, received_on, supplier, weight_text, notes,
        sellable_count, status, ${input.actor.role}, ${input.actor.accountId}, ${input.actor.username}
      FROM guatemala_purchase_lots
      WHERE id = ${input.lotId} AND client_id = ${input.clientId} AND status = 'activo'
      RETURNING lot_id
    )
    UPDATE guatemala_purchase_lots
    SET status = 'anulado',
        updated_by_role = ${input.actor.role},
        updated_by_account_id = ${input.actor.accountId},
        updated_by_username = ${input.actor.username},
        updated_at = NOW()
    WHERE id IN (SELECT lot_id FROM revised)
    RETURNING id
  `;
  if (!rows[0]) return { ok: false, status: 404, error: GUATEMALA_LOT_MESSAGES.notFound };
  return { ok: true };
}

export async function assignGuatemalaItemLot(input: {
  clientId: string;
  itemId: string;
  lotId: string;
}): Promise<{ ok: true; sku: string; lotId: string } | { ok: false; status: 404 | 409; error: string }> {
  await ensureGuatemalaLotTables();
  const sql = getSql();
  const current = await sql`
    SELECT id, sku FROM guatemala_inventory_items
    WHERE id = ${input.itemId} AND client_id = ${input.clientId}
    LIMIT 1
  `;
  const item = current[0];
  if (!item) return { ok: false, status: 404, error: GUATEMALA_INVENTORY_MESSAGES.missingItem };
  const kept = assignItemToLot({ sku: String(item.sku) }, input.lotId);
  const rows = await sql`
    UPDATE guatemala_inventory_items AS item
    SET lot_id = ${kept.lotId}
    WHERE item.id = ${input.itemId}
      AND item.client_id = ${input.clientId}
      AND item.sku = ${kept.sku}
      AND EXISTS (
        SELECT 1 FROM guatemala_purchase_lots AS lot
        WHERE lot.id = ${kept.lotId} AND lot.client_id = item.client_id AND lot.status = 'activo'
      )
    RETURNING sku, lot_id
  `;
  const saved = rows[0];
  if (!saved) return { ok: false, status: 409, error: GUATEMALA_LOT_MESSAGES.voided };
  return { ok: true, sku: String(saved.sku), lotId: String(saved.lot_id) };
}

export async function activeGuatemalaLot(clientId: string, lotId: string): Promise<boolean> {
  await ensureGuatemalaLotTables();
  const sql = getSql();
  const rows = await sql`
    SELECT id FROM guatemala_purchase_lots
    WHERE id = ${lotId} AND client_id = ${clientId} AND status = 'activo'
    LIMIT 1
  `;
  return Boolean(rows[0]);
}

export { nextLotNumber };
