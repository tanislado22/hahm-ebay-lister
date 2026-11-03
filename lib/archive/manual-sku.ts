import { exactSku } from "@/lib/archive/text";

export type SkuLocale = "es" | "en";

export function parseManualSku(value: string): { ok: true; sku: string } | { ok: false; error: string } {
  const sku = exactSku(value);
  if (!sku) {
    return { ok: false, error: "Escribe un SKU antes de guardar. No se genera uno automático." };
  }
  if (sku.length > 50) {
    return { ok: false, error: "El SKU puede tener hasta 50 caracteres." };
  }
  if (!/^[A-Za-z0-9._-]+$/.test(sku)) {
    return { ok: false, error: "El SKU solo puede usar letras, números, punto, guion y guion bajo." };
  }
  return { ok: true, sku };
}

export function skuFieldEditable(postStatus: string | undefined, sku: string): boolean {
  return postStatus !== "posted" || exactSku(sku) === "";
}

export function missingSkuForVinted(locale: SkuLocale): string {
  if (locale === "en") {
    return "SKU is missing. Type it in the SKU field and press Save SKU. A SKU is not generated automatically.";
  }
  return "Falta el SKU. Escríbelo en el campo SKU y pulsa Guardar SKU. No se genera uno automático.";
}

export function missingTitleForVinted(locale: SkuLocale): string {
  if (locale === "en") {
    return "Title is missing. Fill in the title, then prepare the item for Vinted again.";
  }
  return "Falta el título. Complétalo en el artículo y vuelve a pulsar Preparar para Vinted.";
}

export function vintedPrepareBlock(input: {
  sku: string;
  title: string;
  locale?: SkuLocale;
}): { ok: true; sku: string } | { ok: false; error: string } {
  const locale = input.locale ?? "es";
  const sku = exactSku(input.sku);
  if (!sku) return { ok: false, error: missingSkuForVinted(locale) };
  if (!input.title.trim()) return { ok: false, error: missingTitleForVinted(locale) };
  return { ok: true, sku };
}

export interface VintedPrepareCandidate {
  id: string;
  label: string;
  sku: string;
  title: string;
  vintedStatus?: string;
  hasListing: boolean;
}

export function partitionVintedPrepare(
  items: VintedPrepareCandidate[],
  locale: SkuLocale = "en"
): { ready: { id: string; sku: string }[]; blocked: { id: string; label: string; error: string }[] } {
  const ready: { id: string; sku: string }[] = [];
  const blocked: { id: string; label: string; error: string }[] = [];
  for (const item of items) {
    if (item.vintedStatus === "published") continue;
    if (!item.hasListing) {
      blocked.push({
        id: item.id,
        label: item.label,
        error: locale === "en"
          ? "The written listing is missing. Wait until the item has a title, then prepare it again."
          : "Falta el anuncio escrito. Espera a que el artículo tenga título y vuelve a prepararlo.",
      });
      continue;
    }
    const check = vintedPrepareBlock({ sku: item.sku, title: item.title, locale });
    if (!check.ok) blocked.push({ id: item.id, label: item.label, error: check.error });
    else ready.push({ id: item.id, sku: check.sku });
  }
  return { ready, blocked };
}

export function vintedPrepareResultMessage(
  prepared: number,
  blocked: { label: string; error: string }[],
  locale: SkuLocale = "en"
): string {
  const parts: string[] = [];
  if (locale === "en") {
    if (prepared === 1) parts.push("Prepared for Vinted. It was not published on Vinted.");
    else if (prepared > 1) parts.push(`${prepared} items were prepared for Vinted. They were not published on Vinted.`);
  } else if (prepared === 1) {
    parts.push("Quedó preparado para Vinted. No se publicó en Vinted.");
  } else if (prepared > 1) {
    parts.push(`${prepared} artículos quedaron preparados para Vinted. No se publicaron en Vinted.`);
  }
  for (const item of blocked) parts.push(`${item.label}: ${item.error}`);
  if (parts.length === 0) {
    return locale === "en"
      ? "No items are waiting to be prepared for Vinted."
      : "No hay artículos pendientes de preparar para Vinted.";
  }
  return parts.join(" ");
}

export function workspaceItemHref(jobId: string, workMode: string, clientId: string | null): string {
  const params = new URLSearchParams();
  params.set("trabajo", jobId);
  if (workMode === "client" && clientId) {
    params.set("workMode", "client");
    params.set("clientId", clientId);
  }
  return `/?${params.toString()}`;
}

export function workspaceGroupVisible(group: {
  photoIds?: string[];
  status?: string;
  listing?: unknown;
  listingId?: string;
  postStatus?: string;
}): boolean {
  if ((group.photoIds?.length ?? 0) > 0) return true;
  return group.status === "done" && Boolean(group.listing) && (Boolean(group.listingId) || group.postStatus === "posted");
}

