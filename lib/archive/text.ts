const EBAY_IMAGE_HOSTS = new Set([
  "i.ebayimg.com",
  "thumbs.ebaystatic.com",
  "ir.ebaystatic.com",
]);

export function exactSku(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function searchNeedle(value: string): string {
  return value.trim().toLowerCase();
}

export function textIncludes(haystack: string, needle: string): boolean {
  const query = searchNeedle(needle);
  if (!query) return true;
  return haystack.toLowerCase().includes(query);
}

export function decodeXml(value: string): string {
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/i);
  const raw = cdata ? cdata[1] : value;
  return raw
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .trim();
}

export function plainDescription(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function safeEbayImageUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "";
    if (!EBAY_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function ebayThumbUrl(value: string): string {
  const safe = safeEbayImageUrl(value);
  if (!safe) return "";
  return safe.replace(/\/s-l\d+(\.[a-z0-9]+)?(?=$|\?)/i, "/s-l140$1");
}

export function ebayItemIdText(value: string): string {
  return value.replace(/\D/g, "");
}
