import { catalogOrderAllowed, type CatalogSourceItem } from "@/lib/markets/guatemala-catalog";
import { guatemalaWhatsappUrl, publicArticleUrl } from "@/lib/markets/guatemala-whatsapp";

/**
 * Carrito del catálogo público. Vive en el navegador.
 * Consultar disponibilidad o abrir WhatsApp no aparta ni vende la prenda.
 */

export const PUBLIC_CART_LIMIT = 24;
export const PUBLIC_CART_STORAGE_KEY = "vsa-public-cart";

export const PUBLIC_CART_MESSAGES = {
  added: "Se agregó al carrito.",
  duplicate: "Esta prenda ya está en el carrito.",
  full: "El carrito ya tiene el máximo de prendas.",
  emptyTitle: "Tu carrito está vacío",
  emptyBody: "Elige una prenda disponible del catálogo.",
  shipping: "La disponibilidad y el costo de envío se confirman por WhatsApp. Agregar al carrito no aparta la prenda.",
  confirmFailed: "No se pudo confirmar la disponibilidad. Inténtalo de nuevo antes de enviar el pedido.",
  send: "Enviar pedido por WhatsApp",
  checking: "Revisando disponibilidad…",
  inCart: "En el carrito",
  add: "Agregar al carrito",
} as const;

export interface PublicCartLine {
  id: string;
  sku: string;
  title: string;
  size: string;
  priceGtq: string;
  coverPhotoId: string | null;
}

export type PublicCartQuote =
  | {
      id: string;
      available: true;
      sku: string;
      title: string;
      size: string;
      priceGtq: string;
      coverPhotoId: string | null;
    }
  | { id: string; available: false };

export function cartActionChangesInventory(): false {
  return false;
}

export function addPublicCartLine(
  lines: readonly PublicCartLine[],
  line: PublicCartLine
): { lines: PublicCartLine[]; added: boolean; message: string } {
  const next = cleanCartLine(line);
  if (!next) return { lines: [...lines], added: false, message: PUBLIC_CART_MESSAGES.confirmFailed };
  if (lines.some((item) => item.id === next.id)) {
    return { lines: [...lines], added: false, message: PUBLIC_CART_MESSAGES.duplicate };
  }
  if (lines.length >= PUBLIC_CART_LIMIT) {
    return { lines: [...lines], added: false, message: PUBLIC_CART_MESSAGES.full };
  }
  return { lines: [...lines, next], added: true, message: PUBLIC_CART_MESSAGES.added };
}

export function removePublicCartLine(lines: readonly PublicCartLine[], id: string): PublicCartLine[] {
  return lines.filter((line) => line.id !== id);
}

export function publicCartTotal(lines: readonly PublicCartLine[]): string {
  const cents = lines.reduce((sum, line) => sum + quetzalCents(line.priceGtq), 0);
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function readStoredCart(raw: string | null): PublicCartLine[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const lines: PublicCartLine[] = [];
    for (const entry of parsed) {
      const line = cleanCartLine(entry);
      if (!line || lines.some((item) => item.id === line.id)) continue;
      lines.push(line);
      if (lines.length >= PUBLIC_CART_LIMIT) break;
    }
    return lines;
  } catch {
    return [];
  }
}

export function publicCartQuoteView(item: CatalogSourceItem, clientId: string): PublicCartQuote {
  if (!catalogOrderAllowed(item, clientId)) return { id: item.id, available: false };
  return {
    id: item.id,
    available: true,
    sku: item.sku,
    title: item.title.trim() || "Prenda sin título",
    size: item.size.trim(),
    priceGtq: item.priceGtq,
    coverPhotoId: item.photos[0]?.id ?? null,
  };
}

