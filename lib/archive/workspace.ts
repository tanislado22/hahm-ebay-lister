import type { ItemGroup, ListingResult, Photo, VintedStatus } from "@/lib/types";
import { exactSku } from "@/lib/archive/text";
import { canArchivePublished } from "@/lib/archive/link";

export function archiveAccountKey(workMode: unknown, clientId: unknown): string | null {
  if (workMode === "client") {
    const id = typeof clientId === "string" ? clientId.trim() : "";
    if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return null;
    return `client:${id}`;
  }
  if (workMode == null || workMode === "store") return "store";
  return null;
}

export interface WorkspacePhotoInput {
  id: string;
  mediaType: string;
  data: string;
}

export function workspacePrice(value: ListingResult["suggested_price"] | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  if (typeof value === "string") return value.trim();
  return "";
}

export function workspaceArticleFromGroup(group: ItemGroup): {
  sku: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  ebayItemId: string;
  postStatus: string;
} {
  return {
    sku: exactSku(group.sku),
    title: group.listing?.title?.trim() || "",
    description: group.listing?.description || "",
    price: workspacePrice(group.listing?.suggested_price),
    currency: group.listing?.currency?.trim() || "",
    ebayItemId: exactSku(group.listingId),
    postStatus: group.postStatus || "",
  };
}

export function assertCanArchive(group: ItemGroup): string | null {
  if (!canArchivePublished(group.postStatus)) {
    return "Solo se archivan artículos ya publicados. Este sigue en el área de trabajo.";
  }
  if (!group.id?.trim()) return "Falta el identificador del artículo.";
  return null;
}

export function restoreGroup(input: {
  articleId: string;
  sourceJobId: string;
  sku: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  ebayItemId: string;
  ebayUrl: string;
  vintedStatus: string;
  vintedListingUrl: string;
  usaLotId?: string;
  unitCostCents?: number | null;
  costEstimated?: boolean;
  storedGroup: unknown;
  photoIds: string[];
}): ItemGroup {
  const stored = input.storedGroup && typeof input.storedGroup === "object" ? (input.storedGroup as Partial<ItemGroup>) : {};
  const listing = stored.listing ?? {
    title: input.title,
    description: input.description,
    suggested_price: input.price,
    currency: input.currency || undefined,
  };
  const vintedStatus = (stored.vintedStatus || input.vintedStatus || "not_prepared") as VintedStatus;
  return {
    ...stored,
    id: input.sourceJobId || stored.id || input.articleId,
    sku: typeof stored.sku === "string" && stored.sku !== "" ? stored.sku : input.sku,
    name: stored.name || input.title || input.sku || input.ebayItemId,
    photoIds: input.photoIds,
    listing,
    status: stored.status || "done",
    postStatus: stored.postStatus === "posted" || input.ebayItemId ? "posted" : stored.postStatus,
    listingId: stored.listingId || input.ebayItemId || undefined,
    vintedStatus,
    vintedListingUrl: stored.vintedListingUrl || input.vintedListingUrl || undefined,
    usaLotId: input.usaLotId || stored.usaLotId || undefined,
    unitCostCents: input.unitCostCents ?? stored.unitCostCents,
    costEstimated: input.costEstimated || stored.costEstimated || false,
  };
}

export function photoForWorkspace(photo: {
  id: string;
  mediaType: string;
  bytes: string;
  url: string;
}): Photo {
  if (photo.bytes) {
    const mediaType = photo.mediaType || "image/jpeg";
    return {
      id: photo.id,
      mediaType,
      data: photo.bytes,
      previewUrl: `data:${mediaType};base64,${photo.bytes}`,
    };
  }
  return {
    id: photo.id,
    mediaType: photo.mediaType || "image/jpeg",
    data: "",
    previewUrl: photo.url,
  };
}
