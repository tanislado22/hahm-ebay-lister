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
  size: string;
  priceGtq: string;
  status: "disponible" | "vendida";
  photos: CatalogPhoto[];
  sales: CatalogSaleMark[];
}

export interface PublicCatalogCard {
  id: string;
  sku: string;
  title: string;
  size: string;
  priceGtq: string;
  cover: CatalogPhoto | null;
}

export interface PublicCatalogDetail {
  id: string;
  sku: string;
  title: string;
  description: string;
  size: string;
  priceGtq: string;
  photos: CatalogPhoto[];
}

const CARD_KEYS = ["id", "sku", "title", "size", "priceGtq", "cover"] as const;
const DETAIL_KEYS = ["id", "sku", "title", "description", "size", "priceGtq", "photos"] as const;

export function catalogEmptyMessage(query: string): string {
  return query.trim() ? GUATEMALA_CATALOG_MESSAGES.noMatch : GUATEMALA_CATALOG_MESSAGES.empty;
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
  query: string
): PublicCatalogCard[] {
  const needle = query.trim().toLocaleLowerCase("es-GT");
  return items.filter((item) => {
    if (!catalogItemVisible(item, clientId)) return false;
    if (!needle) return true;
    return (
      item.title.toLocaleLowerCase("es-GT").includes(needle) ||
      item.sku.toLocaleLowerCase("es-GT").includes(needle)
    );
  }).map(publicCatalogCard);
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
  const card: PublicCatalogCard = {
    id: item.id,
    sku: item.sku,
    title: item.title,
    size: item.size,
    priceGtq: item.priceGtq,
    cover: item.photos[0] ? { ...item.photos[0] } : null,
  };
  return pick(card, CARD_KEYS);
}

export function publicCatalogDetailView(item: CatalogSourceItem): PublicCatalogDetail {
  const detail: PublicCatalogDetail = {
    id: item.id,
    sku: item.sku,
    title: item.title,
    description: item.description,
    size: item.size,
    priceGtq: item.priceGtq,
    photos: item.photos.map((photo) => ({ ...photo })),
  };
  return pick(detail, DETAIL_KEYS);
}

function pick<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  const copy = {} as T;
  for (const key of keys) copy[key] = value[key];
  return copy;
}
