import type { GuatemalaCompReport, ListingResult } from "@/lib/types";

export const GUATEMALA_MARKET = {
  code: "guatemala",
  name: "Guatemala",
  locale: "es-GT",
  currency: "GTQ",
  symbol: "Q",
  timezone: "America/Guatemala",
} as const;

export const GUATEMALA_CLIENT_NAME = "tienda guatemala";

export const GUATEMALA_COMP_MESSAGE =
  "Falta configurar una fuente de comparaciones en Guatemala. No hay precios anunciados ni ventas comprobadas. Escribe el precio manualmente.";

export const GUATEMALA_EBAY_BLOCKED =
  "Tienda Guatemala no se publica en eBay.";

export function isGuatemalaMarket(market: unknown): boolean {
  return market === GUATEMALA_MARKET.code;
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

export function guatemalaCompReport(now = new Date()): GuatemalaCompReport {
  return {
    ok: true,
    status: "source_not_configured",
    currency: GUATEMALA_MARKET.currency,
    symbol: GUATEMALA_MARKET.symbol,
    timezone: GUATEMALA_MARKET.timezone,
    queriedAt: now.toISOString(),
    listed: [],
    sold: [],
    message: GUATEMALA_COMP_MESSAGE,
  };
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
