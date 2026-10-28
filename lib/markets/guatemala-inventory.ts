import { exactGuatemalaSku } from "@/lib/markets/guatemala";
import { GARMENT_KIND_CHOICES } from "@/lib/markets/guatemala-price-match";

export const GUATEMALA_INVENTORY_STATUS = "disponible" as const;
export const GUATEMALA_SOLD_STATUS = "vendida" as const;
export const GUATEMALA_WITHDRAWN_STATUS = "retirada" as const;

export type InventoryItemStatus =
  | typeof GUATEMALA_INVENTORY_STATUS
  | typeof GUATEMALA_SOLD_STATUS
  | typeof GUATEMALA_WITHDRAWN_STATUS;

export type InventoryListFilter = "disponibles" | "vendidas" | "retiradas" | "todas" | "pendientes";

export const GUATEMALA_SALE_MESSAGES = {
  priceInvalid: "Escribe un precio cobrado mayor que cero.",
  alreadySold: "Esta prenda ya fue vendida.",
  notFound: "No se encontró la prenda.",
  registered: "Venta registrada.",
} as const;

export const GUATEMALA_INVENTORY_MESSAGES = {
  skuRequired: "Escribe el SKU antes de guardar.",
  skuInUse: "Este número SKU ya está en uso. Usa otro número para este artículo",
  priceInvalid: "Escribe un precio válido en quetzales.",
  photosRequired: "Agrega al menos una foto antes de guardar.",
  notGuatemala: "Este inventario pertenece solo a Tienda Guatemala.",
  missingItem: "No se identificó la prenda.",
  saved: "Prenda guardada en el inventario.",
  already: "Esta prenda ya está en el inventario.",
  retry: "No se pudo guardar la prenda. Inténtalo de nuevo.",
  typeRequired: "Elige el tipo de artículo.",
  lotRequired: "Elige el lote correspondiente.",
  sizeLong: "La talla es demasiado larga.",
  titleRequired: "Escribe el nombre del artículo.",
  titleLong: "El nombre del artículo es demasiado largo.",
  descriptionLong: "La descripción es demasiado larga.",
  brandLong: "La marca es demasiado larga.",
  conditionInvalid: "Elige una condición de la lista.",
  unpublishedSaved: "Artículo guardado. Quedó disponible y sin publicar.",
  draftSaved: "Cambios guardados. El artículo sigue sin publicar.",
  draftPublished: "El artículo quedó publicado.",
  notPending: "Este artículo no está pendiente de publicar.",
} as const;

const UNPUBLISHED_TYPE_LABELS: Record<string, string> = {
  blusa: "Blusa",
  pantalon: "Pantalón",
  zapato: "Zapatos",
  gorra: "Gorra",
  bolso: "Cartera",
};

const PREFERRED_UNPUBLISHED_TYPES = ["blusa", "pantalon", "zapato", "gorra", "bolso"];

function unpublishedTypeLabel(id: string, fallback: string): string {
  return UNPUBLISHED_TYPE_LABELS[id] ?? `${fallback.charAt(0).toLocaleUpperCase("es")}${fallback.slice(1)}`;
}

export const UNPUBLISHED_ITEM_TYPES = (() => {
  const labels = new Map(
    GARMENT_KIND_CHOICES.map((choice) => [choice.key, unpublishedTypeLabel(choice.key, choice.label)])
  );
  const preferred = PREFERRED_UNPUBLISHED_TYPES.filter((id) => labels.has(id));
  const rest = [...labels.keys()].filter((id) => !preferred.includes(id));
  return [...preferred, ...rest].map((id) => ({ id, label: labels.get(id) ?? id }));
})();

export function unpublishedItemType(value: unknown): { id: string; label: string } | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return UNPUBLISHED_ITEM_TYPES.find((entry) => entry.id === id) ?? null;
}

const CONDITION_LABELS: Record<string, string> = {
  NEW_WITH_TAGS: "Nueva con etiqueta",
  NEW_NO_TAGS: "Nueva sin etiqueta",
  EXCELLENT: "Usada · Excelente",
  VERY_GOOD: "Usada · Muy buena",
  GOOD: "Usada · Buena",
  FAIR: "Usada · Regular",
};

export const GUATEMALA_CONDITION_CHOICES = Object.entries(CONDITION_LABELS).map(([value, label]) => ({
  value,
  label,
}));

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
  lotId?: string | null;
  createdBy?: SaleActor | null;
}

export interface PreparedUnpublishedItem {
  clientId: string;
  sku: string;
  itemType: string;
  title: string;
  size: string;
  priceGtq: string;
  lotId: string;
}

export interface PreparedDraftUpdate {
  title: string;
  description: string;
  brand: string;
  size: string;
  condition: string;
  priceGtq: string;
  photos: InventoryPhoto[];
}

export interface SaleCorrectionView {
  id: string;
  action: "corregir" | "anular";
  previousChargedPriceGtq: string;
  newChargedPriceGtq: string | null;
  reason: string;
  createdAt: string;
  actorRole: "propietario";
  actorUsername: string | null;
}

