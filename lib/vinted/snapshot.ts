import { skuForVintedPrepare } from "@/lib/sku";
import type { ListingResult } from "@/lib/types";
import { prepareVintedFields } from "@/lib/vinted/prepare";

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
    photos: input.photos.filter((photo) => Boolean(photo?.data)).slice(0, MAX_PHOTOS),
  };
}

export function replaceReadyItem(_previous: ReadySnapshot | null, next: ReadySnapshot): ReadySnapshot {
  return next;
}
