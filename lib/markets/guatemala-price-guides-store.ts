import { randomUUID } from "crypto";
import { getSql } from "@/lib/db";
import { preparePriceGuide, type StorePriceGuide } from "@/lib/markets/guatemala-price-match";

export interface StoredPriceGuide extends StorePriceGuide {
  id: string;
}

let ensuring: Promise<void> | null = null;

function ensureTables(): Promise<void> {
  if (!ensuring) {
    ensuring = createTables().catch((error) => {
      ensuring = null;
      throw error;
    });
  }
  return ensuring;
}

async function createTables(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_price_guides (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      brand TEXT NOT NULL,
      garment TEXT NOT NULL,
      condition TEXT NOT NULL,
      price_gtq NUMERIC(12, 2) CHECK (price_gtq > 0),
      comparable_brands TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE guatemala_price_guides ADD COLUMN IF NOT EXISTS adjustment_gtq NUMERIC(12, 2)`;
  await sql`ALTER TABLE guatemala_price_guides ADD COLUMN IF NOT EXISTS scope TEXT`;
  await sql`ALTER TABLE guatemala_price_guides ALTER COLUMN price_gtq DROP NOT NULL`;
  await sql`
    UPDATE guatemala_price_guides
    SET scope = CASE WHEN btrim(brand) = '' THEN 'general' ELSE 'brand' END
    WHERE scope IS NULL
  `;
  await sql`ALTER TABLE guatemala_price_guides ALTER COLUMN scope SET DEFAULT 'general'`;
  await sql`ALTER TABLE guatemala_price_guides ALTER COLUMN scope SET NOT NULL`;
}

export async function listGuatemalaPriceGuides(clientId: string): Promise<StoredPriceGuide[]> {
  await ensureTables();
  const sql = getSql();
  const rows = await sql`
    SELECT id, scope, brand, garment, condition, price_gtq::text AS price_gtq,
      adjustment_gtq::text AS adjustment_gtq, comparable_brands
    FROM guatemala_price_guides
    WHERE client_id = ${clientId}
    ORDER BY brand, garment, condition
  `;
  return rows.map(rowToGuide);
}

export async function saveGuatemalaPriceGuide(
  clientId: string,
  input: {
    scope?: unknown;
    brand?: unknown;
    garment: unknown;
    condition: unknown;
    priceGtq?: unknown;
    adjustmentGtq?: unknown;
    comparableBrands?: unknown;
  }
): Promise<{ ok: true; guide: StoredPriceGuide } | { ok: false; error: string }> {
  const prepared = preparePriceGuide(input);
  if (!prepared.ok) return prepared;
  await ensureTables();
  const sql = getSql();
  const id = randomUUID();
  const comparable = prepared.guide.comparableBrands.join(", ");
  await sql`
    DELETE FROM guatemala_price_guides
    WHERE client_id = ${clientId}
      AND scope = ${prepared.guide.scope}
      AND lower(brand) = lower(${prepared.guide.brand})
      AND garment = ${prepared.guide.garment}
      AND condition = ${prepared.guide.condition}
  `;
  await sql`
    INSERT INTO guatemala_price_guides (
      id, client_id, scope, brand, garment, condition, price_gtq, adjustment_gtq, comparable_brands
    )
    VALUES (
      ${id},
      ${clientId},
      ${prepared.guide.scope},
      ${prepared.guide.brand},
      ${prepared.guide.garment},
      ${prepared.guide.condition},
      ${prepared.guide.priceGtq},
      ${prepared.guide.adjustmentGtq},
      ${comparable}
    )
  `;
  return { ok: true, guide: { id, ...prepared.guide } };
}

export async function deleteGuatemalaPriceGuide(
  clientId: string,
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "Falta la regla." };
  await ensureTables();
  const sql = getSql();
  const rows = await sql`
    DELETE FROM guatemala_price_guides
    WHERE client_id = ${clientId} AND id = ${id}
    RETURNING id
  `;
  if (!rows[0]) return { ok: false, error: "No encontré esa regla." };
  return { ok: true };
}

function rowToGuide(row: Record<string, unknown>): StoredPriceGuide {
  const prepared = preparePriceGuide({
    scope: row.scope === "brand" ? "brand" : "general",
    brand: row.brand,
    garment: row.garment,
    condition: row.condition,
    priceGtq: row.price_gtq,
    adjustmentGtq: row.adjustment_gtq,
    comparableBrands: row.comparable_brands,
  });
  return {
    id: String(row.id),
    ...(prepared.ok
      ? prepared.guide
      : {
          scope: row.scope === "brand" ? "brand" : "general",
          brand: String(row.brand ?? ""),
          garment: String(row.garment ?? ""),
          condition: row.condition === "usado" ? "usado" : "nuevo",
          priceGtq: null,
          adjustmentGtq: null,
          comparableBrands: [],
        }),
  };
}
