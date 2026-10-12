import { describe, expect, test } from "vitest";
import {
  activeInventoryRows,
  archiveInventoryItem,
  duplicateGroupsWithoutArchived,
  restoreInventoryItem,
  type ArchiveInventoryRow,
} from "@/lib/vinted/inventory-archive";

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

  test("archives one Vinted listing that shares SKU ST-26 and leaves the other listing in place", () => {
    const pair: ArchiveInventoryRow[] = [
      { vintedItemId: "vinted-481920", sku: "ST-26", ebayItemId: "123456789012", matchStatus: "verified", archivedAt: null },
      { vintedItemId: "vinted-481921", sku: "ST-26", ebayItemId: "123456789013", matchStatus: "verified", archivedAt: null },
    ];
    const bySku = archiveInventoryItem(pair, "ST-26", "2026-10-12T20:00:00.000Z");
    expect(bySku.ok).toBe(false);

    const archived = archiveInventoryItem(pair, "vinted-481920", "2026-10-12T20:00:00.000Z");
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archived.rows[0]).toEqual({ ...pair[0], archivedAt: "2026-10-12T20:00:00.000Z" });
    expect(archived.rows[1]).toEqual(pair[1]);
    expect(activeInventoryRows(archived.rows).map((row) => row.vintedItemId)).toEqual(["vinted-481921"]);
    expect(
      duplicateGroupsWithoutArchived([{ reason: "sku", itemIds: ["vinted-481920", "vinted-481921"] }], ["vinted-481920"])
    ).toEqual([]);
    expect(
      duplicateGroupsWithoutArchived(
        [{ reason: "sku", itemIds: ["vinted-481920", "vinted-481921", "vinted-481922"] }],
        ["vinted-481920"]
      )
    ).toEqual([{ reason: "sku", itemIds: ["vinted-481921", "vinted-481922"] }]);
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
