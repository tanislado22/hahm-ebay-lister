import { fetchActiveItemDraft, type ActiveItemDraft } from "@/lib/ebay/active-item-draft";
import { fetchActiveSellerCatalog } from "@/lib/ebay/seller-listings";
import { setVintedCurrentSku } from "@/lib/inventory/links";
import { workspaceKey } from "@/lib/inventory/workspace";
import type { ListingResult } from "@/lib/types";
import { resolveVintedCategory, formatVintedCategoryPath } from "@/lib/vinted/category-map";
import { descriptionWithRealSku } from "@/lib/vinted/prepare";
import {
  confirmedVintedHref,
  editablePreparePrice,
  planVintedLinkSave,
  uniqueActiveSkuListing,
} from "@/lib/vinted/prepare-listing";
import { sameSkuText, skuText } from "@/lib/vinted/listing-correction";
import {
  getVintedLinkForCorrection,
  listVintedLinkTargets,
  saveConfirmedVintedLink,
} from "@/lib/vinted/inventory-store";
import { buildReadySnapshot } from "@/lib/vinted/snapshot";
import { replaceVintedReadySnapshot } from "@/lib/vinted/snapshot-store";

const NO_PREPARE = "No se preparó ningún artículo.";
const MAX_PHOTOS = 12;
const MAX_PHOTO_BYTES = 7 * 1024 * 1024;

export interface PrepareDraft {
  sku: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  photoUrls: string[];
  ebayItemId: string;
  brand: string;
  size: string;
  color: string;
  condition: string;
  category: string;
  hasConfirmedVintedLink: boolean;
  confirmedVintedUrl: string;
}

function catalogRows(rows: Awaited<ReturnType<typeof fetchActiveSellerCatalog>>) {
  return rows.map((listing) => ({
    sku: listing.sku,
    title: listing.title,
    photoUrl: listing.photoUrl,
    ebayItemId: listing.itemId,
    active: true as const,
  }));
}

async function loadUniqueDraft(
  accessToken: string,
  sku: string
): Promise<{ ok: true; draft: ActiveItemDraft } | { ok: false; error: string }> {
  let listings;
  try {
    listings = await fetchActiveSellerCatalog(accessToken);
  } catch {
    return { ok: false, error: `No se pudo consultar tu cuenta de eBay. ${NO_PREPARE}` };
  }
  const selected = uniqueActiveSkuListing(sku, catalogRows(listings));
  if (!selected.ok) return selected;
  let detail: ActiveItemDraft | null;
  try {
    detail = await fetchActiveItemDraft(accessToken, selected.match.ebayItemId);
  } catch {
    return { ok: false, error: `No se pudo leer la publicación activa. ${NO_PREPARE}` };
  }
  if (!detail || !detail.active || !sameSkuText(detail.sku, sku) || detail.itemId !== selected.match.ebayItemId) {
    return { ok: false, error: `La publicación activa ya no coincide con el SKU ${skuText(sku)}. ${NO_PREPARE}` };
  }
  return { ok: true, draft: detail };
}

export async function lookupPrepareDraft(
  accessToken: string | null,
  vintedItemId: string
): Promise<{ ok: true; draft: PrepareDraft } | { ok: false; error: string }> {
  const row = await getVintedLinkForCorrection(vintedItemId.trim());
  if (!row) return { ok: false, error: `No existe ese registro. ${NO_PREPARE}` };
  if (row.archivedAt) return { ok: false, error: `Ese registro está archivado. ${NO_PREPARE}` };
  if (!accessToken) return { ok: false, error: `eBay no está conectado. ${NO_PREPARE}` };
  const found = await loadUniqueDraft(accessToken, row.sku);
  if (!found.ok) return found;
  const confirmedVintedUrl = confirmedVintedHref({
    url: row.url,
    vintedUnlinkedAt: row.vintedUnlinkedAt,
    discardedVintedUrl: row.discardedVintedUrl,
  });
  return {
    ok: true,
    draft: {
      sku: found.draft.sku,
      title: found.draft.title,
      description: found.draft.description,
      price: found.draft.price,
      currency: found.draft.currency || "USD",
      photoUrls: found.draft.photoUrls,
      ebayItemId: found.draft.itemId,
      brand: found.draft.brand,
      size: found.draft.size,
      color: found.draft.color,
      condition: found.draft.condition,
      category: found.draft.category,
      hasConfirmedVintedLink: Boolean(confirmedVintedUrl),
      confirmedVintedUrl,
    },
  };
}

