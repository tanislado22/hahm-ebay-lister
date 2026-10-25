import { parseVintedItemLink } from "@/lib/vinted/inventory-match";
import {
  sameSkuText,
  skuText,
  type ActiveSkuListing,
  type SkuPhotoMatch,
} from "@/lib/vinted/listing-correction";

export interface ConfirmedVintedLinkInput {
  url: unknown;
  vintedUnlinkedAt?: string;
  discardedVintedUrl?: unknown;
}

export interface VintedLinkRecord {
  vintedItemId: string;
  url: string;
}

const NO_PREPARE = "No se preparó ningún artículo.";

export function uniqueActiveSkuListing(
  sku: unknown,
  listings: ActiveSkuListing[]
): { ok: true; match: SkuPhotoMatch } | { ok: false; error: string } {
  const wanted = skuText(sku);
  if (!wanted) return { ok: false, error: `Este registro no tiene SKU. ${NO_PREPARE}` };
  const matches: SkuPhotoMatch[] = [];
  const seen = new Set<string>();
  for (const listing of listings) {
    if (listing.active === false) continue;
    if (!sameSkuText(listing.sku, wanted)) continue;
    const ebayItemId = String(listing.ebayItemId || "").replace(/\D/g, "");
    const title = String(listing.title || "").trim();
    const photoUrl = String(listing.photoUrl || "").trim();
    const foundSku = skuText(listing.sku);
    const key = ebayItemId || `${foundSku}\n${title}\n${photoUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ sku: foundSku, title, photoUrl, ebayItemId });
  }
  if (matches.length === 0) {
    return { ok: false, error: `No hay una publicación activa con el SKU ${wanted}. ${NO_PREPARE}` };
  }
  if (matches.length > 1) {
    return { ok: false, error: `Hay ${matches.length} publicaciones activas con el SKU ${wanted}. ${NO_PREPARE}` };
  }
  return { ok: true, match: matches[0] };
}

export function confirmedVintedHref(input: ConfirmedVintedLinkInput): string {
  if (typeof input.url !== "string") return "";
  const parsed = parseVintedItemLink(input.url.trim());
  if (!parsed) return "";
  if (typeof input.discardedVintedUrl === "string" && input.vintedUnlinkedAt) {
    const discarded = parseVintedItemLink(input.discardedVintedUrl.trim());
    if (discarded && discarded.vintedItemId === parsed.vintedItemId) return "";
  }
  return parsed.url;
}

export function planVintedLinkSave(
  currentId: string,
  rawUrl: unknown,
  others: VintedLinkRecord[]
): { ok: true; url: string; linkedItemId: string } | { ok: false; error: string } {
  const id = currentId.trim();
  if (!id) return { ok: false, error: "No existe ese registro. No se guardó el enlace." };
  if (typeof rawUrl !== "string") {
    return { ok: false, error: "Ese enlace no es una publicación de Vinted. No se guardó el enlace." };
  }
  const parsed = parseVintedItemLink(rawUrl.trim());
  if (!parsed) {
    return { ok: false, error: "Ese enlace no es una publicación de Vinted. No se guardó el enlace." };
  }
  for (const other of others) {
    if (other.vintedItemId === id) continue;
    const otherLink = parseVintedItemLink(other.url);
    const sameItem = other.vintedItemId === parsed.vintedItemId || otherLink?.vintedItemId === parsed.vintedItemId;
    if (sameItem) {
      return { ok: false, error: "Ese enlace ya está asociado a otro registro. No se guardó el enlace." };
    }
  }
  return { ok: true, url: parsed.url, linkedItemId: parsed.vintedItemId };
}

export function editablePreparePrice(value: unknown): { ok: true; price: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "El precio no es válido. No se preparó ningún artículo." };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, price: "" };
  const match = trimmed.replace(/^\$/, "").match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return { ok: false, error: "El precio no es válido. No se preparó ningún artículo." };
  const cents = match[2] ? match[2].padEnd(2, "0") : "00";
  return { ok: true, price: `${match[1]}.${cents}` };
}
