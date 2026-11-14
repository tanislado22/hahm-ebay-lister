import crypto from "crypto";
import { ensureInventoryTables, getSql } from "@/lib/db";
import { exactSku } from "@/lib/archive/text";
import { ebayListingId, lotForMatch, matchSaleToItem, planStoredSaleLinks, type SaleCandidate } from "@/lib/usa-lots/match";
import {
  manualMarketplaceMoney,
  marketplaceFeeLabel,
  marketplaceHasNet,
  marketplaceListingKey,
  matchMarketplaceArticle,
  planMarketplaceSale,
  type MarketplaceArticle,
  type MarketplaceExistingSale,
  type MarketplaceNotice,
  type MarketplacePlatform,
} from "@/lib/usa-lots/marketplace-sale";
import { averageUnitCents, applyAverageCosts, buildLotReport, exclusiveShare, heldPieceCount, saleProfit, type SaleMoney } from "@/lib/usa-lots/profit";
import { saleLinesToStore, type ParsedSaleLine } from "@/lib/usa-lots/parse-order";

export async function ensureUsaLots(): Promise<void> {
  await ensureInventoryTables();
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS usa_purchase_lots (
      id TEXT PRIMARY KEY,
      account_key TEXT NOT NULL,
      name TEXT NOT NULL,
      purchased_on DATE NOT NULL,
      purchase_cents INTEGER NOT NULL,
      extra_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      sellable_count INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS usa_lot_items (
      id TEXT PRIMARY KEY,
      account_key TEXT NOT NULL,
      lot_id TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      ebay_item_id TEXT NOT NULL DEFAULT '',
      archive_id TEXT NOT NULL DEFAULT '',
      source_job_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      unit_cost_cents INTEGER,
      cost_source TEXT NOT NULL DEFAULT 'estimated',
      cost_locked BOOLEAN NOT NULL DEFAULT FALSE,
      cost_estimated BOOLEAN NOT NULL DEFAULT TRUE,
      disposition TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS usa_lot_items_item_idx
    ON usa_lot_items (account_key, ebay_item_id)
    WHERE ebay_item_id <> ''
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS usa_lot_items_sku_idx
    ON usa_lot_items (account_key, sku)
    WHERE sku <> '' AND ebay_item_id = ''
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS usa_ebay_sales (
      id TEXT PRIMARY KEY,
      account_key TEXT NOT NULL,
      order_id TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      ebay_item_id TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      quantity INTEGER,
      sold_at TIMESTAMPTZ,
      item_cents INTEGER,
      buyer_shipping_cents INTEGER,
      tax_remitted_cents INTEGER,
      fee_cents INTEGER,
      seller_shipping_cents INTEGER,
      refund_cents INTEGER,
      other_cents INTEGER NOT NULL DEFAULT 0,
      unit_cost_cents INTEGER,
      cost_estimated BOOLEAN NOT NULL DEFAULT FALSE,
      cancelled BOOLEAN NOT NULL DEFAULT FALSE,
      lot_id TEXT NOT NULL DEFAULT '',
      item_ref TEXT NOT NULL DEFAULT '',
      link_status TEXT NOT NULL,
      link_locked BOOLEAN NOT NULL DEFAULT FALSE,
      allocation TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (account_key, order_id, line_item_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS usa_sale_sync (
      account_key TEXT PRIMARY KEY,
      phase TEXT NOT NULL DEFAULT 'backfill',
      cursor_end TIMESTAMPTZ,
      next_url TEXT NOT NULL DEFAULT '',
      last_success_at TIMESTAMPTZ,
      last_error TEXT NOT NULL DEFAULT '',
      fee_note TEXT NOT NULL DEFAULT '',
      fee_blocked BOOLEAN NOT NULL DEFAULT FALSE,
      last_attempt_at TIMESTAMPTZ,
      pages INTEGER NOT NULL DEFAULT 0,
      last_success_source TEXT NOT NULL DEFAULT '',
      last_saved INTEGER NOT NULL DEFAULT 0
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS usa_sale_notices (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (order_id, topic)
    )
  `;
  await sql`ALTER TABLE usa_sale_sync ADD COLUMN IF NOT EXISTS last_success_source TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE usa_sale_sync ADD COLUMN IF NOT EXISTS last_saved INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE usa_sale_notices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  await sql`ALTER TABLE usa_purchase_lots ADD COLUMN IF NOT EXISTS guatemala_piece_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE usa_purchase_lots ADD COLUMN IF NOT EXISTS guatemala_shipping_cents INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE usa_ebay_sales ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'ebay'`;
  await sql`ALTER TABLE usa_ebay_sales ADD COLUMN IF NOT EXISTS listing_url TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE usa_lot_items ADD COLUMN IF NOT EXISTS listing_url TEXT NOT NULL DEFAULT ''`;
}

function centsOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

export async function createUsaLot(input: {
  accountKey: string;
  name: string;
  purchasedOn: string;
  purchaseCents: number;
  extraCents: number;
  sellableCount: number | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Escribe el nombre del lote." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchasedOn)) return { ok: false, error: "La fecha del lote no es válida." };
  if (!Number.isInteger(input.purchaseCents) || input.purchaseCents < 0) return { ok: false, error: "El costo de compra tiene que ser un monto en USD." };
  if (!Number.isInteger(input.extraCents) || input.extraCents < 0) return { ok: false, error: "Los gastos adicionales tienen que ser un monto en USD." };
  await ensureUsaLots();
  const id = crypto.randomUUID();
  const sql = getSql();
  await sql`
    INSERT INTO usa_purchase_lots (id, account_key, name, purchased_on, purchase_cents, extra_cents, currency, sellable_count)
    VALUES (${id}, ${input.accountKey}, ${name}, ${input.purchasedOn}, ${input.purchaseCents}, ${input.extraCents}, 'USD', ${input.sellableCount})
  `;
  return { ok: true, id };
}

export async function updateUsaLot(input: {
  accountKey: string;
  lotId: string;
  name: string;
  purchasedOn: string;
  purchaseCents: number;
  extraCents: number;
  sellableCount: number | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!input.lotId.trim()) return { ok: false, error: "Ese lote no pertenece a esta cuenta." };
  if (!name) return { ok: false, error: "Escribe el nombre del lote." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchasedOn)) return { ok: false, error: "La fecha del lote no es válida." };
  if (!Number.isInteger(input.purchaseCents) || input.purchaseCents < 0) return { ok: false, error: "El costo de compra tiene que ser un monto en USD." };
  if (!Number.isInteger(input.extraCents) || input.extraCents < 0) return { ok: false, error: "Los gastos adicionales tienen que ser un monto en USD." };
  if (input.sellableCount != null && (!Number.isInteger(input.sellableCount) || input.sellableCount < 1)) {
    return { ok: false, error: "El conteo de piezas tiene que ser un número entero, o déjalo vacío si todavía está incompleto." };
  }
  await ensureUsaLots();
  const sql = getSql();
  const rows = await sql`
    UPDATE usa_purchase_lots SET
      name = ${name},
      purchased_on = ${input.purchasedOn},
      purchase_cents = ${input.purchaseCents},
      extra_cents = ${input.extraCents},
      sellable_count = ${input.sellableCount},
      updated_at = NOW()
    WHERE id = ${input.lotId} AND account_key = ${input.accountKey}
    RETURNING id
  `;
  if (!rows.length) return { ok: false, error: "Ese lote no pertenece a esta cuenta." };
  return { ok: true, id: String((rows[0] as { id: string }).id) };
}

export async function setGuatemalaReservation(input: {
  accountKey: string;
  lotId: string;
  pieces: number;
  shippingCents: number;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!Number.isInteger(input.pieces) || input.pieces < 0) {
    return { ok: false, error: "Las piezas para Guatemala tienen que ser un número entero, o cero si todavía no apartas ninguna." };
  }
  if (!Number.isInteger(input.shippingCents) || input.shippingCents < 0) {
    return { ok: false, error: "El envío a Guatemala tiene que ser un monto en USD." };
  }
  if (input.shippingCents > 0 && input.pieces < 1) {
    return { ok: false, error: "Indica cuántas piezas van a Guatemala antes de registrar el envío." };
  }
  await ensureUsaLots();
  const sql = getSql();
  const lots = await sql`
    SELECT sellable_count FROM usa_purchase_lots
    WHERE id = ${input.lotId} AND account_key = ${input.accountKey}
    LIMIT 1
  `;
  if (!lots.length) return { ok: false, error: "Ese lote no pertenece a esta cuenta." };
  const sellable = centsOrNull((lots[0] as { sellable_count?: unknown }).sellable_count);
  if (sellable != null && input.pieces > sellable) {
    return { ok: false, error: "Las piezas para Guatemala no pueden superar el total vendible del lote." };
  }
  const rows = await sql`
    UPDATE usa_purchase_lots SET
      guatemala_piece_count = ${input.pieces},
      guatemala_shipping_cents = ${input.shippingCents},
      updated_at = NOW()
    WHERE id = ${input.lotId} AND account_key = ${input.accountKey}
    RETURNING id
  `;
  if (!rows.length) return { ok: false, error: "Ese lote no pertenece a esta cuenta." };
  return { ok: true, id: String((rows[0] as { id: string }).id) };
}

export async function listUsaLots(accountKey: string): Promise<{ id: string; name: string; purchasedOn: string; purchaseCents: number; extraCents: number; sellableCount: number | null; guatemalaPieces: number; guatemalaShippingCents: number }[]> {
  await ensureUsaLots();
  const sql = getSql();
  const rows = await sql`
    SELECT id, name, purchased_on, purchase_cents, extra_cents, sellable_count, guatemala_piece_count, guatemala_shipping_cents
    FROM usa_purchase_lots
    WHERE account_key = ${accountKey}
    ORDER BY purchased_on DESC, name ASC
  `;
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id),
      name: String(record.name),
      purchasedOn: String(record.purchased_on).slice(0, 10),
      purchaseCents: Number(record.purchase_cents),
      extraCents: Number(record.extra_cents),
      sellableCount: centsOrNull(record.sellable_count),
      guatemalaPieces: centsOrNull(record.guatemala_piece_count) ?? 0,
      guatemalaShippingCents: centsOrNull(record.guatemala_shipping_cents) ?? 0,
    };
  });
}

async function findItem(accountKey: string, sku: string, ebayItemId: string): Promise<string> {
  const sql = getSql();
  if (ebayItemId) {
    const byItem = await sql`SELECT id FROM usa_lot_items WHERE account_key = ${accountKey} AND ebay_item_id = ${ebayItemId} LIMIT 1`;
    if (byItem.length) return String((byItem[0] as { id: string }).id);
  }
  if (sku) {
    const bySku = await sql`SELECT id FROM usa_lot_items WHERE account_key = ${accountKey} AND sku = ${sku} AND ebay_item_id = '' LIMIT 1`;
    if (bySku.length) return String((bySku[0] as { id: string }).id);
  }
  return "";
}

export async function assignItemsToLot(input: {
  accountKey: string;
  lotId: string;
  items: { sku: string; ebayItemId: string; archiveId: string; jobId: string; title: string }[];
}): Promise<{ ok: true; assigned: number } | { ok: false; error: string }> {
  await ensureUsaLots();
  const sql = getSql();
  const lots = await sql`SELECT id FROM usa_purchase_lots WHERE id = ${input.lotId} AND account_key = ${input.accountKey} LIMIT 1`;
  if (!lots.length) return { ok: false, error: "Ese lote no pertenece a esta cuenta." };
  let assigned = 0;
  for (const item of input.items) {
    const sku = exactSku(item.sku);
    const ebayItemId = item.ebayItemId.replace(/\D/g, "");
    if (!sku && !ebayItemId) continue;
    const existing = await findItem(input.accountKey, sku, ebayItemId);
    if (existing) {
      await sql`
        UPDATE usa_lot_items SET
          lot_id = ${input.lotId},
          sku = CASE WHEN ${sku} <> '' THEN ${sku} ELSE sku END,
          ebay_item_id = CASE WHEN ${ebayItemId} <> '' THEN ${ebayItemId} ELSE ebay_item_id END,
          archive_id = CASE WHEN ${item.archiveId} <> '' THEN ${item.archiveId} ELSE archive_id END,
          source_job_id = CASE WHEN ${item.jobId} <> '' THEN ${item.jobId} ELSE source_job_id END,
          title = CASE WHEN ${item.title} <> '' THEN ${item.title} ELSE title END,
          updated_at = NOW()
        WHERE id = ${existing} AND account_key = ${input.accountKey}
      `;
    } else {
      await sql`
        INSERT INTO usa_lot_items (
          id, account_key, lot_id, sku, ebay_item_id, archive_id, source_job_id, title, cost_source, cost_estimated
        ) VALUES (
          ${crypto.randomUUID()}, ${input.accountKey}, ${input.lotId}, ${sku}, ${ebayItemId},
          ${item.archiveId}, ${item.jobId}, ${item.title}, 'estimated', TRUE
        )
      `;
    }
    if (item.archiveId || ebayItemId) {
      await sql`
        UPDATE article_archive SET
          usa_lot_id = ${input.lotId},
          updated_at = NOW()
        WHERE account_key = ${input.accountKey}
          AND (
            (${item.archiveId} <> '' AND id = ${item.archiveId})
            OR (${ebayItemId} <> '' AND ebay_item_id = ${ebayItemId})
          )
      `;
    }
    assigned += 1;
  }
  if (assigned === 0) return { ok: false, error: "Ningún artículo tenía SKU o número de anuncio." };
  return { ok: true, assigned };
}

export async function rememberPublishedLot(input: {
  accountKey: string;
  lotId: string;
  sku: string;
  ebayItemId: string;
  title: string;
  jobId: string;
}): Promise<{ saved: true } | { saved: false; error: string }> {
  const lotId = input.lotId.trim();
  const sku = exactSku(input.sku);
  const ebayItemId = input.ebayItemId.replace(/\D/g, "");
  if (!sku && !ebayItemId) return { saved: false, error: "Faltan el SKU y el número del anuncio." };
  if (lotId) {
    return assignItemsToLot({
      accountKey: input.accountKey,
      lotId,
      items: [{ sku, ebayItemId, archiveId: "", jobId: input.jobId, title: input.title }],
    }).then((result) => (result.ok ? { saved: true } : { saved: false, error: result.error }));
  }
  await ensureUsaLots();
  const existing = await findItem(input.accountKey, sku, ebayItemId);
  if (!existing || !ebayItemId) return { saved: true };
  const sql = getSql();
  await sql`
    UPDATE usa_lot_items SET
      ebay_item_id = CASE WHEN ebay_item_id = '' THEN ${ebayItemId} ELSE ebay_item_id END,
      sku = CASE WHEN ${sku} <> '' THEN ${sku} ELSE sku END,
      updated_at = NOW()
    WHERE id = ${existing} AND account_key = ${input.accountKey}
  `;
  return { saved: true };
}

export async function rememberArchiveLot(accountKey: string, articleId: string, sku: string, ebayItemId: string): Promise<void> {
  await ensureUsaLots();
  const sql = getSql();
  const exact = exactSku(sku);
  const itemId = ebayItemId.replace(/\D/g, "");
  const rows = itemId
    ? await sql`SELECT lot_id, unit_cost_cents, cost_estimated FROM usa_lot_items WHERE account_key = ${accountKey} AND ebay_item_id = ${itemId} LIMIT 1`
    : exact
      ? await sql`SELECT lot_id, unit_cost_cents, cost_estimated FROM usa_lot_items WHERE account_key = ${accountKey} AND sku = ${exact} LIMIT 1`
      : [];
  if (!rows.length) return;
  const row = rows[0] as { lot_id?: string; unit_cost_cents?: number | null; cost_estimated?: boolean };
  await sql`
    UPDATE article_archive SET
      usa_lot_id = ${String(row.lot_id ?? "")},
      unit_cost_cents = ${centsOrNull(row.unit_cost_cents)},
      cost_estimated = ${Boolean(row.cost_estimated)},
      updated_at = NOW()
    WHERE id = ${articleId} AND account_key = ${accountKey}
  `;
}

export async function setManualItemCost(accountKey: string, itemId: string, unitCostCents: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(unitCostCents) || unitCostCents < 0) return { ok: false, error: "El costo del artículo tiene que ser un monto en USD." };
  await ensureUsaLots();
  const sql = getSql();
  const rows = await sql`
    UPDATE usa_lot_items SET
      unit_cost_cents = ${unitCostCents},
      cost_source = 'manual',
      cost_locked = TRUE,
      cost_estimated = FALSE,
      updated_at = NOW()
    WHERE id = ${itemId} AND account_key = ${accountKey}
    RETURNING id
  `;
  if (!rows.length) return { ok: false, error: "Ese artículo no está en un lote de esta cuenta." };
  return { ok: true };
}