function mediaTypeFor(url: string, header: string | null): string {
  if (header && /^image\//i.test(header)) return header.split(";")[0].trim();
  if (/\.png($|\?)/i.test(url)) return "image/png";
  if (/\.webp($|\?)/i.test(url)) return "image/webp";
  return "image/jpeg";
}

async function downloadPhoto(url: string): Promise<{ mediaType: string; data: string } | null> {
  if (!/^https:\/\/(?:[a-z0-9-]+\.)*(?:ebayimg|ebaystatic)\.com\//i.test(url)) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES) return null;
  return {
    mediaType: mediaTypeFor(url, response.headers.get("content-type")),
    data: bytes.toString("base64"),
  };
}

export async function commitPrepareDraft(
  accessToken: string | null,
  input: {
    vintedItemId: string;
    sku: unknown;
    ebayItemId: unknown;
    title: unknown;
    description: unknown;
    price: unknown;
  }
): Promise<{ ok: true; sku: string; photoCount: number; missingPhotos: number } | { ok: false; error: string }> {
  if (typeof input.sku !== "string" || typeof input.ebayItemId !== "string") {
    return { ok: false, error: `Esa publicación ya no es la única coincidencia activa. ${NO_PREPARE}` };
  }
  if (typeof input.title !== "string" || !input.title.trim()) {
    return { ok: false, error: `El título está vacío. ${NO_PREPARE}` };
  }
  if (typeof input.description !== "string") {
    return { ok: false, error: `La descripción no es válida. ${NO_PREPARE}` };
  }
  const price = editablePreparePrice(input.price);
  if (!price.ok) return price;
  const looked = await lookupPrepareDraft(accessToken, input.vintedItemId);
  if (!looked.ok) return looked;
  if (!sameSkuText(looked.draft.sku, input.sku) || looked.draft.ebayItemId !== input.ebayItemId.replace(/\D/g, "")) {
    return { ok: false, error: `Esa publicación ya no es la única coincidencia activa. ${NO_PREPARE}` };
  }
  const photos = [];
  for (const url of looked.draft.photoUrls.slice(0, MAX_PHOTOS)) {
    try {
      const photo = await downloadPhoto(url);
      if (photo) photos.push(photo);
    } catch {
      /* one photo does not change the listing */
    }
  }
  const listing: ListingResult = {
    title: input.title.trim(),
    description: descriptionWithRealSku(input.description, looked.draft.sku),
    suggested_price: price.price,
    brand: looked.draft.brand,
    size: looked.draft.size,
    color: looked.draft.color,
    condition: looked.draft.condition,
    category: looked.draft.category,
    item_type: "",
  };
  const category = resolveVintedCategory({
    title: listing.title,
    brand: listing.brand,
    itemType: "",
    bucket: listing.category,
  });
  const snapshot = buildReadySnapshot({
    sku: looked.draft.sku,
    listing: {
      ...listing,
      category: category ? formatVintedCategoryPath(category.path) : "",
    },
    photos,
  });
  if (snapshot.sku !== looked.draft.sku) {
    return { ok: false, error: `No se pudo conservar el SKU ${looked.draft.sku}. ${NO_PREPARE}` };
  }
  const workspace = workspaceKey("store", null);
  if (!workspace) return { ok: false, error: `No se pudo preparar el artículo. ${NO_PREPARE}` };
  await replaceVintedReadySnapshot(workspace, snapshot);
  await setVintedCurrentSku(workspace, snapshot.sku);
  return {
    ok: true,
    sku: snapshot.sku,
    photoCount: snapshot.photos.length,
    missingPhotos: Math.max(0, looked.draft.photoUrls.length - snapshot.photos.length),
  };
}

export async function saveInventoryVintedLink(
  vintedItemId: string,
  rawUrl: unknown
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const id = vintedItemId.trim();
  const row = await getVintedLinkForCorrection(id);
  if (!row) return { ok: false, error: "No existe ese registro. No se guardó el enlace." };
  if (row.archivedAt) return { ok: false, error: "Ese registro está archivado. No se guardó el enlace." };
  const others = await listVintedLinkTargets();
  const plan = planVintedLinkSave(id, rawUrl, others);
  if (!plan.ok) return plan;
  const saved = await saveConfirmedVintedLink(id, plan);
  if (!saved.ok) return saved;
  return { ok: true, url: plan.url };
}
