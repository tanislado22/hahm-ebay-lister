export type SalePlatform = "ebay" | "vinted";

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

export function platformStoreLine(platform: SalePlatform): string {
  if (platform === "vinted") return "💙 <b>Vinted Store</b>";
  return "🛍️ <b>eBay Store</b>";
}

function skuBlock(sku: string): string {
  const exact = sku.trim();
  const exactHtml = escapeTelegramHtml(exact);
  const largeHtml = escapeTelegramHtml(enlargeSkuDigits(exact));
  if (!exact) return "";
  if (largeHtml === exactHtml) return `<b>${exactHtml}</b>`;
  return `<b>${largeHtml}</b>\n${exactHtml}`;
}

export function saleTelegramMessage(platform: SalePlatform, sku: string, title: string): string {
  const item = escapeTelegramHtml(displayTitle(title));
  return [
    "🎉 <b>¡VENTA CONFIRMADA!</b> 🎉",
    "",
    platformStoreLine(platform),
    "",
    SEPARATOR,
    "",
    "🏷️ <b>ARTÍCULO VENDIDO</b>",
    item,
    "",
    SEPARATOR,
    "",
    "📦 <b>NÚMERO DE SKU</b>",
    skuBlock(sku),
    "",
    SEPARATOR,
    "",
    "✨ <b>¡Otra venta exitosa!</b>",
  ].join("\n");
}
