import { listingUrlForPlatform } from "@/lib/telegram/sale-links";

export type SalePlatform = "ebay" | "vinted" | "poshmark" | "depop";

const SEPARATOR = "━━━━━━━━━━━━━━━━━━━━";
const SANS_BOLD_ZERO = 0x1d7ec;

export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function displayTitle(title: string): string {
  return title.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

// Mathematical sans-serif bold digits read larger on phone fonts.
// Characters that are not digits stay unchanged.
export function enlargeSkuDigits(sku: string): string {
  return Array.from(sku)
    .map((char) => {
      const digit = char.charCodeAt(0) - 48;
      if (char.length === 1 && digit >= 0 && digit <= 9) {
        return String.fromCodePoint(SANS_BOLD_ZERO + digit);
      }
      return char;
    })
    .join("");
}

export function endedListingMessage(sku: string, title: string): string {
  const item = escapeTelegramHtml(displayTitle(title));
  return [
    "🛑 <b>ARTÍCULO RETIRADO DE EBAY</b>",
    "",
    SEPARATOR,
    "",
    "🏷️ <b>ARTÍCULO</b>",
    item,
    "",
    SEPARATOR,
    "",
    "📦 <b>NÚMERO DE SKU</b>",
    skuBlock(sku),
    "",
    SEPARATOR,
  ].join("\n");
}

export function connectionTestMessage(): string {
  return [
    "✅ CONEXIÓN EXITOSA",
    "🔔 My eBay Vinted Sales",
    "📦 SKU: 2830",
    "🛍️ Plataforma: eBay",
    "🟢 Notificaciones de ventas funcionando correctamente.",
  ].join("\n");
}

export function platformLabel(platform: SalePlatform): string {
  if (platform === "vinted") return "VINTED";
  if (platform === "poshmark") return "POSHMARK";
  if (platform === "depop") return "DEPOP";
  return "EBAY";
}

function skuBlock(sku: string): string {
  const exact = sku.trim();
  if (!exact) return "<b>No encontrado</b>";
  return `<b>${escapeTelegramHtml(enlargeSkuDigits(exact))}</b>`;
}

function vintedSaleMessage(sku: string, title: string): string {
  const item = escapeTelegramHtml(displayTitle(title));
  const exact = sku.trim();
  if (!exact) {
    return [
      "🟢 📦 <b>¡ARTÍCULO VENDIDO!</b>",
      "🛍️ Plataforma: <b>VINTED</b>",
      `👕 Artículo: ${item}`,
      "🔢 SKU: <b>NO ENCONTRADO</b>",
      "⚠️ <b>REVISAR VINTED MANUALMENTE</b>",
    ].join("\n");
  }
  return [
    "🟢 📦 <b>¡ARTÍCULO VENDIDO!</b>",
    "🛍️ Plataforma: <b>VINTED</b>",
    `👕 Artículo: ${item}`,
    `🔢 SKU: <b>${escapeTelegramHtml(enlargeSkuDigits(exact))}</b>`,
    "⚠️ <b>REVISAR OTRAS PLATAFORMAS</b>",
    "🔍 Si sigue publicado en otra plataforma, retirarlo manualmente.",
  ].join("\n");
}

export interface SaleNoticeLinks {
  url?: string | null;
  listingUrl?: string | null;
}

function openLabel(platform: SalePlatform): string {
  if (platform === "vinted") return "Abrir en Vinted";
  if (platform === "poshmark") return "Abrir en Poshmark";
  if (platform === "depop") return "Abrir en Depop";
  return "Abrir en eBay";
}

function linkLine(label: string, url: string): string {
  return `🔗 <a href="${escapeTelegramHtml(url)}">${escapeTelegramHtml(label)}</a>`;
}

function appendSaleLinks(lines: string[], platform: SalePlatform, links?: SaleNoticeLinks): void {
  if (!links) return;
  const listingUrl = listingUrlForPlatform(platform, links.listingUrl) ?? "";
  const vintedUrl = listingUrlForPlatform("vinted", links.url) ?? "";
  if (listingUrl) lines.push(linkLine(openLabel(platform), listingUrl));
  if (platform === "vinted") return;
  if (!("url" in links)) return;
  lines.push(vintedUrl ? linkLine("Abrir en Vinted", vintedUrl) : "🔗 Publicación de Vinted no identificada");
}

export function saleTelegramMessage(
  platform: SalePlatform,
  sku: string,
  title: string,
  links?: SaleNoticeLinks
): string {
  const lines = platform === "vinted"
    ? vintedSaleMessage(sku, title).split("\n")
    : [
        "🟢 📦 <b>¡ARTÍCULO VENDIDO!</b>",
        `🛍️ Plataforma: <b>${platformLabel(platform)}</b>`,
        `👕 Artículo: ${escapeTelegramHtml(displayTitle(title))}`,
        `🔢 SKU: ${skuBlock(sku)}`,
        "⚠️ <b>REVISAR VINTED</b>",
        platform === "ebay"
          ? "🔍 Si sigue publicado en Vinted, retirarlo manualmente."
          : "🔍 Si sigue publicado, retirarlo manualmente.",
      ];
  appendSaleLinks(lines, platform, links);
  return lines.join("\n");
}
