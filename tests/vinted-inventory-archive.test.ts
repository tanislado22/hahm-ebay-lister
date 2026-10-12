import { describe, expect, test } from "vitest";
import { activeInventoryRows, archiveInventoryItem, restoreInventoryItem, type ArchiveInventoryRow } from "@/lib/vinted/inventory-archive";

const rows: ArchiveInventoryRow[] = [
  { vintedItemId: "111", sku: "2443", ebayItemId: "123456789012", matchStatus: "verified", archivedAt: null },
  { vintedItemId: "222", sku: "2503", ebayItemId: "123456789013", matchStatus: "review", archivedAt: null },
  { vintedItemId: "333", sku: "", ebayItemId: "", matchStatus: "unmatched", archivedAt: null },
];

describe("vinted inventory archive", () => {
  test("archives only the selected item and keeps the other records intact", () => {
    const result = archiveInventoryItem(rows, "222", "2026-10-12T18:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual(rows[0]);
    expect(result.rows[2]).toEqual(rows[2]);
    expect(result.rows[1]).toEqual({
      vintedItemId: "222",
      sku: "2503",
      ebayItemId: "123456789013",
      matchStatus: "review",
      archivedAt: "2026-10-12T18:00:00.000Z",
    });
    expect(activeInventoryRows(result.rows).map((row) => row.vintedItemId)).toEqual(["111", "333"]);
  });

  test("does not change anything when the archive is cancelled by leaving the row active", () => {
    expect(activeInventoryRows(rows)).toEqual(rows);
  });

  test("restores an archived item without changing its saved association", () => {
    const archived = archiveInventoryItem(rows, "111", "2026-10-12T18:00:00.000Z");
    if (!archived.ok) throw new Error(archived.error);
    const restored = restoreInventoryItem(archived.rows, "111");
    expect(restored[0]).toEqual(rows[0]);
    expect(restored[1]).toEqual(rows[1]);
    expect(restored[2]).toEqual(rows[2]);
  });
});
