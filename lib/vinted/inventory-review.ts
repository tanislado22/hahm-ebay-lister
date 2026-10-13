import { canonicalVintedId } from "@/lib/vinted/duplicate-presence";
import { normalizeTitle } from "@/lib/vinted/match";

export interface ReviewListing {
  vintedItemId: string;
  sku: string;
  title: string;
  photoUrl: string;
  url?: string;
}

export interface DuplicateGroup {
  reason: "same-listing" | "sku" | "title-photo";
  itemIds: string[];
}

export interface KnownSale {
  platform: "ebay" | "depop" | "poshmark";
  sku: string;
  title: string;
  soldAt: string;
}

export interface SoldDecision {
  soldStatus: "" | "pending_removal" | "review";
  platform: string;
  soldAt: string;
  detail: string;
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("|");
}

function dismissedSet(pairs: Array<[string, string]>): Set<string> {
  return new Set(pairs.map(([left, right]) => pairKey(left, right)));
}

function groupIsOpen(ids: string[], dismissed: Set<string>): boolean {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!dismissed.has(pairKey(ids[i], ids[j]))) return true;
    }
  }
  return false;
}

function openMembers(ids: string[], dismissed: Set<string>): string[] {
  return ids.filter((id) => ids.some((other) => other !== id && !dismissed.has(pairKey(id, other))));
}

export function photoIdentity(url: string): string {
  const raw = url.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function canonicalOf(item: ReviewListing): string {
  return canonicalVintedId(item.vintedItemId, item.url || "");
}

function onePerListing(ids: string[], items: ReviewListing[]): string[] {
  const byId = new Map(items.map((item) => [item.vintedItemId, item]));
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    const key = item ? canonicalOf(item) : id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(id);
  }
  return unique;
}

export function findPossibleDuplicates(
  items: ReviewListing[],
  dismissedPairs: Array<[string, string]>
): DuplicateGroup[] {
  const dismissed = dismissedSet(dismissedPairs);
  const groups: DuplicateGroup[] = [];

  const byCanonical = new Map<string, string[]>();
  for (const item of items) {
    const key = canonicalOf(item);
    if (!key) continue;
    const list = byCanonical.get(key) ?? [];
    list.push(item.vintedItemId);
    byCanonical.set(key, list);
  }
  for (const ids of byCanonical.values()) {
    const unique = [...new Set(ids)];
    if (unique.length > 1) groups.push({ reason: "same-listing", itemIds: unique });
  }

  const bySku = new Map<string, string[]>();
  for (const item of items) {
    const sku = item.sku.trim();
    if (!sku) continue;
    const list = bySku.get(sku) ?? [];
    list.push(item.vintedItemId);
    bySku.set(sku, list);
  }
  for (const ids of bySku.values()) {
    const distinct = onePerListing(ids, items);
    const open = openMembers(distinct, dismissed);
    if (open.length > 1 && groupIsOpen(open, dismissed)) {
      groups.push({ reason: "sku", itemIds: open });
    }
  }

  const byTitlePhoto = new Map<string, string[]>();
  for (const item of items) {
    const title = normalizeTitle(item.title);
    const photo = photoIdentity(item.photoUrl);
    if (!title || !photo) continue;
    const key = `${title}|${photo}`;
    const list = byTitlePhoto.get(key) ?? [];
    list.push(item.vintedItemId);
    byTitlePhoto.set(key, list);
  }
  for (const ids of byTitlePhoto.values()) {
    const distinct = onePerListing([...new Set(ids)], items);
    const open = openMembers(distinct, dismissed);
    if (open.length > 1 && groupIsOpen(open, dismissed)) {
      const already = groups.some(
        (group) => group.itemIds.length === open.length && group.itemIds.every((id) => open.includes(id))
      );
      if (!already) groups.push({ reason: "title-photo", itemIds: open });
    }
  }
  return groups;
}

export function classifySoldListing(input: {
  sku: string;
  title: string;
  listingsWithSku: number;
  sales: KnownSale[];
}): SoldDecision {
  const none: SoldDecision = { soldStatus: "", platform: "", soldAt: "", detail: "" };
  const sku = input.sku.trim();
  const skuSales = sku ? input.sales.filter((sale) => sale.sku.trim() === sku) : [];
  const latest = [...skuSales].sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt))[0];
  if (latest && input.listingsWithSku === 1) {
    return {
      soldStatus: "pending_removal",
      platform: latest.platform,
      soldAt: latest.soldAt,
      detail: "Hay una venta confirmada de este SKU y una sola publicación activa en Vinted.",
    };
  }
  if (latest && input.listingsWithSku > 1) {
    return {
      soldStatus: "review",
      platform: latest.platform,
      soldAt: latest.soldAt,
      detail: "Hay una venta de este SKU, pero varias publicaciones de Vinted lo comparten.",
    };
  }

  const title = normalizeTitle(input.title);
  const titleSales = title
    ? input.sales.filter((sale) => normalizeTitle(sale.title) === title && (!sale.sku.trim() || sale.sku.trim() === sku))
    : [];
  if (titleSales.length === 1) {
    return {
      soldStatus: "review",
      platform: titleSales[0].platform,
      soldAt: titleSales[0].soldAt,
      detail: "El título coincide con una venta registrada. No se marcó como vendido sin un SKU único.",
    };
  }
  if (titleSales.length > 1) {
    return {
      soldStatus: "review",
      platform: "",
      soldAt: "",
      detail: "Varias ventas comparten el título. Hace falta revisión.",
    };
  }
  return none;
}
