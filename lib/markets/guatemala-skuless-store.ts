import { getSql } from "@/lib/db";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import { GUATEMALA_INVENTORY_MESSAGES, type SaleActor } from "@/lib/markets/guatemala-inventory";
import { prepareSkuLessSale } from "@/lib/markets/guatemala-skuless";

let ensuring: Promise<void> | null = null;

export function ensureGuatemalaSkuLessTables(): Promise<void> {
  if (!ensuring) {
    ensuring = createSkuLessTables().catch((error) => {
      ensuring = null;
      throw error;
    });
  }
  return ensuring;
}

async function createSkuLessTables(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_skuless_sales (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      pieces INTEGER NOT NULL CHECK (pieces > 0),
      charged_price_gtq NUMERIC(12, 2) NOT NULL CHECK (charged_price_gtq > 0),
      sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sold_by_role TEXT,
      sold_by_account_id TEXT,
      sold_by_username TEXT,
      UNIQUE (client_id, request_id)
    )
  `;
}

export async function confirmSkuLessSale(input: {
  clientId: string;
  actor: SaleActor;
  requestId?: unknown;
  pieces?: unknown;
  chargedPrice?: unknown;
}): Promise<
  | { ok: true; already: boolean; chargedPriceGtq: string; pieces: number; skuLessPieces: number }
  | { ok: false; status: 400 | 403; error: string }
> {
  if (!(await clientIsGuatemala(input.clientId))) {
    return { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala };
  }
  await ensureGuatemalaSkuLessTables();
  const prepared = prepareSkuLessSale(input);
  if (!prepared.ok) return { ok: false, status: 400, error: prepared.error };
  const sql = getSql();
  const existing = await sql`
    SELECT charged_price_gtq::text AS charged_price_gtq
    FROM guatemala_skuless_sales
    WHERE client_id = ${input.clientId} AND request_id = ${prepared.sale.requestId}
    LIMIT 1
  `;
  if (existing[0]) {
    return {
      ok: true,
      already: true,
      chargedPriceGtq: money(existing[0].charged_price_gtq),
      pieces: prepared.sale.pieces,
      skuLessPieces: await skuLessPieceCount(input.clientId),
    };
  }
  try {
    await sql`
      INSERT INTO guatemala_skuless_sales (
        id, client_id, request_id, pieces, charged_price_gtq,
        sold_by_role, sold_by_account_id, sold_by_username
      )
      VALUES (
        ${crypto.randomUUID()},
        ${input.clientId},
        ${prepared.sale.requestId},
        ${prepared.sale.pieces},
        ${prepared.sale.chargedPriceGtq}::numeric,
        ${input.actor.role},
        ${input.actor.accountId},
        ${input.actor.username}
      )
    `;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: true,
        already: true,
        chargedPriceGtq: prepared.sale.chargedPriceGtq,
        pieces: prepared.sale.pieces,
        skuLessPieces: await skuLessPieceCount(input.clientId),
      };
    }
    throw error;
  }
  return {
    ok: true,
    already: false,
    chargedPriceGtq: prepared.sale.chargedPriceGtq,
    pieces: prepared.sale.pieces,
    skuLessPieces: await skuLessPieceCount(input.clientId),
  };
}

export interface SkuLessReportRow {
  id: string;
  pieces: number;
  chargedPriceGtq: string;
  soldAt: string;
}

export async function listSkuLessReportRows(clientId: string, start: Date, end: Date): Promise<SkuLessReportRow[]> {
  await ensureGuatemalaSkuLessTables();
  const sql = getSql();
  const rows = await sql`
    SELECT id, pieces, charged_price_gtq::text AS charged_price_gtq, sold_at
    FROM guatemala_skuless_sales
    WHERE client_id = ${clientId}
      AND sold_at >= ${start}
      AND sold_at < ${end}
    ORDER BY sold_at DESC
  `;
  return rows.map((row) => ({
    id: String(row.id),
    pieces: Number(row.pieces) || 0,
    chargedPriceGtq: money(row.charged_price_gtq),
    soldAt: new Date(row.sold_at as string | Date).toISOString(),
  }));
}

async function skuLessPieceCount(clientId: string): Promise<number> {
  const sql = getSql();
  const rows = await sql`
    SELECT COALESCE(SUM(pieces), 0)::int AS pieces
    FROM guatemala_skuless_sales
    WHERE client_id = ${clientId}
  `;
  return Number(rows[0]?.pieces) || 0;
}

function money(value: unknown): string {
  const match = /^(\d+)\.(\d+)$/.exec(String(value ?? ""));
  if (!match) return String(value ?? "");
  return `${match[1]}.${match[2].slice(0, 2).padEnd(2, "0")}`;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