export async function spreadAverageCost(accountKey: string, lotId: string): Promise<{ ok: true; estimated: boolean; updated: number } | { ok: false; error: string }> {
  await ensureUsaLots();
  const sql = getSql();
  const lots = await sql`SELECT purchase_cents, extra_cents, sellable_count, guatemala_piece_count, guatemala_shipping_cents FROM usa_purchase_lots WHERE id = ${lotId} AND account_key = ${accountKey} LIMIT 1`;
  if (!lots.length) return { ok: false, error: "Ese lote no pertenece a esta cuenta." };
  const lot = lots[0] as { purchase_cents: number; extra_cents: number; sellable_count: number | null; guatemala_piece_count: number | null; guatemala_shipping_cents: number | null };
  const sellable = centsOrNull(lot.sellable_count);
  const unit = averageUnitCents(Number(lot.purchase_cents), Number(lot.extra_cents), sellable);
  const items = await sql`SELECT id, cost_locked, cost_source, disposition FROM usa_lot_items WHERE account_key = ${accountKey} AND lot_id = ${lotId}`;
  const sold = await sql`SELECT item_ref FROM usa_ebay_sales WHERE account_key = ${accountKey} AND lot_id = ${lotId} AND cancelled = FALSE AND item_ref <> ''`;
  const soldIds = new Set(sold.map((row) => String((row as { item_ref: string }).item_ref)));
  const linkedTransfers = items.filter((row) => String((row as { disposition?: string }).disposition ?? "") === "guatemala-transfer").length;
  const guatemalaPieces = heldPieceCount(centsOrNull(lot.guatemala_piece_count) ?? 0, linkedTransfers);
  const shippingUnit = exclusiveShare(centsOrNull(lot.guatemala_shipping_cents) ?? 0, guatemalaPieces).unitCents ?? 0;
  const planned = applyAverageCosts(
    items.map((row) => {
      const record = row as { id: string; cost_locked: boolean; cost_source: string; disposition?: string };
      return {
        id: String(record.id),
        locked: Boolean(record.cost_locked),
        sold: soldIds.has(String(record.id)),
        source: String(record.cost_source),
        disposition: String(record.disposition ?? "") === "guatemala-transfer" ? "guatemala-transfer" as const : "" as const,
      };
    }),
    unit,
    sellable,
    unit == null ? null : unit + shippingUnit
  );
  if (planned.error) return { ok: false, error: planned.error };
  let updated = 0;
  for (const item of planned.items) {
    if (item.unitCostCents == null) continue;
    await sql`
      UPDATE usa_lot_items SET
        unit_cost_cents = ${item.unitCostCents},
        cost_source = 'average',
        cost_estimated = ${item.costEstimated},
        updated_at = NOW()
      WHERE id = ${item.id} AND account_key = ${accountKey} AND cost_locked = FALSE
    `;
    updated += 1;
  }
  return { ok: true, estimated: planned.estimated, updated };
}

