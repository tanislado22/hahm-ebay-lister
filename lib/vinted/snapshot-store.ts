import { ensureInventoryTables, getSql } from "@/lib/db";
import type { ReadyPhoto, ReadySnapshot } from "@/lib/vinted/snapshot";

interface SnapshotRow {
  sku?: string;
  title?: string;
  description?: string;
  price?: string;
  brand?: string;
  category?: string;
  item_type?: string;
  size?: string;
  color?: string;
  condition?: string;
  photos?: ReadyPhoto[] | string;
  updated_at?: string;
}

function photosFrom(value: ReadyPhoto[] | string | undefined): ReadyPhoto[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed.filter((photo) => Boolean(photo?.data)) : [];
}

export async function replaceVintedReadySnapshot(
  workspaceKey: string,
  snapshot: ReadySnapshot
): Promise<string> {
  const sql = getSql();
  await ensureInventoryTables();
  const photos = JSON.stringify(snapshot.photos);
  const rows = await sql`
    INSERT INTO vinted_ready_snapshot (
      workspace_key, sku, title, description, price, brand, category, item_type,
      size, color, condition, photos, updated_at
    )
    VALUES (
      ${workspaceKey},
      ${snapshot.sku},
      ${snapshot.title},
      ${snapshot.description},
      ${snapshot.price},
      ${snapshot.brand},
      ${snapshot.category},
      ${snapshot.itemType},
      ${snapshot.size},
      ${snapshot.color},
      ${snapshot.condition},
      ${photos}::jsonb,
      NOW()
    )
    ON CONFLICT (workspace_key) DO UPDATE SET
      sku = EXCLUDED.sku,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      price = EXCLUDED.price,
      brand = EXCLUDED.brand,
      category = EXCLUDED.category,
      item_type = EXCLUDED.item_type,
      size = EXCLUDED.size,
      color = EXCLUDED.color,
      condition = EXCLUDED.condition,
      photos = EXCLUDED.photos,
      updated_at = NOW()
    RETURNING updated_at
  `;
  return String((rows[0] as { updated_at?: string } | undefined)?.updated_at ?? "");
}

export async function getLatestReadySnapshot(): Promise<(ReadySnapshot & { updatedAt: string }) | null> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT sku, title, description, price, brand, category, item_type, size, color, condition, photos, updated_at
    FROM vinted_ready_snapshot
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return mapSnapshot(rows[0] as SnapshotRow | undefined);
}

function mapSnapshot(row: SnapshotRow | undefined): (ReadySnapshot & { updatedAt: string }) | null {
  const sku = String(row?.sku ?? "").trim();
  if (!row || !sku) return null;
  return {
    sku,
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    price: String(row.price ?? ""),
    brand: String(row.brand ?? ""),
    category: String(row.category ?? ""),
    itemType: String(row.item_type ?? ""),
    size: String(row.size ?? ""),
    color: String(row.color ?? ""),
    condition: String(row.condition ?? ""),
    photos: photosFrom(row.photos),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function getVintedReadySnapshot(
  workspaceKey: string
): Promise<(ReadySnapshot & { updatedAt: string }) | null> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT sku, title, description, price, brand, category, item_type, size, color, condition, photos, updated_at
    FROM vinted_ready_snapshot
    WHERE workspace_key = ${workspaceKey}
  `;
  return mapSnapshot(rows[0] as SnapshotRow | undefined);
}

export async function photosForGroupId(groupId: string): Promise<ReadyPhoto[]> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT data
    FROM jobs
    WHERE id = ${groupId}
    LIMIT 1
  `;
  if (rows.length === 0) return [];
  const raw = (rows[0] as { data?: unknown }).data;
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const photos = (data as { photos?: ReadyPhoto[] } | null)?.photos;
  return Array.isArray(photos) ? photos.filter((photo) => Boolean(photo?.data)) : [];
}