export interface GuatemalaSaleSnapshot {
  id?: string;
  sku: string;
  publishedPriceGtq: string;
  chargedPriceGtq: string;
  originalChargedPriceGtq?: string;
  soldAt: string;
  isTest?: boolean;
  voidedAt?: string | null;
  soldByRole?: "propietario" | "encargado" | null;
  soldByUsername?: string | null;
  corrections?: SaleCorrectionView[];
}

export interface PublicationEventView {
  action: "retirar" | "corregir" | "republicar" | "publicar";
  actorRole: "propietario" | "encargado";
  actorUsername: string | null;
  createdAt: string;
}

export interface StoredInventoryItem extends PreparedInventoryItem {
  id: string;
  status: InventoryItemStatus;
  sale?: GuatemalaSaleSnapshot | null;
  costGtq?: string | null;
  costIncludesPhotography?: boolean;
  publicationEvents?: PublicationEventView[];
  published?: boolean;
}

export const GUATEMALA_COST_MESSAGES = {
  invalid: "Escribe un costo mayor que cero, o déjalo vacío si todavía no lo conoces.",
  saved: "Costo guardado.",
  notFound: "No se encontró la prenda.",
} as const;

// Blank clears the cost. Zero is not a stand-in for "aún no lo sé".
export function prepareGarmentCost(input: {
  cost?: unknown;
  includesPhotography?: unknown;
}):
  | { ok: true; costGtq: string | null; includesPhotography: boolean }
  | { ok: false; status: 400; error: string } {
  const raw = typeof input.cost === "number" ? input.cost : typeof input.cost === "string" ? input.cost.trim() : input.cost;
  if (raw == null || raw === "") {
    return { ok: true, costGtq: null, includesPhotography: false };
  }
  const costGtq = quetzalPriceText(raw);
  if (!costGtq) {
    return { ok: false, status: 400, error: GUATEMALA_COST_MESSAGES.invalid };
  }
  return {
    ok: true,
    costGtq,
    includesPhotography: input.includesPhotography === true,
  };
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
  lotId?: unknown;
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
      lotId: typeof input.lotId === "string" && input.lotId.trim() ? input.lotId.trim() : null,
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

const SIZE_MAX = 40;
const TITLE_MAX = 140;
const DESCRIPTION_MAX = 4000;
const BRAND_MAX = 80;

export function prepareUnpublishedItem(input: {
  clientId?: unknown;
  sku?: unknown;
  itemType?: unknown;
  size?: unknown;
  price?: unknown;
  lotId?: unknown;
}): { ok: true; item: PreparedUnpublishedItem } | { ok: false; status: 400; error: string } {
  const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
  if (!clientId) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.missingItem };
  const sku = exactGuatemalaSku(input.sku).trim();
  if (!sku) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.skuRequired };
  const itemType = unpublishedItemType(input.itemType);
  if (!itemType) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.typeRequired };
  const size = typeof input.size === "string" ? input.size.trim() : "";
  if (size.length > SIZE_MAX) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.sizeLong };
  const priceGtq = quetzalPriceText(input.price);
  if (!priceGtq) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.priceInvalid };
  const lotId = typeof input.lotId === "string" ? input.lotId.trim() : "";
  if (!lotId) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.lotRequired };
  return {
    ok: true,
    item: { clientId, sku, itemType: itemType.id, title: itemType.label, size, priceGtq, lotId },
  };
}

export function prepareDraftUpdate(input: {
  title?: unknown;
  description?: unknown;
  brand?: unknown;
  size?: unknown;
  condition?: unknown;
  price?: unknown;
  photos?: unknown;
}): { ok: true; draft: PreparedDraftUpdate } | { ok: false; status: 400; error: string } {
  const title = textField(input.title).trim();
  if (!title) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.titleRequired };
  if (title.length > TITLE_MAX) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.titleLong };
  const description = textField(input.description).trim();
  if (description.length > DESCRIPTION_MAX) {
    return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.descriptionLong };
  }
  const brand = textField(input.brand).trim();
  if (brand.length > BRAND_MAX) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.brandLong };
  const size = textField(input.size).trim();
  if (size.length > SIZE_MAX) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.sizeLong };
  const condition = textField(input.condition).trim();
  if (condition && !GUATEMALA_CONDITION_CHOICES.some((choice) => choice.value === condition)) {
    return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.conditionInvalid };
  }
  const priceGtq = quetzalPriceText(input.price);
  if (!priceGtq) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.priceInvalid };
  return {
    ok: true,
    draft: {
      title,
      description,
      brand,
      size,
      condition,
      priceGtq,
      photos: normalizePhotos(input.photos),
    },
  };
}

export function isPendingPublication(item: { status: string; published?: boolean }): boolean {
  return item.status === GUATEMALA_INVENTORY_STATUS && item.published === false;
}

export function isSoldWithoutPublishing(item: { status: string; published?: boolean }): boolean {
  return item.status === GUATEMALA_SOLD_STATUS && item.published === false;
}

export function skuBelongsToAnotherItem(_sku: string): string {
  return GUATEMALA_INVENTORY_MESSAGES.skuInUse;
}