export async function transferItemToGuatemala(accountKey: string, itemId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureUsaLots();
  const sql = getSql();
  const rows = await sql`
    UPDATE usa_lot_items SET disposition = 'guatemala-transfer', updated_at = NOW()
    WHERE id = ${itemId} AND account_key = ${accountKey}
    RETURNING id
  `;
  if (!rows.length) return { ok: false, error: "Ese artículo no está en un lote de esta cuenta." };
  return { ok: true };
}

export async function loadSaleCandidates(accountKey: string): Promise<SaleCandidate[]> {
  await ensureUsaLots();
  const sql = getSql();
  const lots = await sql`SELECT id, sku, ebay_item_id, lot_id, unit_cost_cents, cost_estimated FROM usa_lot_items WHERE account_key = ${accountKey}`;
  const archives = await sql`SELECT id, sku, ebay_item_id, usa_lot_id FROM article_archive WHERE account_key = ${accountKey}`;
  const fromLots = lots.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id),
      sku: exactSku(record.sku),
      ebayItemId: ebayListingId(String(record.ebay_item_id ?? "")),
      lotId: String(record.lot_id ?? ""),
      source: "lot" as const,
      unitCostCents: centsOrNull(record.unit_cost_cents),
      costEstimated: Boolean(record.cost_estimated),
    };
  });
  const lotItemIds = new Set(fromLots.map((item) => item.ebayItemId).filter(Boolean));
  const fromArchive = archives.flatMap((row) => {
    const record = row as Record<string, unknown>;
    const ebayItemId = ebayListingId(String(record.ebay_item_id ?? ""));
    if (ebayItemId && lotItemIds.has(ebayItemId)) return [];
    return [{ id: String(record.id), sku: exactSku(record.sku), ebayItemId, lotId: String(record.usa_lot_id ?? ""), source: "archive" as const }];
  });
  return [...fromLots, ...fromArchive];
}

