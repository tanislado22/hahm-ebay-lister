import { exactGuatemalaSku } from "@/lib/markets/guatemala";

export const GUATEMALA_INVENTORY_STATUS = "disponible" as const;

export const GUATEMALA_INVENTORY_MESSAGES = {
  skuRequired: "Escribe el SKU antes de guardar.",
  priceInvalid: "Escribe un precio válido en quetzales.",
  photosRequired: "Agrega al menos una foto antes de guardar.",
  notGuatemala: "Este inventario pertenece solo a Tienda Guatemala.",
  missingItem: "No se identificó la prenda.",
  saved: "Prenda guardada en el inventario.",
  already: "Esta prenda ya está en el inventario.",
  retry: "No se pudo guardar la prenda. Inténtalo de nuevo.",
} as const;

const CONDITION_LABELS: Record<string, string> = {
  NEW_WITH_TAGS: "Nueva con etiqueta",
  NEW_NO_TAGS: "Nueva sin etiqueta",
  EXCELLENT: "Usada · Excelente",
  VERY_GOOD: "Usada · Muy buena",
  GOOD: "Usada · Buena",
  FAIR: "Usada · Regular",
};

export interface InventoryPhoto {
  id: string;
  mediaType: string;
  data: string;
}

export interface PreparedInventoryItem {
  clientId: string;
  sourceGroupId: string;
  sku: string;
  title: string;
  description: string;
  brand: string;
  size: string;
  condition: string;
  priceGtq: string;
  photos: InventoryPhoto[];
}

export interface StoredInventoryItem extends PreparedInventoryItem {
  id: string;
  status: typeof GUATEMALA_INVENTORY_STATUS;
}

type PrepareResult =
  | { ok: true; item: PreparedInventoryItem }
  | { ok: false; status: 400; error: string };

export function guatemalaConditionLabel(value: string): string {
  const text = value.trim();
  if (!text) return "";
  return CONDITION_LABELS[text] ?? text.replace(/_/g, " ");
}

export function formatStoredQuetzales(value: string): string {
  return `Q${value}`;
}

// A quetzal amount with at most two decimals. Zero and blank values are rejected.
// The SKU never passes through this function.
export function quetzalPriceText(value: unknown): string | null {
  if (typeof value === "number") return priceFromNumber(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function priceFromNumber(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 1e-6) return null;
  const whole = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function textField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function prepareInventorySave(input: {
  clientId?: unknown;
  sourceGroupId?: unknown;
  sku?: unknown;
  title?: unknown;
  description?: unknown;
  brand?: unknown;
  size?: unknown;
  condition?: unknown;
  price?: unknown;
  photos?: unknown;
}): PrepareResult {
  const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
  const sourceGroupId = typeof input.sourceGroupId === "string" ? input.sourceGroupId.trim() : "";
  if (!clientId || !sourceGroupId) {
    return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.missingItem };
  }
  const sku = exactGuatemalaSku(input.sku);
  if (sku.trim() === "") {
    return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.skuRequired };
  }
  const priceGtq = quetzalPriceText(input.price);
  if (!priceGtq) {
    return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.priceInvalid };
  }
  const photos = normalizePhotos(input.photos);
  if (photos.length === 0) {
    return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.photosRequired };
  }
  return {
    ok: true,
    item: {
      clientId,
      sourceGroupId,
      sku,
      title: textField(input.title),
      description: textField(input.description),
      brand: textField(input.brand),
      size: textField(input.size),
      condition: textField(input.condition),
      priceGtq,
      photos,
    },
  };
}

function normalizePhotos(value: unknown): InventoryPhoto[] {
  if (!Array.isArray(value)) return [];
  const photos: InventoryPhoto[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const mediaType = "mediaType" in entry ? entry.mediaType : "";
    const data = "data" in entry ? entry.data : "";
    if (typeof mediaType !== "string" || !mediaType.startsWith("image/")) continue;
    if (typeof data !== "string" || data.trim() === "") continue;
    photos.push({
      id: crypto.randomUUID(),
      mediaType,
      data,
    });
  }
  return photos;
}

export function skuBelongsToAnotherItem(sku: string): string {
  return `El SKU ${sku} ya pertenece a otra prenda. Elige un SKU diferente.`;
}

export function alreadyStoredWithSku(sku: string): string {
  return `Esta prenda ya está en el inventario con el SKU ${sku}. No se reemplazó.`;
}

export type InventorySaveDecision =
  | { action: "insert" }
  | { action: "already_saved"; item: StoredInventoryItem }
  | { action: "reject"; status: 409; error: string };

// A repeated save of the same prenda returns the stored row unchanged.
// A different prenda with the same SKU is rejected and nothing is replaced.
export function resolveInventoryInsert(
  incoming: PreparedInventoryItem,
  existingBySource: StoredInventoryItem | null,
  existingBySku: StoredInventoryItem | null
): InventorySaveDecision {
  if (existingBySource) {
    if (existingBySource.sku === incoming.sku) {
      return { action: "already_saved", item: existingBySource };
    }
    return { action: "reject", status: 409, error: alreadyStoredWithSku(existingBySource.sku) };
  }
  if (existingBySku && existingBySku.sourceGroupId !== incoming.sourceGroupId) {
    return { action: "reject", status: 409, error: skuBelongsToAnotherItem(incoming.sku) };
  }
  return { action: "insert" };
}

export function inventorySearchMatches(
  item: { sku: string; title: string },
  query: string
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return item.sku.toLowerCase().includes(needle) || item.title.toLowerCase().includes(needle);
}

export function inventoryLikePattern(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";
  return `%${trimmed.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export function availableGarmentLabel(count: number): string {
  return count === 1 ? "1 prenda disponible" : `${count} prendas disponibles`;
}