// Editing the original article keeps the stored text. A requested replacement is ignored.
export function preservedGuatemalaSku(storedSku: string, _requested?: unknown): string {
  return storedSku;
}

export interface DuplicateSkuReport {
  sku: string;
  itemIds: string[];
}

// Reports earlier duplicates. The input list is not changed.
export function reportDuplicateSkus(
  items: { id: string; clientId: string; sku: string }[],
  clientId: string
): DuplicateSkuReport[] {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    if (item.clientId !== clientId) continue;
    const ids = groups.get(item.sku);
    if (ids) ids.push(item.id);
    else groups.set(item.sku, [item.id]);
  }
  return [...groups.entries()]
    .filter(([, itemIds]) => itemIds.length > 1)
    .map(([sku, itemIds]) => ({ sku, itemIds }))
    .sort((left, right) => (left.sku < right.sku ? -1 : left.sku > right.sku ? 1 : 0));
}

export function duplicateSkuReportMessage(groups: { sku: string }[]): string {
  if (groups.length === 0) return "";
  return `Estos SKU ya están repetidos: ${groups.map((group) => group.sku).join(", ")}. No se borró ni se cambió ningún artículo.`;
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

export function inventoryListFilter(value: unknown): InventoryListFilter {
  if (
    value === "vendidas" ||
    value === "retiradas" ||
    value === "todas" ||
    value === "disponibles" ||
    value === "pendientes"
  ) {
    return value;
  }
  return "disponibles";
}

export function guatemalaInventoryStatusLabel(status: string, published: boolean | undefined = true): string {
  if (status === GUATEMALA_SOLD_STATUS && published === false) return "Vendida · Sin publicar";
  if (status === GUATEMALA_SOLD_STATUS) return "Vendida";
  if (status === GUATEMALA_WITHDRAWN_STATUS) return "Retirada";
  if (published === false) return "Disponible · Sin publicar";
  return "Disponible";
}

export interface SaleGarment {
  id: string;
  clientId: string;
  sku: string;
  priceGtq: string;
  status: InventoryItemStatus;
  photos: InventoryPhoto[];
}

export interface SaleActor {
  role: "propietario" | "encargado";
  accountId: string | null;
  username: string | null;
}

export interface RecordedSale {
  id: string;
  itemId: string;
  clientId: string;
  sku: string;
  publishedPriceGtq: string;
  chargedPriceGtq: string;
  soldAt: string;
  soldByRole?: SaleActor["role"] | null;
  soldByAccountId?: string | null;
  soldByUsername?: string | null;
  voidedAt?: string | null;
}

export interface SaleBook {
  items: SaleGarment[];
  sales: RecordedSale[];
}

export type SaleApplyResult =
  | { ok: true; sale: RecordedSale; available: number }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

// Confirms a sale only when the garment is still available. A rejection
// returns the same book, so a failed attempt cannot leave a partial sale.
export function applyGuatemalaSale(
  book: SaleBook,
  input: {
    clientId: string;
    itemId: string;
    chargedPrice: unknown;
    clientAllowed: boolean;
    now?: Date;
    soldBy?: SaleActor | null;
  }
): { book: SaleBook; result: SaleApplyResult } {
  if (!input.clientAllowed) {
    return {
      book,
      result: { ok: false, status: 403, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala },
    };
  }
  const chargedPriceGtq = quetzalPriceText(input.chargedPrice);
  if (!chargedPriceGtq) {
    return {
      book,
      result: { ok: false, status: 400, error: GUATEMALA_SALE_MESSAGES.priceInvalid },
    };
  }
  const item = book.items.find(
    (entry) => entry.id === input.itemId && entry.clientId === input.clientId
  );
  if (!item) {
    return { book, result: { ok: false, status: 404, error: GUATEMALA_SALE_MESSAGES.notFound } };
  }
  const alreadySold =
    item.status !== GUATEMALA_INVENTORY_STATUS ||
    book.sales.some((sale) => sale.itemId === item.id && !sale.voidedAt);
  if (alreadySold) {
    return {
      book,
      result: { ok: false, status: 409, error: GUATEMALA_SALE_MESSAGES.alreadySold },
    };
  }
  const soldAt = (input.now ?? new Date()).toISOString();
  const sale: RecordedSale = {
    id: `sale-${item.id}`,
    itemId: item.id,
    clientId: item.clientId,
    sku: item.sku,
    publishedPriceGtq: item.priceGtq,
    chargedPriceGtq,
    soldAt,
    soldByRole: input.soldBy?.role ?? null,
    soldByAccountId: input.soldBy?.accountId ?? null,
    soldByUsername: input.soldBy?.username ?? null,
  };
  const next: SaleBook = {
    items: book.items.map((entry) =>
      entry.id === item.id ? { ...entry, status: GUATEMALA_SOLD_STATUS } : entry
    ),
    sales: [...book.sales, sale],
  };
  return {
    book: next,
    result: {
      ok: true,
      sale,
      available: next.items.filter(
        (entry) => entry.clientId === item.clientId && entry.status === GUATEMALA_INVENTORY_STATUS
      ).length,
    },
  };
}