export interface ManualSkuListing {
  id: string;
  sku: string;
  ebayItemId: string;
}

export function planManualSkuAssignment(input: {
  nextSku: string;
  articleSku: string;
  articleId: string;
  ebayItemId: string;
  jobSku: string | null;
  listingSkus: ManualSkuListing[];
}): { ok: false; error: string } | {
  ok: true;
  sku: string;
  articleId: string;
  ebayItemId: string;
  updateListingIds: string[];
  ebayWrite: false;
  duplicate: false;
} {
  const parsed = parseManualSku(input.nextSku);
  if (!parsed.ok) return parsed;
  const current = exactSku(input.articleSku);
  if (current && current !== parsed.sku) {
    return { ok: false, error: `Este artículo ya tiene el SKU ${current}. No se reemplazó.` };
  }
  const jobSku = exactSku(input.jobSku);
  if (jobSku && jobSku !== parsed.sku) {
    return { ok: false, error: `El área de trabajo ya tiene el SKU ${jobSku}. No se reemplazó.` };
  }
  const sameSku = input.listingSkus.filter((row) => exactSku(row.sku) === parsed.sku);
  const taken = sameSku.find((row) => row.ebayItemId !== input.ebayItemId);
  if (taken) {
    return { ok: false, error: `El SKU ${parsed.sku} ya está en el inventario. Elige otro. No se modificó el anuncio en eBay.` };
  }
  const byItem = input.ebayItemId
    ? input.listingSkus.filter((row) => row.ebayItemId === input.ebayItemId)
    : [];
  const conflicting = byItem.find((row) => {
    const sku = exactSku(row.sku);
    return sku !== "" && sku !== parsed.sku;
  });
  if (conflicting) {
    return { ok: false, error: `El inventario ya guarda el SKU ${exactSku(conflicting.sku)} para este anuncio. No se reemplazó.` };
  }
  return {
    ok: true,
    sku: parsed.sku,
    articleId: input.articleId,
    ebayItemId: input.ebayItemId,
    updateListingIds: byItem.filter((row) => exactSku(row.sku) === "").map((row) => row.id),
    ebayWrite: false,
    duplicate: false,
  };
}

export function groupAfterManualSku<T extends { sku: string }>(group: T, sku: string): T {
  return { ...group, sku };
}

export function manualSkuSavedMessage(input: {
  sku: string;
  ebayItemId: string;
  archive: boolean;
  workspace: boolean;
  inventory: boolean;
  queue: boolean;
}): string {
  const places = [
    input.archive ? "el archivo" : "",
    input.workspace ? "el área de trabajo" : "",
    input.inventory ? "el inventario" : "",
    input.queue ? "la cola de Vinted" : "",
  ].filter(Boolean);
  const where = places.length ? ` Quedó en ${places.join(", ")}.` : "";
  const item = input.ebayItemId ? ` El anuncio ${input.ebayItemId} sigue publicado.` : "";
  return `El SKU ${input.sku} quedó guardado.${where}${item} No se modificó el anuncio en eBay.`;
}

export function fillExistingWorkspaceJob<
  TGroup extends {
    id: string;
    sku?: string;
    photoIds?: string[];
    listingId?: string;
    postStatus?: string;
    vintedListingUrl?: string;
    vintedStatus?: string;
  },
  TPhoto,
>(
  existing: { group?: TGroup; photos?: TPhoto[] } | null,
  incoming: { group: TGroup; photos: TPhoto[] }
): { group: TGroup; photos: TPhoto[]; changed: boolean; duplicate: false } {
  const current = existing?.group;
  if (!current) {
    return { group: incoming.group, photos: incoming.photos, changed: true, duplicate: false };
  }
  const hasPhotos = (current.photoIds?.length ?? 0) > 0;
  const incomingPhotos = (incoming.group.photoIds?.length ?? 0) > 0;
  const needsPhotos = !hasPhotos && incomingPhotos;
  const needsSku = !exactSku(current.sku) && exactSku(incoming.group.sku) !== "";
  if (!needsPhotos && !needsSku) {
    return { group: { ...current, id: current.id }, photos: existing?.photos ?? [], changed: false, duplicate: false };
  }
  return {
    group: {
      ...current,
      id: current.id,
      sku: exactSku(current.sku) ? current.sku : incoming.group.sku,
      photoIds: needsPhotos ? incoming.group.photoIds : current.photoIds,
      listingId: current.listingId || incoming.group.listingId,
      postStatus: current.postStatus === "posted" || incoming.group.postStatus === "posted" ? "posted" : current.postStatus,
      vintedListingUrl: current.vintedListingUrl || incoming.group.vintedListingUrl,
      vintedStatus: current.vintedStatus || incoming.group.vintedStatus,
    },
    photos: needsPhotos ? incoming.photos : (existing?.photos ?? []),
    changed: true,
    duplicate: false,
  };
}