export async function saveParsedSales(accountKey: string, lines: ParsedSaleLine[], fees: { orderId: string; feeCents: number | null; sellerShippingCents: number | null }[]): Promise<{ saved: number }> {
  await ensureUsaLots();
  const candidates = await loadSaleCandidates(accountKey);
  const sql = getSql();
  let saved = 0;
  for (const line of saleLinesToStore(lines)) {
    const match = lotForMatch(matchSaleToItem({
      ebayItemId: line.ebayItemId,
      sku: line.sku,
      variantSku: line.variantSku,
      title: line.title,
      items: candidates,
    }));
    const item = match.itemId ? candidates.find((candidate) => candidate.id === match.itemId) : undefined;
    const costRow = item && item.source === "lot"
      ? await sql`SELECT unit_cost_cents, cost_estimated FROM usa_lot_items WHERE id = ${item.id} LIMIT 1`
      : [];
    const cost = costRow[0] as { unit_cost_cents?: number | null; cost_estimated?: boolean } | undefined;
    const fee = fees.find((entry) => entry.orderId === line.orderId);
    await sql`
      INSERT INTO usa_ebay_sales (
        id, account_key, order_id, line_item_id, ebay_item_id, sku, title, quantity, sold_at,
        item_cents, buyer_shipping_cents, tax_remitted_cents, fee_cents, seller_shipping_cents, refund_cents,
        unit_cost_cents, cost_estimated, cancelled, lot_id, item_ref, link_status, allocation
      ) VALUES (
        ${crypto.randomUUID()}, ${accountKey}, ${line.orderId}, ${line.lineItemId}, ${line.ebayItemId}, ${line.sku},
        ${line.title}, ${line.quantity}, ${line.soldAt || null}, ${line.itemCents}, ${line.buyerShippingCents},
        ${line.taxRemittedCents}, ${fee?.feeCents ?? null}, ${fee?.sellerShippingCents ?? null}, ${line.refundCents},
        ${centsOrNull(cost?.unit_cost_cents)}, ${Boolean(cost?.cost_estimated)}, ${line.cancelled}, ${match.lotId},
        ${match.itemId}, ${match.linkStatus}, ${line.allocation}
      )
      ON CONFLICT (account_key, order_id, line_item_id) DO UPDATE SET
        ebay_item_id = CASE WHEN EXCLUDED.ebay_item_id <> '' THEN EXCLUDED.ebay_item_id ELSE usa_ebay_sales.ebay_item_id END,
        sku = CASE WHEN EXCLUDED.sku <> '' THEN EXCLUDED.sku ELSE usa_ebay_sales.sku END,
        title = CASE WHEN EXCLUDED.title <> '' THEN EXCLUDED.title ELSE usa_ebay_sales.title END,
        quantity = COALESCE(EXCLUDED.quantity, usa_ebay_sales.quantity),
        item_cents = COALESCE(EXCLUDED.item_cents, usa_ebay_sales.item_cents),
        buyer_shipping_cents = COALESCE(EXCLUDED.buyer_shipping_cents, usa_ebay_sales.buyer_shipping_cents),
        tax_remitted_cents = COALESCE(EXCLUDED.tax_remitted_cents, usa_ebay_sales.tax_remitted_cents),
        fee_cents = COALESCE(EXCLUDED.fee_cents, usa_ebay_sales.fee_cents),
        seller_shipping_cents = COALESCE(EXCLUDED.seller_shipping_cents, usa_ebay_sales.seller_shipping_cents),
        refund_cents = COALESCE(EXCLUDED.refund_cents, usa_ebay_sales.refund_cents),
        unit_cost_cents = COALESCE(usa_ebay_sales.unit_cost_cents, EXCLUDED.unit_cost_cents),
        cost_estimated = CASE WHEN usa_ebay_sales.unit_cost_cents IS NULL THEN EXCLUDED.cost_estimated ELSE usa_ebay_sales.cost_estimated END,
        cancelled = usa_ebay_sales.cancelled OR EXCLUDED.cancelled,
        lot_id = CASE WHEN usa_ebay_sales.link_locked THEN usa_ebay_sales.lot_id ELSE EXCLUDED.lot_id END,
        item_ref = CASE WHEN usa_ebay_sales.link_locked THEN usa_ebay_sales.item_ref ELSE EXCLUDED.item_ref END,
        link_status = CASE WHEN usa_ebay_sales.link_locked THEN usa_ebay_sales.link_status ELSE EXCLUDED.link_status END,
        updated_at = NOW()
    `;
    saved += 1;
  }
  return { saved };
}

