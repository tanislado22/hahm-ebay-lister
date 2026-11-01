import { exactSku } from "@/lib/archive/text";

export interface SaleCandidate {
  id: string;
  sku: string;
  ebayItemId: string;
  lotId: string;
  source: "archive" | "lot";
}

export type SaleMatch =
  | { kind: "one"; item: SaleCandidate }
  | { kind: "unmatched" }
  | { kind: "ambiguous" };

function sameId(left: string, right: string): boolean {
  return left.trim() !== "" && left.trim() === right.trim();
}

export function matchSaleToItem(input: {
  ebayItemId: string;
  sku: string;
  variantSku: string;
  title: string;
  items: SaleCandidate[];
}): SaleMatch {
  const itemId = input.ebayItemId.trim();
  const sku = exactSku(input.variantSku) || exactSku(input.sku);
  const byItem = itemId ? input.items.filter((item) => sameId(item.ebayItemId, itemId)) : [];
  if (byItem.length > 1 && sku) {
    const byVariant = byItem.filter((item) => item.sku === sku);
    if (byVariant.length === 1) return { kind: "one", item: byVariant[0] };
    if (byVariant.length > 1) return { kind: "ambiguous" };
  }
  if (byItem.length === 1) return { kind: "one", item: byItem[0] };
  if (byItem.length > 1) return { kind: "ambiguous" };
  if (!sku) return { kind: "unmatched" };
  const bySku = input.items.filter(
    (item) => item.sku === sku && (item.ebayItemId.trim() === "" || !itemId || sameId(item.ebayItemId, itemId))
  );
  if (bySku.length === 1) return { kind: "one", item: bySku[0] };
  if (bySku.length > 1) return { kind: "ambiguous" };
  void input.title;
  return { kind: "unmatched" };
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
