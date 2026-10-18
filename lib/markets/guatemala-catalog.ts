import { guatemalaConditionLabel } from "@/lib/markets/guatemala-inventory";
import { GARMENT_KIND_CHOICES, garmentKind } from "@/lib/markets/guatemala-price-match";

export const GUATEMALA_CATALOG_MESSAGES = {
  empty: "Todavía no hay prendas disponibles.",
  none: "Todavía no hay prendas.",
  noSold: "Todavía no hay artículos vendidos.",
  noMatch: "Ninguna prenda coincide con la búsqueda.",
  loadFailed: "No se pudo cargar el catálogo.",
  unavailable: "El catálogo no está disponible.",
  notFound: "No se encontró la prenda.",
  detailFailed: "No se pudo abrir la prenda.",
} as const;

export const PUBLIC_SOLD_BADGE = "VENDIDO";
export const PUBLIC_SOLD_NOTICE = "Vendido — ya no disponible";
export const PUBLIC_SOLD_COUNT_LABEL = "Artículos vendidos";

export interface CatalogPhoto {
  id: string;
  mediaType: string;
  data: string;
}

export interface CatalogSaleMark {
  isTest: boolean;
  voidedAt: string | null;
}

export interface CatalogSourceItem {
  id: string;
  clientId: string;
  sku: string;
  title: string;
  description: string;
  brand: string;
  size: string;
  condition: string;
  priceGtq: string;
  status: "disponible" | "vendida" | "retirada";
  photos: CatalogPhoto[];
  sales: CatalogSaleMark[];
}

export type CatalogAvailability = "todos" | "disponibles" | "vendidos";
export type CatalogPublicState = "disponible" | "vendido" | "oculto";

export interface PublicCatalogCard {
  id: string;
  sku: string;
  title: string;
  brand: string;
  size: string;
  priceGtq: string;
  category: string;
  categoryLabel: string;
  coverPhotoId: string | null;
  availability: "disponible" | "vendido";
  soldBadge: string;
}

export interface PublicCatalogDetail {
  id: string;
  sku: string;
  title: string;
  description: string;
  brand: string;
  size: string;
  conditionLabel: string;
  priceGtq: string;
  category: string;
  categoryLabel: string;
  photoIds: string[];
  availability: "disponible" | "vendido";
  soldNotice: string;
}

export interface CatalogFilters {
  q: string;
  category: string;
  size: string;
  brand: string;
  minPrice: number | null;
  maxPrice: number | null;
  availability: CatalogAvailability;
}

export interface PublicCatalogFacets {
  categories: { key: string; label: string }[];
  sizes: string[];
  brands: string[];
  minPrice: number | null;
  maxPrice: number | null;
}

const CARD_KEYS = ["id", "sku", "title", "brand", "size", "priceGtq", "category", "categoryLabel", "coverPhotoId", "availability", "soldBadge"] as const;
const DETAIL_KEYS = ["id", "sku", "title", "description", "brand", "size", "conditionLabel", "priceGtq", "category", "categoryLabel", "photoIds", "availability", "soldNotice"] as const;
const KNOWN_CATEGORIES = new Set(GARMENT_KIND_CHOICES.map((choice) => choice.key));

export function emptyCatalogFilters(): CatalogFilters {
  return { q: "", category: "", size: "", brand: "", minPrice: null, maxPrice: null, availability: "todos" };
}

export function catalogFiltersActive(filters: CatalogFilters): boolean {
  return Boolean(filters.q || filters.category || filters.size || filters.brand || filters.minPrice != null || filters.maxPrice != null);
}

export function catalogEmptyMessage(filters: CatalogFilters | string): string {
  const normalized = normalizeFilters(filters);
  if (catalogFiltersActive(normalized)) return GUATEMALA_CATALOG_MESSAGES.noMatch;
  if (normalized.availability === "vendidos") return GUATEMALA_CATALOG_MESSAGES.noSold;
  if (normalized.availability === "disponibles") return GUATEMALA_CATALOG_MESSAGES.empty;
  return GUATEMALA_CATALOG_MESSAGES.none;
}

