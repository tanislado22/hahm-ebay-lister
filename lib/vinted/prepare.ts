import type { ListingResult } from "@/lib/types";
import { formatVintedCategoryPath, resolveVintedCategory } from "@/lib/vinted/category-map";

export interface VintedPrepared {
  sku: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  vintedCategory: string;
  size: string;
  color: string;
  condition: string;
  price: string;
}

const CONDITION_LABELS: Record<string, string> = {
  NEW_WITH_TAGS: "New with tags",
  NEW_NO_TAGS: "New without tags",
  NEW: "New",
  EXCELLENT: "Pre-owned · Excellent",
  VERY_GOOD: "Pre-owned · Very good",
  GOOD: "Pre-owned · Good",
  FAIR: "Pre-owned · Fair",
  USED: "Pre-owned",
};

function asText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.map((v) => v.trim()).filter(Boolean).join(", ");
  return (value ?? "").trim();
}

function priceText(value: ListingResult["suggested_price"]): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (n === undefined || Number.isNaN(n)) return "";
  return n.toFixed(2);
}

export function prepareVintedFields(sku: string, listing: ListingResult): VintedPrepared {
  const conditionRaw = (listing.condition ?? "").trim();
  const bucket = (listing.category || "").trim();
  const match = resolveVintedCategory({
    title: listing.title,
    brand: listing.brand,
    itemType: listing.item_type,
    bucket,
  });
  return {
    sku: sku.trim(),
    title: (listing.title ?? "").trim(),
    description: (listing.description ?? "").trim(),
    brand: (listing.brand ?? "").trim(),
    category: (listing.category || listing.category_hint || "").trim(),
    vintedCategory: match ? formatVintedCategoryPath(match.path) : "",
    size: (listing.size ?? "").trim(),
    color: asText(listing.color),
    condition: CONDITION_LABELS[conditionRaw] ?? conditionRaw,
    price: priceText(listing.suggested_price),
  };
}

export function vintedIdFromUrl(url: string): string | null {
  const match = url.match(/vinted\.[a-z.]+\/(?:items|item)\/(\d+)/i);
  return match ? match[1] : null;
}
