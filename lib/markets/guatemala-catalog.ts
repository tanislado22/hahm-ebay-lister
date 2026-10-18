import { guatemalaConditionLabel } from "@/lib/markets/guatemala-inventory";
import { GARMENT_KIND_CHOICES, garmentKind } from "@/lib/markets/guatemala-price-match";

export const GUATEMALA_CATALOG_MESSAGES = {
  empty: "Todavía no hay prendas disponibles.",
  noMatch: "Ninguna prenda coincide con la búsqueda.",
  loadFailed: "No se pudo cargar el catálogo.",
  unavailable: "El catálogo no está disponible.",
  notFound: "No se encontró la prenda.",
  detailFailed: "No se pudo abrir la prenda.",
} as const;

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
  status: "disponible" | "vendida";
  photos: CatalogPhoto[];
  sales: CatalogSaleMark[];
}

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
}

export interface CatalogFilters {
  q: string;
  category: string;
  size: string;
  brand: string;
  minPrice: number | null;
  maxPrice: number | null;
}

export interface PublicCatalogFacets {
  categories: { key: string; label: string }[];
  sizes: string[];
  brands: string[];
  minPrice: number | null;
  maxPrice: number | null;
}

const CARD_KEYS = ["id", "sku", "title", "brand", "size", "priceGtq", "category", "categoryLabel", "coverPhotoId"] as const;
const DETAIL_KEYS = ["id", "sku", "title", "description", "brand", "size", "conditionLabel", "priceGtq", "category", "categoryLabel", "photoIds"] as const;
const KNOWN_CATEGORIES = new Set(GARMENT_KIND_CHOICES.map((choice) => choice.key));

export function emptyCatalogFilters(): CatalogFilters {
  return { q: "", category: "", size: "", brand: "", minPrice: null, maxPrice: null };
}

export function catalogFiltersActive(filters: CatalogFilters): boolean {
  return Boolean(filters.q || filters.category || filters.size || filters.brand || filters.minPrice != null || filters.maxPrice != null);
}

export function catalogEmptyMessage(filters: CatalogFilters | string): string {
  const active = typeof filters === "string" ? filters.trim().length > 0 : catalogFiltersActive(normalizeFilters(filters));
  return active ? GUATEMALA_CATALOG_MESSAGES.noMatch : GUATEMALA_CATALOG_MESSAGES.empty;
}

export function parseCatalogFilters(input: Record<string, string | string[] | undefined>): CatalogFilters {
  const read = (key: string) => {
    const value = input[key];
    return (Array.isArray(value) ? value[0] : value ?? "").trim().slice(0, 80);
  };
  const category = read("categoria");
  return {
    q: read("q"),
    category: KNOWN_CATEGORIES.has(category) ? category : "",
    size: read("talla"),
    brand: read("marca"),
    minPrice: catalogPriceBound(read("min")),
    maxPrice: catalogPriceBound(read("max")),
  };
}

function catalogPriceBound(value: string): number | null {
  if (!value) return null;
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0 || price > 20000) return null;
  return Math.round(price * 100) / 100;
}

export function catalogItemVisible(item: CatalogSourceItem, clientId: string): boolean {
  if (item.clientId !== clientId) return false;
  if (item.status !== "disponible") return false;
  if (item.sales.some((sale) => sale.isTest || !sale.voidedAt)) return false;
  return true;
}

export function publicCatalogCards(
  items: readonly CatalogSourceItem[],
  clientId: string,
  filters: CatalogFilters | string = ""
): PublicCatalogCard[] {
  const wanted = normalizeFilters(filters);
  return visibleCatalogItems(items, clientId).filter((item) => itemMatches(item, wanted)).map(publicCatalogCard);
}

export function publicCatalogFacets(
  items: readonly CatalogSourceItem[],
  clientId: string
): PublicCatalogFacets {
  const visible = visibleCatalogItems(items, clientId).map(publicCatalogCard);
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
  return publicCatalogDetailView(item);
}

export function publicCatalogCard(item: CatalogSourceItem): PublicCatalogCard {
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
  };
  return pick(card, CARD_KEYS);
}

export function publicCatalogDetailView(item: CatalogSourceItem): PublicCatalogDetail {
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
  };
  return pick(detail, DETAIL_KEYS);
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
