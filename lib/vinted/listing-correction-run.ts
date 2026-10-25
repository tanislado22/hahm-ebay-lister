import { fetchActiveSellerCatalog } from "@/lib/ebay/seller-listings";
import {
  confirmPhotoMatchesPreview,
  selectUniqueActiveSkuPhoto,
  type SkuPhotoMatch,
} from "@/lib/vinted/listing-correction";
import { getVintedLinkForCorrection, saveVintedLocalPhoto } from "@/lib/vinted/inventory-store";

function activeListings(rows: Awaited<ReturnType<typeof fetchActiveSellerCatalog>>) {
  return rows.map((listing) => ({
    sku: listing.sku,
    title: listing.title,
    photoUrl: listing.photoUrl,
    ebayItemId: listing.itemId,
    active: true as const,
  }));
}

export async function lookupActiveSkuPhoto(
  accessToken: string | null,
  vintedItemId: string
): Promise<{ ok: true; match: SkuPhotoMatch } | { ok: false; error: string }> {
  const id = vintedItemId.trim();
  if (!id) return { ok: false, error: "No existe ese registro. No se cambió la foto." };
  const row = await getVintedLinkForCorrection(id);
  if (!row) return { ok: false, error: "No existe ese registro. No se cambió la foto." };
  if (row.archivedAt) return { ok: false, error: "Ese registro está archivado. No se cambió la foto." };
  if (!accessToken) return { ok: false, error: "eBay no está conectado. No se cambió la foto." };
  let listings;
  try {
    listings = await fetchActiveSellerCatalog(accessToken);
  } catch {
    return { ok: false, error: "No se pudo consultar tu cuenta de eBay. No se cambió la foto." };
  }
  return selectUniqueActiveSkuPhoto(row.sku, activeListings(listings));
}

export async function confirmLocalPhotoFromEbay(
  accessToken: string | null,
  input: { vintedItemId: string; sku: unknown; ebayItemId: unknown }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const found = await lookupActiveSkuPhoto(accessToken, input.vintedItemId);
  if (!found.ok) return found;
  if (!confirmPhotoMatchesPreview(found.match, { sku: input.sku, ebayItemId: input.ebayItemId })) {
    return { ok: false, error: "Esa publicación ya no es la única coincidencia activa. No se cambió la foto." };
  }
  return saveVintedLocalPhoto(input.vintedItemId, found.match.photoUrl);
}