export function reviewPublicCart(
  lines: readonly PublicCartLine[],
  quotes: readonly PublicCartQuote[]
): { lines: PublicCartLine[]; changed: boolean; message: string } {
  const byId = new Map(quotes.map((quote) => [quote.id, quote]));
  let unavailable = 0;
  let repriced = 0;
  const next: PublicCartLine[] = [];
  for (const line of lines) {
    const quote = byId.get(line.id);
    if (!quote || !quote.available) {
      unavailable += 1;
      continue;
    }
    if (quote.priceGtq !== line.priceGtq) repriced += 1;
    next.push({
      id: line.id,
      sku: quote.sku,
      title: quote.title,
      size: quote.size,
      priceGtq: quote.priceGtq,
      coverPhotoId: quote.coverPhotoId,
    });
  }
  return {
    lines: next,
    changed: unavailable > 0 || repriced > 0,
    message: reviewMessage(unavailable, repriced),
  };
}

export function cartIdsFromRequest(value: unknown): string[] | null {
  if (!value || typeof value !== "object") return null;
  const ids = (value as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) return null;
  const clean = [...new Set(ids.flatMap((id) => {
    if (typeof id !== "string") return [];
    const trimmed = id.trim();
    return trimmed && trimmed.length <= 80 ? [trimmed] : [];
  }))];
  if (clean.length > PUBLIC_CART_LIMIT) return null;
  return clean;
}

export function cartOrderWhatsappUrl(
  lines: readonly PublicCartLine[],
  origin: string,
  storefront: boolean
): string {
  const rows = lines.map((line, index) => {
    const name = line.title.trim() || "Prenda sin título";
    return `${index + 1}. ${name}. SKU: ${line.sku}. Precio: Q${line.priceGtq}. Enlace: ${publicArticleUrl(origin, storefront, line.id)}`;
  });
  const message = [
    "Hola, quiero pedir estas prendas de Variedades San Andrés:",
    "",
    ...rows,
    "",
    `Productos: ${lines.length}`,
    `Total: Q${publicCartTotal(lines)}`,
    "",
    "La disponibilidad y el costo de envío se confirman por WhatsApp.",
  ].join("\n");
  return guatemalaWhatsappUrl(message);
}

function reviewMessage(unavailable: number, repriced: number): string {
  if (unavailable === 0 && repriced === 0) return "";
  const parts: string[] = [];
  if (unavailable === 1) parts.push("Una prenda ya no está disponible y se quitó del carrito.");
  if (unavailable > 1) parts.push("Algunas prendas ya no están disponibles y se quitaron del carrito.");
  if (repriced === 1) parts.push("Cambió el precio de una prenda.");
  if (repriced > 1) parts.push("Cambiaron algunos precios.");
  parts.push("Revisa el pedido antes de enviarlo.");
  return parts.join(" ");
}

function cleanCartLine(value: unknown): PublicCartLine | null {
  if (!value || typeof value !== "object") return null;
  const line = value as Partial<PublicCartLine>;
  const id = typeof line.id === "string" ? line.id.trim() : "";
  const sku = typeof line.sku === "string" ? line.sku.trim() : "";
  const title = typeof line.title === "string" ? line.title.trim() : "";
  const size = typeof line.size === "string" ? line.size.trim() : "";
  const priceGtq = typeof line.priceGtq === "string" ? line.priceGtq.trim() : "";
  const cover = line.coverPhotoId;
  if (!id || id.length > 80 || !sku || sku.length > 80 || title.length > 160 || size.length > 40) return null;
  const price = quetzalText(priceGtq);
  if (!price) return null;
  if (cover != null && (typeof cover !== "string" || !cover.trim() || cover.length > 80)) return null;
  return { id, sku, title: title || "Prenda sin título", size, priceGtq: price, coverPhotoId: cover?.trim() ?? null };
}

function quetzalText(price: string): string | null {
  if (!/^\d+(\.\d{1,2})?$/.test(price)) return null;
  const [whole, frac = ""] = price.split(".");
  return `${whole}.${frac.padEnd(2, "0").slice(0, 2)}`;
}

function quetzalCents(price: string): number {
  const [whole, frac = "00"] = price.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
  return Number.isFinite(cents) ? cents : 0;
}