export function parseCatalogFilters(input: Record<string, string | string[] | undefined>): CatalogFilters {
  const read = (key: string) => {
    const value = input[key];
    return (Array.isArray(value) ? value[0] : value ?? "").trim().slice(0, 80);
  };
  const category = read("categoria");
  const estado = read("estado");
  return {
    q: read("q"),
    category: KNOWN_CATEGORIES.has(category) ? category : "",
    size: read("talla"),
    brand: read("marca"),
    minPrice: catalogPriceBound(read("min")),
    maxPrice: catalogPriceBound(read("max")),
    availability: estado === "disponibles" || estado === "vendidos" ? estado : "todos",
  };
}

function catalogPriceBound(value: string): number | null {
  if (!value) return null;
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0 || price > 20000) return null;
  return Math.round(price * 100) / 100;
}

export function catalogPublicState(item: CatalogSourceItem, clientId: string): CatalogPublicState {
  if (item.clientId !== clientId || item.status === "retirada") return "oculto";
  const active = item.sales.filter((sale) => !sale.voidedAt);
  if (active.some((sale) => sale.isTest)) return "oculto";
  const realSale = active.some((sale) => !sale.isTest);
  if (item.status === "vendida" && realSale) return "vendido";
  if (item.status === "disponible" && !realSale) return "disponible";
  return "oculto";
}

export function catalogItemVisible(item: CatalogSourceItem, clientId: string): boolean {
  return catalogPublicState(item, clientId) !== "oculto";
}

export function catalogOrderAllowed(item: CatalogSourceItem, clientId: string): boolean {
  return catalogPublicState(item, clientId) === "disponible";
}

export function publicSoldArticleCount(items: readonly CatalogSourceItem[], clientId: string): number {
  return items.filter((item) => catalogPublicState(item, clientId) === "vendido").length;
}

export function publicCatalogCards(
  items: readonly CatalogSourceItem[],
  clientId: string,
  filters: CatalogFilters | string = ""
): PublicCatalogCard[] {
  const wanted = normalizeFilters(filters);
  return visibleCatalogItems(items, clientId)
    .filter((item) => itemMatches(item, wanted))
    .map((item, index) => ({ item, index, state: catalogPublicState(item, clientId) }))
    .sort((a, b) => Number(a.state === "vendido") - Number(b.state === "vendido") || a.index - b.index)
    .map(({ item, state }) => publicCatalogCard(item, state === "vendido" ? "vendido" : "disponible"));
}

export function publicCatalogFacets(
  items: readonly CatalogSourceItem[],
  clientId: string
): PublicCatalogFacets {
  const visible = visibleCatalogItems(items, clientId).map((item) => publicCatalogCard(item));
  const categories = new Map<string, string>();
  const sizes = new Set<string>();
  const brands = new Set<string>();
  const prices = visible.flatMap((item) => {
    const price = Number(item.priceGtq);
    return Number.isFinite(price) ? [price] : [];
  });
  for (const item of visible) {
    if (item.category) categories.set(item.category, item.categoryLabel);
    if (item.size.trim()) sizes.add(item.size.trim());
    if (item.brand.trim()) brands.add(item.brand.trim());
  }
  return {
    categories: [...categories.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "es")),
    sizes: [...sizes].sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
    brands: [...brands].sort((a, b) => a.localeCompare(b, "es")),
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
  };
}

export function publicCatalogDetail(
  items: readonly CatalogSourceItem[],
  clientId: string,
  itemId: string
): PublicCatalogDetail | null {
  const item = items.find((entry) => entry.id === itemId && catalogItemVisible(entry, clientId));
  if (!item) return null;
  const state = catalogPublicState(item, clientId);
  if (state === "oculto") return null;
  return publicCatalogDetailView(item, state);
}

export function publicCatalogCard(item: CatalogSourceItem, availability: "disponible" | "vendido" = "disponible"): PublicCatalogCard {
  const category = catalogCategory(item.title);
  const card: PublicCatalogCard = {
    id: item.id,
    sku: item.sku,
    title: item.title,
    brand: item.brand.trim(),
    size: item.size.trim(),
    priceGtq: item.priceGtq,
    category: category.key,
    categoryLabel: category.label,
    coverPhotoId: item.photos[0]?.id ?? null,
    availability,
    soldBadge: availability === "vendido" ? PUBLIC_SOLD_BADGE : "",
  };
  return pick(card, CARD_KEYS);
}

