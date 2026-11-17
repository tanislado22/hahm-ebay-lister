import { exactGuatemalaSku } from "@/lib/markets/guatemala";
import { catalogPublicState, type CatalogSourceItem } from "@/lib/markets/guatemala-catalog";
import {
  GUATEMALA_CONDITION_CHOICES,
  GUATEMALA_INVENTORY_MESSAGES,
  quetzalPriceText,
} from "@/lib/markets/guatemala-inventory";
import { readScannedLabel } from "@/lib/markets/guatemala-qr";

/**
 * Registro de una prenda desde Agregar artículo.
 * El QR de SKU se copia tal cual, el lote no sale del prefijo y una ficha
 * existente se abre sin reemplazarla.
 */

export const REGISTRATION_MESSAGES = {
  already: "Este SKU ya está registrado. Abre la ficha existente. No se reemplazó nada.",
  saved: "Artículo guardado. Quedó disponible, se puede vender y no sale en el catálogo.",
  scanNext: "Artículo guardado. Escanea la siguiente prenda.",
} as const;

export type RegistrationScan =
  | { ok: true; kind: "sku"; sku: string }
  | { ok: true; kind: "item"; itemId: string }
  | { ok: false; error: string };

export interface RegistrationForm {
  sku: string;
  lotId: string;
  title: string;
  description: string;
  brand: string;
  size: string;
  condition: string;
  price: string;
}

export function skuFromRegistrationScan(raw: unknown): RegistrationScan {
  const read = readScannedLabel(raw);
  if (!read.ok) return read;
  if (read.kind === "code") return { ok: true, kind: "item", itemId: read.itemId };
  return { ok: true, kind: "sku", sku: read.sku };
}

/** Scanning never picks a lot from L1, L2, USA or any other prefix. */
export function lotAfterRegistrationScan(currentLotId: string, _sku: string): string {
  return currentLotId;
}

export function applyRegistrationScan(form: RegistrationForm, raw: unknown):
  | { ok: true; form: RegistrationForm; scan: RegistrationScan & { ok: true } }
  | { ok: false; form: RegistrationForm; error: string } {
  const scan = skuFromRegistrationScan(raw);
  if (!scan.ok) return { ok: false, form, error: scan.error };
  if (scan.kind === "item") return { ok: true, form, scan };
  return {
    ok: true,
    scan,
    form: {
      ...form,
      sku: scan.sku,
      lotId: lotAfterRegistrationScan(form.lotId, scan.sku),
    },
  };
}

export function registrationFormShouldClear(saved: boolean): boolean {
  return saved;
}

export interface PreparedPhotoLessRegistration {
  sku: string;
  title: string;
  description: string;
  brand: string;
  size: string;
  condition: string;
  priceGtq: string;
  lotId: string | null;
  published: false;
}

export function preparePhotoLessRegistration(input: {
  sku?: unknown;
  title?: unknown;
  description?: unknown;
  brand?: unknown;
  size?: unknown;
  condition?: unknown;
  price?: unknown;
  lotId?: unknown;
}): { ok: true; item: PreparedPhotoLessRegistration } | { ok: false; status: 400; error: string } {
  const sku = exactGuatemalaSku(input.sku).trim();
  if (!sku) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.skuRequired };
  const priceGtq = quetzalPriceText(input.price);
  if (!priceGtq) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.priceInvalid };
  const title = text(input.title).trim() || sku;
  if (title.length > 140) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.titleLong };
  const description = text(input.description).trim();
  if (description.length > 4000) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.descriptionLong };
  const brand = text(input.brand).trim();
  if (brand.length > 80) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.brandLong };
  const size = text(input.size).trim();
  if (size.length > 40) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.sizeLong };
  const condition = text(input.condition).trim();
  if (condition && !GUATEMALA_CONDITION_CHOICES.some((choice) => choice.value === condition)) {
    return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.conditionInvalid };
  }
  const requestedLot = text(input.lotId).trim();
  return {
    ok: true,
    item: {
      sku,
      title,
      description,
      brand,
      size,
      condition,
      priceGtq,
      lotId: requestedLot || null,
      published: false,
    },
  };
}

export function registrationInsertDecision(existing: { id: string; sku: string; title: string } | null):
  | { action: "insert" }
  | { action: "open_existing"; item: { id: string; sku: string; title: string } } {
  if (existing) return { action: "open_existing", item: existing };
  return { action: "insert" };
}

export function photoLessStaysOutOfCatalog(item: Pick<CatalogSourceItem, "clientId" | "status" | "sales" | "published">, clientId: string) {
  return catalogPublicState(item as CatalogSourceItem, clientId) === "oculto";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
