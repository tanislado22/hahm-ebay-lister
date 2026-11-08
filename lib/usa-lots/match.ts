import { exactSku } from "@/lib/archive/text";

export interface SaleCandidate {
  id: string;
  sku: string;
  ebayItemId: string;
  lotId: string;
  source: "archive" | "lot";
  unitCostCents?: number | null;
  costEstimated?: boolean;
}

export type SaleMatch =
  | { kind: "one"; item: SaleCandidate }
  | { kind: "unmatched" }
  | { kind: "ambiguous" };

export function ebayListingId(value: string): string {
  return value.replace(/\D/g, "");
}

export function matchSaleToItem(input: {
  ebayItemId: string;
  sku: string;
  variantSku: string;
  title: string;
  items: SaleCandidate[];
}): SaleMatch {
  const itemId = ebayListingId(input.ebayItemId);
  const sku = exactSku(input.variantSku) || exactSku(input.sku);
  const byItem = itemId ? input.items.filter((item) => ebayListingId(item.ebayItemId) === itemId) : [];
  const chosen = oneCandidate(byItem, sku);
  if (chosen.kind === "one" || chosen.kind === "ambiguous") return chosen;
  if (!sku) return { kind: "unmatched" };
  const bySku = input.items.filter((item) => item.sku === sku);
  const bySkuChosen = oneCandidate(bySku, sku);
  void input.title;
  return bySkuChosen.kind === "one" || bySkuChosen.kind === "ambiguous" ? bySkuChosen : { kind: "unmatched" };
}

function oneCandidate(items: SaleCandidate[], sku: string): SaleMatch {
  if (items.length === 0) return { kind: "unmatched" };
  if (items.length === 1) return { kind: "one", item: items[0] };
  if (sku) {
    const bySku = items.filter((item) => item.sku === sku);
    if (bySku.length === 1) return { kind: "one", item: bySku[0] };
  }
  const lotItems = items.filter((item) => item.source === "lot");
  if (lotItems.length === 1) return { kind: "one", item: lotItems[0] };
  return { kind: "ambiguous" };
}

export function lotForMatch(match: SaleMatch): { linkStatus: "lotted" | "unassigned" | "unmatched"; lotId: string; itemId: string } {
  if (match.kind !== "one") return { linkStatus: "unmatched", lotId: "", itemId: "" };
  if (!match.item.lotId.trim()) return { linkStatus: "unassigned", lotId: "", itemId: match.item.id };
  return { linkStatus: "lotted", lotId: match.item.lotId, itemId: match.item.id };
}

export interface StoredSale {
  id: string;
  orderId: string;
  lineItemId: string;
  lotId: string;
  linkLocked: boolean;
  incomeCents: number;
}

export interface OpenSaleLink {
  id: string;
  ebayItemId: string;
  sku: string;
  title: string;
  linkStatus: "lotted" | "unassigned" | "unmatched" | "transfer";
  linkLocked: boolean;
  lotId: string;
  itemId: string;
  unitCostCents: number | null;
}

export interface StoredLinkUpdate {
  saleId: string;
  lotId: string;
  itemId: string;
  linkStatus: "lotted" | "unassigned";
  fillUnitCostCents: number | null;
  fillCostEstimated: boolean;
}

export function planStoredSaleLinks(sales: OpenSaleLink[], items: SaleCandidate[]): StoredLinkUpdate[] {
  const lotItemIds = new Set(items.filter((item) => item.source === "lot").map((item) => item.id));
  const updates: StoredLinkUpdate[] = [];
  for (const sale of sales) {
    if (sale.linkLocked || sale.linkStatus === "transfer") continue;
    if (sale.linkStatus === "lotted" && sale.itemId !== "" && lotItemIds.has(sale.itemId)) continue;
    const linked = lotForMatch(matchSaleToItem({
      ebayItemId: sale.ebayItemId,
      sku: sale.sku,
      variantSku: "",
      title: sale.title,
      items,
    }));
    if (linked.linkStatus === "unmatched") continue;
    if (linked.lotId === sale.lotId && linked.itemId === sale.itemId && sale.linkStatus === linked.linkStatus) continue;
    const item = items.find((candidate) => candidate.id === linked.itemId);
    const fillUnitCostCents = sale.unitCostCents == null && item?.source === "lot" && item.unitCostCents != null
      ? item.unitCostCents
      : null;
    updates.push({
      saleId: sale.id,
      lotId: linked.lotId,
      itemId: linked.itemId,
      linkStatus: linked.linkStatus,
      fillUnitCostCents,
      fillCostEstimated: fillUnitCostCents != null && Boolean(item?.costEstimated),
    });
  }
  return updates;
}

export function applyIncomingSale(existing: StoredSale[], incoming: StoredSale): StoredSale[] {
  const key = `${incoming.orderId}:${incoming.lineItemId}`;
  const found = existing.find((sale) => `${sale.orderId}:${sale.lineItemId}` === key);
  if (!found) return [...existing, incoming];
  return existing.map((sale) => {
    if (`${sale.orderId}:${sale.lineItemId}` !== key) return sale;
    return {
      ...incoming,
      id: sale.id,
      lotId: sale.linkLocked ? sale.lotId : incoming.lotId,
      linkLocked: sale.linkLocked,
    };
  });
}