export async function relinkOpenSales(accountKey: string): Promise<{ linked: number }> {
  await ensureUsaLots();
  const candidates = await loadSaleCandidates(accountKey);
  const sql = getSql();
  const rows = await sql`
    SELECT id, ebay_item_id, sku, title, link_status, link_locked, lot_id, item_ref, unit_cost_cents
    FROM usa_ebay_sales
    WHERE account_key = ${accountKey} AND link_locked = FALSE
  `;
  const plan = planStoredSaleLinks(rows.map((row) => {
    const record = row as Record<string, unknown>;
    const status = String(record.link_status ?? "unmatched");
    return {
      id: String(record.id),
      ebayItemId: String(record.ebay_item_id ?? ""),
      sku: String(record.sku ?? ""),
      title: String(record.title ?? ""),
      linkStatus: status === "lotted" || status === "unassigned" || status === "transfer" ? status : "unmatched",
      linkLocked: Boolean(record.link_locked),
      lotId: String(record.lot_id ?? ""),
      itemId: String(record.item_ref ?? ""),
      unitCostCents: centsOrNull(record.unit_cost_cents),
    };
  }), candidates);
  for (const update of plan) {
    await sql`
      UPDATE usa_ebay_sales SET
        lot_id = ${update.lotId},
        item_ref = ${update.itemId},
        link_status = ${update.linkStatus},
        unit_cost_cents = COALESCE(unit_cost_cents, ${update.fillUnitCostCents}),
        cost_estimated = CASE
          WHEN unit_cost_cents IS NULL AND ${update.fillUnitCostCents} IS NOT NULL THEN ${update.fillCostEstimated}
          ELSE cost_estimated
        END,
        updated_at = NOW()
      WHERE id = ${update.saleId} AND account_key = ${accountKey} AND link_locked = FALSE
    `;
  }
  return { linked: plan.length };
}

