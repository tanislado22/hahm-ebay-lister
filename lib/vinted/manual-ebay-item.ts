import { cleanEbayItemId } from "@/lib/vinted/card-text";

export interface AccountEbayListing {
  ebayItemId: string;
  sku: string;
  title?: string;
}

export type ManualEbayItemPlan =
  | { ok: false; error: string }
  | { ok: true; ebayItemId: string; suggestedSku: string; title: string; detail: string };

export function planManualEbayItem(rawItemId: string, accountListings: AccountEbayListing[]): ManualEbayItemPlan {
  const ebayItemId = cleanEbayItemId(rawItemId);
  if (!ebayItemId) return { ok: false, error: "El Item ID de eBay debe tener entre 10 y 15 dígitos." };
  const matches = accountListings.filter((listing) => cleanEbayItemId(listing.ebayItemId) === ebayItemId);
  if (!matches.length) {
    return { ok: false, error: "Ese Item ID no está en las publicaciones activas de tu cuenta de eBay. No se guardó." };
  }
  const skus = [...new Set(matches.map((listing) => listing.sku.trim()).filter(Boolean))];
  if (skus.length !== 1) {
    return {
      ok: true,
      ebayItemId,
      suggestedSku: "",
      title: "",
      detail: "Item ID de tu cuenta guardado. El SKU no se pudo verificar; la asociación queda pendiente.",
    };
  }
  const title = matches.find((listing) => listing.sku.trim() === skus[0])?.title?.trim() || "";
  return {
    ok: true,
    ebayItemId,
    suggestedSku: skus[0],
    title,
    detail: "Item ID de tu cuenta. Confirma el SKU para asociarlo.",
  };
}
