import crypto from "crypto";
import { ensureInventoryTables, getSql } from "@/lib/db";
import {
  DEFAULT_VINTED_CATEGORY_RULES,
  parseVintedCategoryPath,
  type VintedCategoryRule,
} from "@/lib/vinted/category-map";

export async function listVintedCategoryMaps(): Promise<VintedCategoryRule[]> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT item_type, vinted_path
    FROM vinted_category_maps
    ORDER BY item_type ASC
  `;
  return rows
    .map((row) => {
      const record = row as Record<string, unknown>;
      const path = parseVintedCategoryPath(String(record.vinted_path ?? ""));
      return { itemType: String(record.item_type ?? ""), path };
    })
    .filter((rule) => rule.itemType && rule.path.length >= 2);
}

export async function seedVintedCategoryMaps(): Promise<void> {
  const sql = getSql();
  await ensureInventoryTables();
  for (const rule of DEFAULT_VINTED_CATEGORY_RULES) {
    await sql`
      INSERT INTO vinted_category_maps (id, item_type, vinted_path, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${rule.itemType}, ${rule.path.join(" › ")}, NOW(), NOW())
      ON CONFLICT (item_type) DO NOTHING
    `;
  }
}
