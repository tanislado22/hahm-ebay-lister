import type { ListingResult } from "@/lib/types";

export const GUATEMALA_MARKET = {
  code: "guatemala",
  name: "Guatemala",
  locale: "es-GT",
  currency: "GTQ",
  symbol: "Q",
  timezone: "America/Guatemala",
} as const;

export const GUATEMALA_CLIENT_NAME = "tienda guatemala";

export const GUATEMALA_EBAY_BLOCKED =
  "Tienda Guatemala no se publica en eBay.";

export function isGuatemalaMarket(market: unknown): boolean {
  return market === GUATEMALA_MARKET.code;
}

// The typed SKU stays text. Dots, letters, and a trailing zero are kept, and
// nothing appends a bin letter such as "-A".
export function exactGuatemalaSku(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

export function guatemalaDuplicateSkuMessage(skus: string[]): string {
  const counts = new Map<string, number>();
  for (const sku of skus) counts.set(sku, (counts.get(sku) ?? 0) + 1);
  const repeated = [...counts.entries()].filter(([, count]) => count > 1);
  if (repeated.length === 0) return "";
  const named = repeated.map(([sku]) => sku).filter((sku) => sku !== "");
  const parts: string[] = [];
  if (named.length === 1) {
    parts.push(`Varias prendas tienen el SKU ${named[0]}.`);
  } else if (named.length > 1) {
    parts.push(`Varias prendas comparten estos SKU: ${named.join(", ")}.`);
  }
  if (repeated.some(([sku]) => sku === "")) {
    parts.push("Varias prendas no tienen SKU.");
  }
  parts.push("Asigna un SKU diferente a cada prenda.");
  return parts.join(" ");
}

export function requestTargetsGuatemala(body: {
  market?: unknown;
  listing?: { market?: unknown } | null;
}): boolean {
  return isGuatemalaMarket(body.market) || isGuatemalaMarket(body.listing?.market);
}

// The model may guess a price from the photos. Guatemala listings keep that
// number out of the draft so it cannot be shown as a local comparison.
export function prepareGuatemalaListing(listing: ListingResult): ListingResult {
  const next: ListingResult = {
    ...listing,
    market: GUATEMALA_MARKET.code,
    currency: GUATEMALA_MARKET.currency,
  };
  delete next.suggested_price;
  return next;
}

export function formatQuetzales(value: number): string {
  return `${GUATEMALA_MARKET.symbol}${value.toFixed(2)}`;
}

export function formatGuatemalaMoment(iso: string, now = new Date()): string {
  const parsed = new Date(iso);
  const date = Number.isNaN(parsed.getTime()) ? now : parsed;
  return new Intl.DateTimeFormat(GUATEMALA_MARKET.locale, {
    timeZone: GUATEMALA_MARKET.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
