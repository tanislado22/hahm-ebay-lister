import type { SalePlatform } from "@/lib/telegram/message";

const PLATFORM_HOST: Record<SalePlatform, RegExp> = {
  ebay: /^(?:www\.)?ebay\.[a-z.]+$/i,
  vinted: /^(?:www\.)?vinted\.[a-z.]+$/i,
  poshmark: /^(?:www\.)?poshmark\.com$/i,
  depop: /^(?:www\.)?depop\.com$/i,
};

const PLATFORM_PATH: Record<SalePlatform, RegExp> = {
  ebay: /^\/itm\/(?:[^/]+\/)?\d{10,15}(?:\/|$)/i,
  vinted: /^\/items\/\d{6,}(?:-[^/]*)?$/i,
  poshmark: /^\/listing\/[^/]+$/i,
  depop: /^\/products\/[^/]+$/i,
};

export function safeListingUrl(value: string | null | undefined): string | null {
  const raw = String(value || "").trim().replace(/[),.;]+$/g, "");
  if (!raw || /["<>\s]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function listingUrlForPlatform(platform: SalePlatform, value: string | null | undefined): string | null {
  const safe = safeListingUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (!PLATFORM_HOST[platform].test(url.hostname)) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (!PLATFORM_PATH[platform].test(path)) return null;
  return safe;
}

export function extractPlatformListingUrl(platform: SalePlatform, source: string): string | null {
  const found = source.match(/https:\/\/[^\s<>"']+/gi) ?? [];
  for (const candidate of found) {
    const url = listingUrlForPlatform(platform, candidate);
    if (url) return url;
  }
  return null;
}

export interface SentSaleNotice {
  platform: string;
  sku: string;
  externalEventId: string;
  sent: boolean;
}

export function saleNoticeIsDuplicate(input: {
  platform: string;
  sku: string;
  externalEventId: string;
  prior: SentSaleNotice[];
}): boolean {
  const platform = input.platform.trim();
  const sku = input.sku.trim();
  const eventId = input.externalEventId.trim();
  return input.prior.some((row) => {
    if (!row.sent || row.platform !== platform) return false;
    if (eventId && row.externalEventId === eventId) return true;
    return Boolean(sku) && row.sku === sku;
  });
}
