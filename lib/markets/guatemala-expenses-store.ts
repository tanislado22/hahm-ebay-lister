import { getSql } from "@/lib/db";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import { GUATEMALA_MARKET } from "@/lib/markets/guatemala";
import {
  buildExpenseRecord,
  deleteExpenseRecord,
  expensesInRange,
  GUATEMALA_EXPENSE_MESSAGES,
  prepareExpense,
  sumExpenseAmounts,
  updateExpenseRecord,
  type StoredExpense,
} from "@/lib/markets/guatemala-expenses";
import { GUATEMALA_INVENTORY_MESSAGES, type SaleActor } from "@/lib/markets/guatemala-inventory";
import {
  guatemalaSalesRange,
  parseSalesReportPeriod,
  type SalesReportPeriod,
} from "@/lib/markets/guatemala-sales-report";

let ensuring: Promise<void> | null = null;

export function ensureGuatemalaExpenseTables(): Promise<void> {
  if (!ensuring) {
    ensuring = createGuatemalaExpenseTables().catch((error) => {
      ensuring = null;
      throw error;
    });
  }
  return ensuring;
}

async function createGuatemalaExpenseTables(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_expenses (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      spent_on DATE NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_gtq NUMERIC(12, 2) NOT NULL CHECK (amount_gtq > 0),
      payee TEXT NOT NULL DEFAULT '',
      included_in_garment_cost BOOLEAN NOT NULL DEFAULT FALSE,
      recorded_by_role TEXT,
      recorded_by_username TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS guatemala_expenses_client_spent_idx
    ON guatemala_expenses (client_id, spent_on)
  `;
}

function flag(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

function civilDateFromDb(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${value.getUTCFullYear()}-${month}-${day}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? ""));
  return match?.[1] ?? "";
}

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? String(value ?? "") : parsed.toISOString();
}

function amountText(value: unknown): string {
  const text = String(value ?? "");
  const match = /^(\d+)\.(\d+)$/.exec(text);
  if (!match) return text;
  return `${match[1]}.${match[2].slice(0, 2).padEnd(2, "0")}`;
}

function roleOf(value: unknown): StoredExpense["recordedByRole"] {
  return value === "encargado" || value === "propietario" ? value : null;
}

function rowToExpense(row: Record<string, unknown>): StoredExpense {
  const category = String(row.category ?? "");
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    spentOn: civilDateFromDb(row.spent_on),
    category: category as StoredExpense["category"],
    description: String(row.description ?? ""),
    amountGtq: amountText(row.amount_gtq),
    payee: String(row.payee ?? ""),
    includedInGarmentCost: flag(row.included_in_garment_cost),
    recordedByRole: roleOf(row.recorded_by_role),
    recordedByUsername: row.recorded_by_username ? String(row.recorded_by_username) : null,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

async function readExpense(clientId: string, id: string): Promise<StoredExpense | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, client_id, spent_on, category, description,
      amount_gtq::text AS amount_gtq, payee, included_in_garment_cost,
      recorded_by_role, recorded_by_username, created_at, updated_at
    FROM guatemala_expenses
    WHERE id = ${id} AND client_id = ${clientId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? rowToExpense(row) : null;
}

export async function listGuatemalaExpenses(input: {
  clientId: string;
  from: string;
  to: string;
}): Promise<StoredExpense[]> {
  await ensureGuatemalaExpenseTables();
  const sql = getSql();
  const rows = await sql`
    SELECT id, client_id, spent_on, category, description,
      amount_gtq::text AS amount_gtq, payee, included_in_garment_cost,
      recorded_by_role, recorded_by_username, created_at, updated_at
    FROM guatemala_expenses
    WHERE client_id = ${input.clientId}
      AND spent_on >= ${input.from}::date
      AND spent_on <= ${input.to}::date
    ORDER BY spent_on DESC, created_at DESC
  `;
  return expensesInRange(
    rows.map((row) => rowToExpense(row)),
    input.clientId,
    input.from,
    input.to
  );
}

export async function queryGuatemalaExpenses(input: {
  clientId: string;
  period: unknown;
  from?: unknown;
  to?: unknown;
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
      totalGtq: string;
      expenses: StoredExpense[];
    }
  | { ok: false; status: 400 | 403; error: string }
> {
  const period = parseSalesReportPeriod(input.period);
  const built = guatemalaSalesRange({ period, from: input.from, to: input.to, now: input.now });
  if (!built.ok) return { ok: false, status: 400, error: built.error };
  if (!(await clientIsGuatemala(input.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  const expenses = await listGuatemalaExpenses({
    clientId: input.clientId,
    from: built.range.from,
    to: built.range.to,
  });
  return {
    ok: true,
    timezone: GUATEMALA_MARKET.timezone,
    period,
    from: built.range.from,
    to: built.range.to,
    fromLabel: built.range.fromLabel,
    toLabel: built.range.toLabel,
    totalGtq: sumExpenseAmounts(expenses),
    expenses,
  };
}

export async function createGuatemalaExpense(input: {
  clientId: string;
  actor: SaleActor;
  spentOn?: unknown;
  category?: unknown;
  description?: unknown;
  amount?: unknown;
  payee?: unknown;
  includedInGarmentCost?: unknown;
  now?: Date;
}): Promise<
  | { ok: true; expense: StoredExpense; message: string }
  | { ok: false; status: 400 | 403; error: string }
> {
  const prepared = prepareExpense(input);
  if (!prepared.ok) return prepared;
  if (!(await clientIsGuatemala(input.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  await ensureGuatemalaExpenseTables();
  const expense = buildExpenseRecord(prepared.expense, {
    id: crypto.randomUUID(),
    clientId: input.clientId,
    recordedByRole: input.actor.role,
    recordedByUsername: input.actor.username,
    now: input.now ?? new Date(),
  });
  const sql = getSql();
  await sql`
    INSERT INTO guatemala_expenses (
      id, client_id, spent_on, category, description, amount_gtq, payee,
      included_in_garment_cost, recorded_by_role, recorded_by_username, created_at, updated_at
    )
    VALUES (
      ${expense.id},
      ${expense.clientId},
      ${expense.spentOn}::date,
      ${expense.category},
      ${expense.description},
      ${expense.amountGtq}::numeric,
      ${expense.payee},
      ${expense.includedInGarmentCost},
      ${expense.recordedByRole},
      ${expense.recordedByUsername},
      ${expense.createdAt}::timestamptz,
      ${expense.updatedAt}::timestamptz
    )
  `;
  return { ok: true, expense, message: GUATEMALA_EXPENSE_MESSAGES.saved };
}

export async function updateGuatemalaExpense(input: {
  clientId: string;
  expenseId: string;
  spentOn?: unknown;
  category?: unknown;
  description?: unknown;
  amount?: unknown;
  payee?: unknown;
  includedInGarmentCost?: unknown;
  now?: Date;
}): Promise<
  | { ok: true; expense: StoredExpense; message: string }
  | { ok: false; status: 400 | 403 | 404; error: string }
> {
  const prepared = prepareExpense(input);
  if (!prepared.ok) return prepared;
  if (!(await clientIsGuatemala(input.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  await ensureGuatemalaExpenseTables();
  const existing = await readExpense(input.clientId, input.expenseId);
  const changed = updateExpenseRecord(
    existing ? [existing] : [],
    input.clientId,
    input.expenseId,
    prepared.expense,
    input.now ?? new Date()
  );
  if (!changed.ok) return changed;
  const expense = changed.expense;
  const sql = getSql();
  const rows = await sql`
    UPDATE guatemala_expenses
    SET spent_on = ${expense.spentOn}::date,
        category = ${expense.category},
        description = ${expense.description},
        amount_gtq = ${expense.amountGtq}::numeric,
        payee = ${expense.payee},
        included_in_garment_cost = ${expense.includedInGarmentCost},
        updated_at = ${expense.updatedAt}::timestamptz
    WHERE id = ${expense.id} AND client_id = ${expense.clientId}
    RETURNING id
  `;
  if (!rows[0]) return { ok: false, status: 404, error: GUATEMALA_EXPENSE_MESSAGES.notFound };
  return { ok: true, expense, message: GUATEMALA_EXPENSE_MESSAGES.updated };
}

export async function deleteGuatemalaExpense(input: {
  clientId: string;
  expenseId: string;
}): Promise<{ ok: true; message: string } | { ok: false; status: 403 | 404; error: string }> {
  if (!(await clientIsGuatemala(input.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  await ensureGuatemalaExpenseTables();
  const existing = await readExpense(input.clientId, input.expenseId);
  const removed = deleteExpenseRecord(existing ? [existing] : [], input.clientId, input.expenseId);
  if (!removed.ok) return removed;
  const sql = getSql();
  const rows = await sql`
    DELETE FROM guatemala_expenses
    WHERE id = ${input.expenseId} AND client_id = ${input.clientId}
    RETURNING id
  `;
  if (!rows[0]) return { ok: false, status: 404, error: GUATEMALA_EXPENSE_MESSAGES.notFound };
  return { ok: true, message: GUATEMALA_EXPENSE_MESSAGES.deleted };
}