export async function correctSaleLink(input: {
  accountKey: string;
  saleId: string;
  lotId: string;
  itemId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureUsaLots();
  const sql = getSql();
  if (input.lotId) {
    const lots = await sql`SELECT id FROM usa_purchase_lots WHERE id = ${input.lotId} AND account_key = ${input.accountKey} LIMIT 1`;
    if (!lots.length) return { ok: false, error: "Ese lote no pertenece a esta cuenta." };
  }
  const status = input.lotId ? "lotted" : input.itemId ? "unassigned" : "unmatched";
  const rows = await sql`
    UPDATE usa_ebay_sales SET
      lot_id = ${input.lotId},
      item_ref = ${input.itemId},
      link_status = ${status},
      link_locked = TRUE,
      updated_at = NOW()
    WHERE id = ${input.saleId} AND account_key = ${input.accountKey}
    RETURNING id
  `;
  if (!rows.length) return { ok: false, error: "Esa venta no está en esta cuenta." };
  return { ok: true };
}

function asMoney(row: Record<string, unknown>): SaleMoney {
  return {
    itemCents: centsOrNull(row.item_cents),
    buyerShippingCents: centsOrNull(row.buyer_shipping_cents),
    taxRemittedCents: centsOrNull(row.tax_remitted_cents),
    feeCents: centsOrNull(row.fee_cents),
    sellerShippingCents: centsOrNull(row.seller_shipping_cents),
    refundCents: centsOrNull(row.refund_cents),
    otherCents: centsOrNull(row.other_cents) ?? 0,
    unitCostCents: centsOrNull(row.unit_cost_cents),
    quantity: centsOrNull(row.quantity),
    costEstimated: Boolean(row.cost_estimated),
    cancelled: Boolean(row.cancelled),
    feeLabel: marketplaceFeeLabel(String(row.platform ?? "ebay")),
  };
}

export async function readLotReport(accountKey: string, lotId: string) {
  await ensureUsaLots();
  const sql = getSql();
  const lots = await sql`SELECT * FROM usa_purchase_lots WHERE id = ${lotId} AND account_key = ${accountKey} LIMIT 1`;
  if (!lots.length) return null;
  const lot = lots[0] as Record<string, unknown>;
  const items = await sql`SELECT * FROM usa_lot_items WHERE account_key = ${accountKey} AND lot_id = ${lotId} ORDER BY sku, title`;
  const sales = await sql`SELECT * FROM usa_ebay_sales WHERE account_key = ${accountKey} AND lot_id = ${lotId} ORDER BY sold_at DESC NULLS LAST`;
  const itemRows = items.map((row) => row as Record<string, unknown>);
  const saleRows = sales.map((row) => {
    const record = row as Record<string, unknown>;
    return { record, profit: saleProfit(asMoney(record)) };
  });
  const report = buildLotReport({
    purchaseCents: Number(lot.purchase_cents),
    extraCents: Number(lot.extra_cents),
    sellableCount: centsOrNull(lot.sellable_count),
    publishedCount: itemRows.filter((item) => String(item.ebay_item_id ?? "") !== "").length,
    guatemalaPieces: centsOrNull(lot.guatemala_piece_count) ?? 0,
    guatemalaShippingCents: centsOrNull(lot.guatemala_shipping_cents) ?? 0,
    items: itemRows.map((item) => ({
      id: String(item.id),
      ebayItemId: String(item.ebay_item_id ?? ""),
      disposition: String(item.disposition ?? "") === "guatemala-transfer" ? "guatemala-transfer" as const : "" as const,
      unitCostCents: centsOrNull(item.unit_cost_cents),
      costEstimated: Boolean(item.cost_estimated),
      manual: String(item.cost_source ?? "") === "manual" || item.cost_locked === true,
    })),
    sales: saleRows.map((sale) => {
      const unitCostCents = centsOrNull(sale.record.unit_cost_cents);
      const quantity = centsOrNull(sale.record.quantity);
      return {
        itemId: String(sale.record.item_ref ?? "") || null,
        cancelled: Boolean(sale.record.cancelled),
        linkStatus: String(sale.record.link_status ?? "unmatched") as "lotted" | "unassigned" | "unmatched" | "transfer",
        profit: sale.profit,
        quantity,
        recordedCostCents: unitCostCents != null && quantity != null && quantity >= 1 ? unitCostCents * quantity : null,
        ebayItemId: String(sale.record.ebay_item_id ?? ""),
        platform: String(sale.record.platform ?? "ebay"),
      };
    }),
  });
  return {
    lot: {
      id: String(lot.id),
      name: String(lot.name),
      purchasedOn: String(lot.purchased_on).slice(0, 10),
      purchaseCents: Number(lot.purchase_cents),
      extraCents: Number(lot.extra_cents),
      sellableCount: centsOrNull(lot.sellable_count),
      guatemalaPieces: centsOrNull(lot.guatemala_piece_count) ?? 0,
      guatemalaShippingCents: centsOrNull(lot.guatemala_shipping_cents) ?? 0,
    },
    report,
    items: itemRows.map((item) => ({
      id: String(item.id),
      sku: String(item.sku ?? ""),
      ebayItemId: String(item.ebay_item_id ?? ""),
      title: String(item.title ?? ""),
      unitCostCents: centsOrNull(item.unit_cost_cents),
      costEstimated: Boolean(item.cost_estimated),
      disposition: String(item.disposition ?? ""),
    })),
    sales: saleRows.map((sale) => ({
      id: String(sale.record.id),
      orderId: String(sale.record.order_id),
      platform: String(sale.record.platform ?? "ebay"),
      sku: String(sale.record.sku ?? ""),
      title: String(sale.record.title ?? ""),
      ebayItemId: String(sale.record.ebay_item_id ?? ""),
      soldAt: sale.record.sold_at ? String(sale.record.sold_at) : "",
      quantity: centsOrNull(sale.record.quantity),
      itemCents: centsOrNull(sale.record.item_cents),
      buyerShippingCents: centsOrNull(sale.record.buyer_shipping_cents),
      feeCents: centsOrNull(sale.record.fee_cents),
      sellerShippingCents: centsOrNull(sale.record.seller_shipping_cents),
      unitCostCents: centsOrNull(sale.record.unit_cost_cents),
      profitCents: sale.profit.profitCents,
      label: sale.profit.label,
      missing: sale.profit.missing,
      cancelled: Boolean(sale.record.cancelled),
    })),
  };
}

export async function listOpenSales(accountKey: string): Promise<{ unassigned: { id: string; sku: string; title: string; ebayItemId: string; orderId: string; platform: string }[]; unmatched: { id: string; sku: string; title: string; ebayItemId: string; orderId: string; platform: string }[] }> {
  await ensureUsaLots();
  const sql = getSql();
  const rows = await sql`
    SELECT id, sku, title, ebay_item_id, order_id, link_status, platform
    FROM usa_ebay_sales
    WHERE account_key = ${accountKey} AND link_status IN ('unassigned', 'unmatched')
    ORDER BY updated_at DESC
    LIMIT 100
  `;
  const map = (row: Record<string, unknown>) => ({
    id: String(row.id),
    sku: String(row.sku ?? ""),
    title: String(row.title ?? ""),
    ebayItemId: String(row.ebay_item_id ?? ""),
    orderId: String(row.order_id ?? ""),
    platform: String(row.platform ?? "ebay"),
  });
  return {
    unassigned: rows.filter((row) => String((row as { link_status?: string }).link_status) === "unassigned").map((row) => map(row as Record<string, unknown>)),
    unmatched: rows.filter((row) => String((row as { link_status?: string }).link_status) === "unmatched").map((row) => map(row as Record<string, unknown>)),
  };
}

export async function countUsaSales(accountKey: string): Promise<number> {
  await ensureUsaLots();
  const sql = getSql();
  const rows = await sql`SELECT COUNT(*)::int AS total FROM usa_ebay_sales WHERE account_key = ${accountKey}`;
  return Number((rows[0] as { total?: number } | undefined)?.total ?? 0);
}

export async function readSyncState(accountKey: string): Promise<{ phase: string; cursorEnd: string | null; nextUrl: string; lastSuccessAt: string | null; lastSource: string; lastSaved: number; lastAttemptAt: string | null; lastError: string; feeNote: string; feeBlocked: boolean }> {
  await ensureUsaLots();
  const sql = getSql();
  const rows = await sql`SELECT * FROM usa_sale_sync WHERE account_key = ${accountKey} LIMIT 1`;
  const row = rows[0] as Record<string, unknown> | undefined;
  return {
    phase: String(row?.phase ?? "backfill"),
    cursorEnd: row?.cursor_end ? String(row.cursor_end) : null,
    nextUrl: String(row?.next_url ?? ""),
    lastSuccessAt: row?.last_success_at ? String(row.last_success_at) : null,
    lastSource: String(row?.last_success_source ?? ""),
    lastSaved: Number(row?.last_saved ?? 0),
    lastAttemptAt: row?.last_attempt_at ? String(row.last_attempt_at) : null,
    lastError: String(row?.last_error ?? ""),
    feeNote: String(row?.fee_note ?? ""),
    feeBlocked: Boolean(row?.fee_blocked),
  };
}

export async function saveSyncState(input: {
  accountKey: string;
  phase: string;
  cursorEnd: string | null;
  nextUrl: string;
  lastError: string;
  feeNote: string;
  feeBlocked: boolean;
  success: boolean;
  source: string;
  saved: number;
}): Promise<void> {
  await ensureUsaLots();
  const sql = getSql();
  await sql`
    INSERT INTO usa_sale_sync (
      account_key, phase, cursor_end, next_url, last_success_at, last_error, fee_note, fee_blocked,
      last_attempt_at, pages, last_success_source, last_saved
    )
    VALUES (
      ${input.accountKey}, ${input.phase}, ${input.cursorEnd}, ${input.nextUrl},
      ${input.success ? new Date().toISOString() : null}, ${input.lastError}, ${input.feeNote}, ${input.feeBlocked},
      NOW(), 1, ${input.success ? input.source : ""}, ${input.success ? input.saved : 0}
    )
    ON CONFLICT (account_key) DO UPDATE SET
      phase = EXCLUDED.phase,
      cursor_end = EXCLUDED.cursor_end,
      next_url = EXCLUDED.next_url,
      last_success_at = CASE WHEN ${input.success} THEN NOW() ELSE usa_sale_sync.last_success_at END,
      last_error = EXCLUDED.last_error,
      fee_note = EXCLUDED.fee_note,
      fee_blocked = EXCLUDED.fee_blocked,
      last_attempt_at = NOW(),
      pages = usa_sale_sync.pages + 1,
      last_success_source = CASE WHEN ${input.success} THEN ${input.source} ELSE usa_sale_sync.last_success_source END,
      last_saved = CASE WHEN ${input.success} THEN ${input.saved} ELSE usa_sale_sync.last_saved END
  `;
}

export async function enqueueSaleNotice(orderId: string, topic: string): Promise<void> {
  const clean = orderId.trim();
  if (!clean) return;
  await ensureUsaLots();
  const sql = getSql();
  await sql`
    INSERT INTO usa_sale_notices (id, order_id, topic, status, updated_at)
    VALUES (${crypto.randomUUID()}, ${clean}, ${topic}, 'pending', NOW())
    ON CONFLICT (order_id, topic) DO NOTHING
  `;
}

export async function holdSaleNotice(orderId: string, topic: string): Promise<void> {
  const clean = orderId.trim();
  if (!clean) return;
  await ensureUsaLots();
  const sql = getSql();
  await sql`
    INSERT INTO usa_sale_notices (id, order_id, topic, status, updated_at)
    VALUES (${crypto.randomUUID()}, ${clean}, ${topic}, 'pending', NOW() + INTERVAL '30 minutes')
    ON CONFLICT (order_id, topic) DO UPDATE SET
      updated_at = NOW() + INTERVAL '30 minutes',
      status = CASE WHEN usa_sale_notices.status = 'done' THEN 'done' ELSE 'pending' END
  `;
}

export async function takeSaleNotices(limit: number): Promise<{ id: string; orderId: string }[]> {
  await ensureUsaLots();
  const sql = getSql();
  const rows = await sql`
    SELECT id, order_id FROM usa_sale_notices
    WHERE status = 'pending' AND updated_at <= NOW()
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({ id: String((row as { id: string }).id), orderId: String((row as { order_id: string }).order_id) }));
}

export async function finishSaleNotice(id: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE usa_sale_notices SET status = 'done' WHERE id = ${id}`;
}

export async function postponeSaleNotice(id: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE usa_sale_notices SET updated_at = NOW() + INTERVAL '30 minutes' WHERE id = ${id} AND status = 'pending'`;
}

function marketplacePlatform(value: string): MarketplacePlatform | null {
  if (value === "poshmark" || value === "depop") return value;
  return null;
}

function articleFromRow(row: Record<string, unknown>): MarketplaceArticle & { accountKey: string; unitCostCents: number | null; costEstimated: boolean } {
  const listingUrl = String(row.listing_url ?? "").trim();
  return {
    id: String(row.id),
    accountKey: String(row.account_key ?? ""),
    sku: exactSku(row.sku),
    lotId: String(row.lot_id ?? ""),
    listingUrls: listingUrl ? [listingUrl] : [],
    disposition: String(row.disposition ?? "") === "guatemala-transfer" ? "guatemala-transfer" : "",
    unitCostCents: centsOrNull(row.unit_cost_cents),
    costEstimated: Boolean(row.cost_estimated),
  };
}

function existingSaleFromRow(row: Record<string, unknown>): MarketplaceExistingSale {
  const money = {
    itemCents: centsOrNull(row.item_cents),
    buyerShippingCents: centsOrNull(row.buyer_shipping_cents),
    feeCents: centsOrNull(row.fee_cents),
    sellerShippingCents: centsOrNull(row.seller_shipping_cents),
    refundCents: centsOrNull(row.refund_cents),
  };
  const platform = String(row.platform ?? "ebay");
  const status = String(row.link_status ?? "unmatched");
  return {
    id: String(row.id),
    orderId: String(row.order_id ?? ""),
    itemId: String(row.item_ref ?? ""),
    sku: String(row.sku ?? ""),
    platform,
    listingKey: marketplacePlatform(platform) ? marketplaceListingKey(marketplacePlatform(platform) as MarketplacePlatform, String(row.listing_url ?? "")) : "",
    cancelled: Boolean(row.cancelled),
    linkStatus: status === "lotted" || status === "unassigned" || status === "transfer" ? status : "unmatched",
    hasNet: marketplaceHasNet(money),
  };
}

async function loadMarketplaceArticles(accountKey: string | null) {
  const sql = getSql();
  const rows = accountKey
    ? await sql`
        SELECT id, account_key, lot_id, sku, listing_url, disposition, unit_cost_cents, cost_estimated
        FROM usa_lot_items
        WHERE account_key = ${accountKey}
      `
    : await sql`
        SELECT id, account_key, lot_id, sku, listing_url, disposition, unit_cost_cents, cost_estimated
        FROM usa_lot_items
      `;
  return rows.map((row) => articleFromRow(row as Record<string, unknown>));
}

async function loadMarketplaceSales(accountKey: string): Promise<MarketplaceExistingSale[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, order_id, item_ref, sku, platform, listing_url, cancelled, link_status,
      item_cents, buyer_shipping_cents, fee_cents, seller_shipping_cents, refund_cents
    FROM usa_ebay_sales
    WHERE account_key = ${accountKey}
  `;
  return rows.map((row) => existingSaleFromRow(row as Record<string, unknown>));
}

export async function rememberMarketplaceSale(input: {
  accountKey?: string | null;
  platform: MarketplacePlatform;
  externalId: string;
  sku: string;
  title: string;
  listingUrl: string;
  soldAt?: string | null;
  itemCents: number | null;
  buyerShippingCents: number | null;
  feeCents: number | null;
  sellerShippingCents: number | null;
  refundCents: number | null;
  itemId?: string;
}): Promise<{ action: string; message: string }> {
  await ensureUsaLots();
  const externalId = input.externalId.trim();
  if (!externalId) return { action: "skipped", message: "Falta el identificador de la venta." };
  const scopedAccount = input.accountKey?.trim() || "";
  const articles = await loadMarketplaceArticles(scopedAccount || null);
  const chosen = input.itemId?.trim()
    ? articles.filter((article) => article.id === input.itemId)
    : articles;
  if (input.itemId?.trim() && chosen.length === 0) {
    return { action: "missing", message: "Esa ficha no está en un lote de esta cuenta." };
  }
  if (input.itemId?.trim() && chosen.some((article) => article.disposition === "guatemala-transfer")) {
    return { action: "transfer", message: "Esa prenda está apartada para Guatemala y no se registra como venta." };
  }
  const notice: MarketplaceNotice = {
    platform: input.platform,
    externalId,
    sku: input.sku,
    title: input.title,
    listingUrl: input.listingUrl,
    itemCents: input.itemCents,
    buyerShippingCents: input.buyerShippingCents,
    feeCents: input.feeCents,
    sellerShippingCents: input.sellerShippingCents,
    refundCents: input.refundCents,
  };
  const match = matchMarketplaceArticle(notice, chosen);
  const article = match.kind === "one" ? chosen.find((item) => item.id === match.article.id) : undefined;
  const accountKey = article?.accountKey || scopedAccount || "store";
  const existing = await loadMarketplaceSales(accountKey);
  const plan = planMarketplaceSale(notice, article ? [article] : [], existing);
  if (plan.action === "duplicate") return { action: "duplicate", message: plan.reason };
  if (plan.action === "unmatched" && scopedAccount && scopedAccount !== "store" && !input.itemId) {
    return { action: "skipped", message: "" };
  }
  const sql = getSql();
  const listingUrl = input.listingUrl.trim();
  const soldAt = input.soldAt?.trim() || null;
  if (plan.action === "complete") {
    await sql`
      UPDATE usa_ebay_sales SET
        sku = CASE WHEN ${input.sku.trim()} <> '' THEN ${input.sku.trim()} ELSE sku END,
        title = CASE WHEN ${input.title.trim()} <> '' THEN ${input.title.trim()} ELSE title END,
        platform = ${input.platform},
        listing_url = CASE WHEN ${listingUrl} <> '' THEN ${listingUrl} ELSE listing_url END,
        sold_at = COALESCE(sold_at, ${soldAt}),
        item_cents = COALESCE(${input.itemCents}, item_cents),
        buyer_shipping_cents = COALESCE(${input.buyerShippingCents}, buyer_shipping_cents),
        fee_cents = COALESCE(${input.feeCents}, fee_cents),
        seller_shipping_cents = COALESCE(${input.sellerShippingCents}, seller_shipping_cents),
        refund_cents = COALESCE(${input.refundCents}, refund_cents),
        quantity = COALESCE(quantity, 1),
        lot_id = CASE WHEN ${plan.lotId} <> '' THEN ${plan.lotId} ELSE lot_id END,
        item_ref = CASE WHEN ${plan.itemId} <> '' THEN ${plan.itemId} ELSE item_ref END,
        link_status = CASE WHEN ${plan.itemId} <> '' THEN 'lotted' ELSE link_status END,
        unit_cost_cents = COALESCE(unit_cost_cents, ${article?.unitCostCents ?? null}),
        cost_estimated = CASE
          WHEN unit_cost_cents IS NULL AND ${article?.unitCostCents ?? null} IS NOT NULL THEN ${Boolean(article?.costEstimated)}
          ELSE cost_estimated
        END,
        link_locked = link_locked OR ${Boolean(input.itemId)},
        updated_at = NOW()
      WHERE id = ${plan.saleId} AND account_key = ${accountKey}
    `;
    if (article && listingUrl) {
      await sql`
        UPDATE usa_lot_items
        SET listing_url = ${listingUrl}, updated_at = NOW()
        WHERE id = ${article.id} AND account_key = ${accountKey} AND listing_url = ''
      `;
    }
    return {
      action: "complete",
      message: plan.hasNet
        ? "La venta quedó en la ficha de este lote y actualizó el neto, la ganancia y lo que falta por recuperar."
        : "La venta quedó vinculada a la ficha. Falta el precio o la comisión para sumar el neto.",
    };
  }
  const itemId = plan.action === "record" ? plan.itemId : "";
  const lotId = plan.action === "record" ? plan.lotId : "";
  const linked = articles.find((item) => item.id === itemId);
  await sql`
    INSERT INTO usa_ebay_sales (
      id, account_key, order_id, line_item_id, ebay_item_id, sku, title, quantity, sold_at,
      item_cents, buyer_shipping_cents, tax_remitted_cents, fee_cents, seller_shipping_cents, refund_cents,
      unit_cost_cents, cost_estimated, cancelled, lot_id, item_ref, link_status, link_locked, platform, listing_url
    ) VALUES (
      ${crypto.randomUUID()}, ${accountKey}, ${plan.orderId}, ${itemId || "notice"}, '', ${input.sku.trim()},
      ${input.title.trim()}, 1, ${soldAt}, ${input.itemCents}, ${input.buyerShippingCents}, 0,
      ${input.feeCents}, ${input.sellerShippingCents}, ${input.refundCents},
      ${linked?.unitCostCents ?? null}, ${Boolean(linked?.costEstimated)}, FALSE, ${lotId}, ${itemId},
      ${itemId ? "lotted" : "unmatched"}, ${Boolean(input.itemId)}, ${input.platform}, ${listingUrl}
    )
    ON CONFLICT (account_key, order_id, line_item_id) DO NOTHING
  `;
  if (linked && listingUrl) {
    await sql`
      UPDATE usa_lot_items
      SET listing_url = ${listingUrl}, updated_at = NOW()
      WHERE id = ${linked.id} AND account_key = ${accountKey} AND listing_url = ''
    `;
  }
  if (!itemId) {
    return { action: "unmatched", message: "La venta se guardó sin ficha. Regístrala desde la prenda del lote para asignar el neto." };
  }
  return {
    action: "record",
    message: marketplaceHasNet(notice)
      ? "La venta quedó en la ficha de este lote y actualizó el neto, la ganancia y lo que falta por recuperar."
      : "La venta quedó vinculada a la ficha. Falta el precio o la comisión para sumar el neto.",
  };
}

export async function registerMarketplaceSale(input: {
  accountKey: string;
  itemId: string;
  platform: string;
  price: string;
  fee: string;
  buyerShipping: string;
  sellerShipping: string;
  listingUrl: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const platform = marketplacePlatform(input.platform);
  if (!platform) return { ok: false, error: "Elige Poshmark o Depop." };
  const money = manualMarketplaceMoney(input);
  if (!money.ok) return money;
  await ensureUsaLots();
  const sql = getSql();
  const rows = await sql`
    SELECT id, sku, title, lot_id, disposition
    FROM usa_lot_items
    WHERE id = ${input.itemId} AND account_key = ${input.accountKey}
    LIMIT 1
  `;
  const item = rows[0] as { sku?: string; title?: string; lot_id?: string; disposition?: string } | undefined;
  if (!item) return { ok: false, error: "Esa ficha no está en un lote de esta cuenta." };
  if (String(item.disposition ?? "") === "guatemala-transfer") {
    return { ok: false, error: "Esa prenda está apartada para Guatemala y no se registra como venta." };
  }
  const saved = await rememberMarketplaceSale({
    accountKey: input.accountKey,
    platform,
    externalId: `manual-${input.itemId}`,
    sku: String(item.sku ?? ""),
    title: String(item.title ?? ""),
    listingUrl: input.listingUrl,
    soldAt: new Date().toISOString(),
    ...money.money,
    itemId: input.itemId,
  });
  if (saved.action === "duplicate" || saved.action === "missing" || saved.action === "transfer") {
    return { ok: false, error: saved.message };
  }
  return { ok: true, message: saved.message };
}

export async function importDetectedMarketplaceSales(accountKey: string): Promise<number> {
  await ensureUsaLots();
  const sql = getSql();
  const notices = await sql`
    SELECT platform, external_event_id, sku, title, COALESCE(sent_at, created_at) AS sold_at
    FROM telegram_sale_notices
    WHERE platform IN ('poshmark', 'depop')
      AND status IN ('sent', 'suppressed')
    ORDER BY created_at DESC
    LIMIT 100
  `;
  const knownRows = await sql`
    SELECT order_id FROM usa_ebay_sales
    WHERE order_id LIKE 'poshmark:%' OR order_id LIKE 'depop:%'
  `;
  const known = new Set(knownRows.map((row) => String((row as { order_id?: string }).order_id ?? "")));
  let changed = 0;
  for (const row of notices) {
    const record = row as { platform?: string; external_event_id?: string; sku?: string; title?: string; sold_at?: string };
    const platform = marketplacePlatform(String(record.platform ?? ""));
    const externalId = String(record.external_event_id ?? "").trim();
    if (!platform || !externalId || known.has(`${platform}:${externalId}`)) continue;
    const saved = await rememberMarketplaceSale({
      accountKey: accountKey === "store" ? null : accountKey,
      platform,
      externalId: String(record.external_event_id),
      sku: String(record.sku ?? ""),
      title: String(record.title ?? ""),
      listingUrl: "",
      soldAt: record.sold_at ? String(record.sold_at) : null,
      itemCents: null,
      buyerShippingCents: null,
      feeCents: null,
      sellerShippingCents: null,
      refundCents: null,
    });
    if (saved.action === "record" || saved.action === "complete" || saved.action === "unmatched") changed += 1;
  }
  return changed;
}