export function publicCatalogDetailView(
  item: CatalogSourceItem,
  availability: "disponible" | "vendido" = "disponible"
): PublicCatalogDetail {
  const category = catalogCategory(item.title);
  const detail: PublicCatalogDetail = {
    id: item.id,
    sku: item.sku,
    title: item.title,
    description: item.description,
    brand: item.brand.trim(),
    size: item.size.trim(),
    conditionLabel: guatemalaConditionLabel(item.condition),
    priceGtq: item.priceGtq,
    category: category.key,
    categoryLabel: category.label,
    photoIds: item.photos.map((photo) => photo.id),
    availability,
    soldNotice: availability === "vendido" ? PUBLIC_SOLD_NOTICE : "",
  };
  return pick(detail, DETAIL_KEYS);
}

export function catalogPageSearch(filters: CatalogFilters): string {
  const search = new URLSearchParams();
  if (filters.q) search.set("q", filters.q);
  if (filters.category) search.set("categoria", filters.category);
  if (filters.size) search.set("talla", filters.size);
  if (filters.brand) search.set("marca", filters.brand);
  if (filters.minPrice != null) search.set("min", String(filters.minPrice));
  if (filters.maxPrice != null) search.set("max", String(filters.maxPrice));
  if (filters.availability === "disponibles" || filters.availability === "vendidos") search.set("estado", filters.availability);
  return search.toString();
}

export function catalogPhotoPath(photoId: string, width: 480 | 960 = 960): string {
  return `/api/markets/guatemala/catalog/foto/${encodeURIComponent(photoId)}?w=${width}`;
}

function visibleCatalogItems(items: readonly CatalogSourceItem[], clientId: string): CatalogSourceItem[] {
  return items.filter((item) => catalogItemVisible(item, clientId));
}

function normalizeFilters(filters: CatalogFilters | string): CatalogFilters {
  if (typeof filters === "string") return { ...emptyCatalogFilters(), q: filters.trim() };
  return {
    q: filters.q.trim(),
    category: KNOWN_CATEGORIES.has(filters.category) ? filters.category : "",
    size: filters.size.trim(),
    brand: filters.brand.trim(),
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    availability: filters.availability === "disponibles" || filters.availability === "vendidos" ? filters.availability : "todos",
  };
}

function itemMatches(item: CatalogSourceItem, filters: CatalogFilters): boolean {
  const needle = filters.q.toLocaleLowerCase("es-GT");
  if (needle) {
    const haystack = `${item.title}\n${item.sku}\n${item.brand}`.toLocaleLowerCase("es-GT");
    if (!haystack.includes(needle)) return false;
  }
  const category = catalogCategory(item.title);
  if (filters.category && category.key !== filters.category) return false;
  if (filters.size && item.size.trim().toLocaleLowerCase("es-GT") !== filters.size.toLocaleLowerCase("es-GT")) return false;
  if (filters.brand && item.brand.trim().toLocaleLowerCase("es-GT") !== filters.brand.toLocaleLowerCase("es-GT")) return false;
  const price = Number(item.priceGtq);
  if (filters.minPrice != null && (!Number.isFinite(price) || price < filters.minPrice)) return false;
  if (filters.maxPrice != null && (!Number.isFinite(price) || price > filters.maxPrice)) return false;
  const state = catalogPublicState(item, item.clientId);
  if (filters.availability === "disponibles" && state !== "disponible") return false;
  if (filters.availability === "vendidos" && state !== "vendido") return false;
  return true;
}

function catalogCategory(title: string): { key: string; label: string } {
  const kind = garmentKind("", title);
  if (!kind) return { key: "", label: "" };
  const label = GARMENT_KIND_CHOICES.find((choice) => choice.key === kind.key)?.label ?? kind.search;
  return { key: kind.key, label };
}

function pick<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  const copy = {} as T;
  for (const key of keys) copy[key] = value[key];
  return copy;
}
