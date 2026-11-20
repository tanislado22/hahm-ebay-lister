import { skuForVintedPrepare } from "@/lib/sku";
import type { ListingResult } from "@/lib/types";
import { prepareVintedFields, type VintedPrepared } from "@/lib/vinted/prepare";

export interface ReadyPhoto {
  mediaType?: string;
  data?: string;
}

export interface ReadySnapshot {
  sku: string;
  title: string;
  description: string;
  price: string;
  brand: string;
  category: string;
  itemType: string;
  size: string;
  color: string;
  condition: string;
  photos: ReadyPhoto[];
}

const MAX_PHOTOS = 20;

function withPhotos(photos: ReadyPhoto[]): ReadyPhoto[] {
  return photos
    .filter((photo) => Boolean(photo?.data && String(photo.data).trim()))
    .slice(0, MAX_PHOTOS);
}

export function buildReadySnapshot(input: {
  sku: string;
  listing: ListingResult;
  photos: ReadyPhoto[];
}): ReadySnapshot {
  const sku = skuForVintedPrepare(input.sku);
  if (!sku) throw new Error("The selected item needs a SKU.");
  const fields = prepareVintedFields(sku, input.listing);
  return {
    sku,
    title: fields.title,
    description: fields.description,
    price: fields.price,
    brand: fields.brand,
    category: fields.vintedCategory || fields.category,
    itemType: (input.listing.item_type ?? "").trim(),
    size: fields.size,
    color: fields.color,
    condition: fields.condition,
    photos: withPhotos(input.photos),
  };
}

export function buildReadySnapshotFromPrepared(input: {
  prepared: VintedPrepared;
  photos: ReadyPhoto[];
  itemType?: string;
}): ReadySnapshot {
  const sku = skuForVintedPrepare(input.prepared.sku);
  if (!sku) throw new Error("The selected item needs a SKU.");
  return {
    sku,
    title: (input.prepared.title ?? "").trim(),
    description: (input.prepared.description ?? "").trim(),
    price: (input.prepared.price ?? "").trim(),
    brand: (input.prepared.brand ?? "").trim(),
    category: (input.prepared.vintedCategory || input.prepared.category || "").trim(),
    itemType: (input.itemType ?? "").trim(),
    size: (input.prepared.size ?? "").trim(),
    color: (input.prepared.color ?? "").trim(),
    condition: (input.prepared.condition ?? "").trim(),
    photos: withPhotos(input.photos),
  };
}

export function replaceReadyItem(_previous: ReadySnapshot | null, next: ReadySnapshot): ReadySnapshot {
  return next;
}
