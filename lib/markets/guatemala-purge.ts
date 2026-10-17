import type { SaleActor } from "@/lib/markets/guatemala-inventory";

export const GUATEMALA_PURGE_MESSAGES = {
  forbidden: "No puedes eliminar prendas del inventario.",
  empty: "Elige al menos una prenda.",
  confirm: "Escribe el texto de confirmación exactamente como aparece.",
  stale: "El inventario cambió. Revisa otra vez la lista antes de eliminar.",
  notFound: "Alguna prenda ya no está en Tienda Guatemala.",
} as const;

export interface PurgePhoto {
  id: string;
  position: number;
}

export interface PurgeSale {
  id: string;
  sku: string;
  publishedPriceGtq: string;
  chargedPriceGtq: string;
  currentChargedPriceGtq: string | null;
  soldAt: string;
  isTest: boolean;
  voidedAt: string | null;
  soldByRole: "propietario" | "encargado" | null;
  soldByUsername: string | null;
}

export interface PurgeCorrection {
  id: string;
  saleId: string;
  action: "corregir" | "anular";
  previousChargedPriceGtq: string;
  newChargedPriceGtq: string | null;
  reason: string;
  createdAt: string;
  actorRole: "propietario";
}

export interface PurgeGarment {
  id: string;
  clientId: string;
  sku: string;
  title: string;
  status: "disponible" | "vendida";
  priceGtq: string;
  suggested: boolean;
  photos: PurgePhoto[];
  sales: PurgeSale[];
  corrections: PurgeCorrection[];
}

export interface PurgeCounts {
  garments: number;
  photos: number;
  sales: number;
  corrections: number;
}

export function purgeConfirmText(garments: readonly { sku: string }[]): string {
  const skus = [...new Set(garments.map((garment) => garment.sku))].sort((left, right) =>
    left.localeCompare(right, "es")
  );
  return skus.length ? `ELIMINAR ${skus.join(", ")}` : "";
}

export function purgeCounts(garments: readonly PurgeGarment[]): PurgeCounts {
  return {
    garments: garments.length,
    photos: garments.reduce((sum, garment) => sum + garment.photos.length, 0),
    sales: garments.reduce((sum, garment) => sum + garment.sales.length, 0),
    corrections: garments.reduce((sum, garment) => sum + garment.corrections.length, 0),
  };
}

export function samePurgeCounts(left: PurgeCounts, right: PurgeCounts): boolean {
  return (
    left.garments === right.garments &&
    left.photos === right.photos &&
    left.sales === right.sales &&
    left.corrections === right.corrections
  );
}

export function selectPurgeGarments(
  garments: readonly PurgeGarment[],
  clientId: string,
  itemIds: readonly string[]
): { ok: true; garments: PurgeGarment[] } | { ok: false; status: 400 | 404; error: string } {
  const wanted = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
  if (wanted.length === 0) {
    return { ok: false, status: 400, error: GUATEMALA_PURGE_MESSAGES.empty };
  }
  const selected = wanted.map((id) => garments.find((garment) => garment.id === id && garment.clientId === clientId));
  if (selected.some((garment) => !garment)) {
    return { ok: false, status: 404, error: GUATEMALA_PURGE_MESSAGES.notFound };
  }
  return { ok: true, garments: selected as PurgeGarment[] };
}

export function applyGuatemalaPurge(
  garments: readonly PurgeGarment[],
  input: {
    owner: boolean;
    clientId: string;
    itemIds: readonly string[];
    confirmText: string;
    expected: PurgeCounts;
    actor?: SaleActor | null;
  }
): { garments: PurgeGarment[]; result: { ok: true; removed: PurgeGarment[] } | { ok: false; status: 400 | 403 | 404 | 409; error: string } } {
  if (!input.owner || input.actor?.role === "encargado") {
    return { garments: [...garments], result: { ok: false, status: 403, error: GUATEMALA_PURGE_MESSAGES.forbidden } };
  }
  const selected = selectPurgeGarments(garments, input.clientId, input.itemIds);
  if (!selected.ok) return { garments: [...garments], result: selected };
  if (input.confirmText !== purgeConfirmText(selected.garments)) {
    return { garments: [...garments], result: { ok: false, status: 400, error: GUATEMALA_PURGE_MESSAGES.confirm } };
  }
  if (!samePurgeCounts(input.expected, purgeCounts(selected.garments))) {
    return { garments: [...garments], result: { ok: false, status: 409, error: GUATEMALA_PURGE_MESSAGES.stale } };
  }
  const ids = new Set(selected.garments.map((garment) => garment.id));
  return {
    garments: garments.filter((garment) => !ids.has(garment.id)),
    result: { ok: true, removed: selected.garments },
  };
}
