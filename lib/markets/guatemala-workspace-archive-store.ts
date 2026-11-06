import { getSql } from "@/lib/db";
import { ensureGuatemalaInventoryTables } from "@/lib/markets/guatemala-inventory-store";
import type { InventoryItemStatus } from "@/lib/markets/guatemala-inventory";
import {
  planWorkspaceArchive,
  workspaceArchiveMessage,
  WORKSPACE_ARCHIVE_MESSAGES,
  type WorkspaceArchivePublication,
  type WorkspaceArchiveSale,
} from "@/lib/markets/guatemala-workspace-archive";

const DELETE_BATCH = 500;

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

function publishedFlag(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

function inventoryStatus(value: unknown): InventoryItemStatus {
  if (value === "vendida" || value === "retirada") return value;
  return "disponible";
}

function salesOf(value: unknown): WorkspaceArchiveSale[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      parsed = [];
    }
  }
  const rows = Array.isArray(parsed) ? parsed : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as { isTest?: unknown; voidedAt?: unknown };
    const isTest = record.isTest === true || record.isTest === "t" || record.isTest === "true";
    const voidedAt =
      record.voidedAt == null || record.voidedAt === "" ? null : String(record.voidedAt);
    return [{ isTest, voidedAt }];
  });
}

async function loadWorkspaceArchiveBook(clientId: string): Promise<{
  jobs: { id: string }[];
  publications: WorkspaceArchivePublication[];
}> {
  const sql = getSql();
  const jobRows = await sql`
    SELECT id
    FROM jobs
    WHERE work_mode = 'client' AND client_id = ${clientId}
  `;
  const itemRows = await sql`
    SELECT item.source_group_id, item.client_id, item.sku, item.price_gtq::text AS price_gtq,
      item.lot_id, item.status, item.published,
      (SELECT COUNT(*)::int FROM guatemala_inventory_photos AS photo WHERE photo.item_id = item.id) AS photo_count,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object('isTest', sale.is_test, 'voidedAt', sale.voided_at)
          )
          FROM guatemala_inventory_sales AS sale
          WHERE sale.item_id = item.id AND sale.client_id = item.client_id
        ),
        '[]'::jsonb
      ) AS sales
    FROM guatemala_inventory_items AS item
    WHERE item.client_id = ${clientId}
  `;
  return {
    jobs: jobRows.map((row) => ({ id: String(row.id) })),
    publications: itemRows.map((row) => ({
      sourceGroupId: String(row.source_group_id),
      clientId: String(row.client_id),
      sku: String(row.sku),
      priceGtq: String(row.price_gtq),
      lotId: row.lot_id == null ? null : String(row.lot_id),
      status: inventoryStatus(row.status),
      published: publishedFlag(row.published),
      photoCount: Number(row.photo_count) || 0,
      sales: salesOf(row.sales),
    })),
  };
}

async function deleteWorkspaceJobs(clientId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const sql = getSql();
  const removed = new Set<string>();
  for (let index = 0; index < ids.length; index += DELETE_BATCH) {
    const slice = ids.slice(index, index + DELETE_BATCH);
    const rows = await sql`
      DELETE FROM jobs
      WHERE work_mode = 'client'
        AND client_id = ${clientId}
        AND id = ANY(${slice})
      RETURNING id
    `;
    for (const row of rows) removed.add(String(row.id));
  }
  return ids.filter((id) => removed.has(id));
}

export async function listConfirmedGuatemalaWorkspaceJobs(clientId: string): Promise<string[]> {
  await ensureGuatemalaInventoryTables();
  await ensureJobsTable();
  const book = await loadWorkspaceArchiveBook(clientId);
  return planWorkspaceArchive({ clientId, jobs: book.jobs, publications: book.publications }).archivedIds;
}

// Removes workspace cards only. Inventory rows, photos, prices, lots, and sales stay.
export async function archiveGuatemalaWorkspaceCards(input: {
  clientId: string;
  jobId?: string;
}): Promise<
  | { ok: true; archivedIds: string[]; message: string }
  | { ok: false; status: 400; error: string }
> {
  await ensureGuatemalaInventoryTables();
  await ensureJobsTable();
  const jobId = input.jobId?.trim() ?? "";
  const book = await loadWorkspaceArchiveBook(input.clientId);
  const plan = planWorkspaceArchive({
    clientId: input.clientId,
    jobs: book.jobs,
    publications: book.publications,
    jobId: jobId || undefined,
  });
  if (jobId && plan.archivedIds.length === 0) {
    return { ok: false, status: 400, error: WORKSPACE_ARCHIVE_MESSAGES.notConfirmed };
  }
  const archivedIds = await deleteWorkspaceJobs(input.clientId, plan.archivedIds);
  return { ok: true, archivedIds, message: workspaceArchiveMessage(archivedIds.length) };
}
