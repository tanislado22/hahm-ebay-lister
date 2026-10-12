export interface ArchiveInventoryRow {
  vintedItemId: string;
  sku: string;
  ebayItemId: string;
  matchStatus: string;
  archivedAt: string | null;
}

export function archiveInventoryItem<T extends ArchiveInventoryRow>(
  rows: T[],
  vintedItemId: string,
  archivedAt: string
): { ok: true; rows: T[] } | { ok: false; error: string } {
  const id = vintedItemId.trim();
  if (!id) return { ok: false, error: "Falta la publicación de Vinted." };
  if (!rows.some((row) => row.vintedItemId === id)) return { ok: false, error: "No existe esa publicación." };
  return {
    ok: true,
    rows: rows.map((row) => (row.vintedItemId === id ? { ...row, archivedAt } : row)),
  };
}

export function restoreInventoryItem<T extends ArchiveInventoryRow>(rows: T[], vintedItemId: string): T[] {
  const id = vintedItemId.trim();
  return rows.map((row) => (row.vintedItemId === id ? { ...row, archivedAt: null } : row));
}

export function activeInventoryRows<T extends { archivedAt: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => !row.archivedAt);
}

export function duplicateGroupsWithoutArchived<T extends { itemIds: string[] }>(groups: T[], archivedIds: Iterable<string>): T[] {
  const archived = new Set(archivedIds);
  return groups
    .map((group) => ({ ...group, itemIds: group.itemIds.filter((id) => !archived.has(id)) }))
    .filter((group) => group.itemIds.length > 1);
}
