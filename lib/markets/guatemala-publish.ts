import {
  GUATEMALA_INVENTORY_MESSAGES,
  GUATEMALA_INVENTORY_STATUS,
  GUATEMALA_SOLD_STATUS,
  GUATEMALA_WITHDRAWN_STATUS,
  quetzalPriceText,
  type InventoryItemStatus,
  type SaleActor,
} from "@/lib/markets/guatemala-inventory";

export type PublicationAction = "retirar" | "corregir" | "republicar" | "publicar";

export interface PublicationEvent {
  action: PublicationAction;
  actor: SaleActor;
  at: string;
}

export interface StaffPublicationItem {
  id: string;
  clientId: string;
  sku: string;
  title: string;
  description: string;
  brand: string;
  size: string;
  condition: string;
  priceGtq: string;
  status: InventoryItemStatus;
  photoCount: number;
  sold: boolean;
}

export interface PublicationPatch {
  title: string;
  description: string;
  brand: string;
  size: string;
  condition: string;
  priceGtq: string;
  photoCount: number;
}

export const PUBLICATION_MESSAGES = {
  sold: "Esta prenda está vendida y no puede volver a ofrecerse.",
  notFound: "No se encontró la prenda.",
  withdrawn: "La publicación quedó retirada. El registro y el SKU se conservan.",
  alreadyWithdrawn: "Esta publicación ya está retirada.",
  corrected: "Los cambios quedaron guardados en la misma prenda.",
  republished: "La prenda volvió a publicarse.",
  alreadyPublic: "Esta prenda ya está publicada.",
  retry: "No se pudo guardar el cambio. Los datos anteriores siguen en el inventario.",
} as const;

export function changePublication(
  item: StaffPublicationItem | null,
  clientId: string,
  action: PublicationAction,
  patch: PublicationPatch | null,
  actor: SaleActor,
  now: Date
):
  | { ok: true; item: StaffPublicationItem; event: PublicationEvent | null; already: boolean; message: string }
  | { ok: false; status: 400 | 404 | 409; error: string } {
  if (!item || item.clientId !== clientId) {
    return { ok: false, status: 404, error: PUBLICATION_MESSAGES.notFound };
  }
  if (item.sold || item.status === GUATEMALA_SOLD_STATUS) {
    return { ok: false, status: 409, error: PUBLICATION_MESSAGES.sold };
  }
  if (action === "retirar") {
    if (item.status === GUATEMALA_WITHDRAWN_STATUS) {
      return { ok: true, item, event: null, already: true, message: PUBLICATION_MESSAGES.alreadyWithdrawn };
    }
    return {
      ok: true,
      already: false,
      message: PUBLICATION_MESSAGES.withdrawn,
      event: { action, actor, at: now.toISOString() },
      item: { ...item, status: GUATEMALA_WITHDRAWN_STATUS },
    };
  }
  if (action === "publicar") {
    return { ok: false, status: 400, error: PUBLICATION_MESSAGES.retry };
  }
  if (action === "republicar") {
    if (item.status === GUATEMALA_INVENTORY_STATUS) {
      return { ok: true, item, event: null, already: true, message: PUBLICATION_MESSAGES.alreadyPublic };
    }
    const blockers = publishReviewBlockers({
      sku: item.sku,
      title: item.title,
      price: item.priceGtq,
      photoCount: item.photoCount,
    });
    if (blockers.length) return { ok: false, status: 400, error: blockers[0] };
    return {
      ok: true,
      already: false,
      message: PUBLICATION_MESSAGES.republished,
      event: { action, actor, at: now.toISOString() },
      item: { ...item, status: GUATEMALA_INVENTORY_STATUS },
    };
  }
  if (!patch) return { ok: false, status: 400, error: GUATEMALA_INVENTORY_MESSAGES.missingItem };
  const blockers = publishReviewBlockers({
    sku: item.sku,
    title: patch.title,
    price: patch.priceGtq,
    photoCount: patch.photoCount,
  });
  if (blockers.length) return { ok: false, status: 400, error: blockers[0] };
  return {
    ok: true,
    already: false,
    message: PUBLICATION_MESSAGES.corrected,
    event: { action, actor, at: now.toISOString() },
    item: {
      ...item,
      title: patch.title,
      description: patch.description,
      brand: patch.brand,
      size: patch.size,
      condition: patch.condition,
      priceGtq: patch.priceGtq,
      photoCount: patch.photoCount,
    },
  };
}

export type PublishStep = "datos" | "revision" | "publicado";

export const ISOLATED_PUBLICATION_SKU = /^prueba-publicar-[a-z0-9]{8,24}$/;

export function isolatedPublicationSku(sku: string): boolean {
  return ISOLATED_PUBLICATION_SKU.test(sku);
}

export function publishReviewBlockers(input: {
  sku: string;
  title: string;
  price: string;
  photoCount: number;
}): string[] {
  const blockers: string[] = [];
  if (!input.sku.trim()) blockers.push(GUATEMALA_INVENTORY_MESSAGES.skuRequired);
  if (!input.title.trim()) blockers.push("Escribe un título antes de revisar.");
  if (!quetzalPriceText(input.price)) blockers.push(GUATEMALA_INVENTORY_MESSAGES.priceInvalid);
  if (input.photoCount < 1) blockers.push(GUATEMALA_INVENTORY_MESSAGES.photosRequired);
  return blockers;
}

export function staffCanConfirmPublish(step: PublishStep): boolean {
  return step === "revision";
}

export const DISCARD_PUBLICATION_PROMPT = "¿Descartar este artículo y empezar de nuevo?";

export interface PublicationDraft {
  sku: string;
  title: string;
  description: string;
  brand: string;
  size: string;
  condition: string;
  price: string;
  priceNote: string;
  skuNote: string;
  itemType: string;
  category: string;
  photoCount: number;
}

export function emptyPublicationDraft(): PublicationDraft {
  return {
    sku: "",
    title: "",
    description: "",
    brand: "",
    size: "",
    condition: "",
    price: "",
    priceNote: "",
    skuNote: "",
    itemType: "",
    category: "",
    photoCount: 0,
  };
}

export function publicationDraftAfterDiscard(draft: PublicationDraft, confirmed: boolean): PublicationDraft {
  return confirmed ? emptyPublicationDraft() : draft;
}

export function publicationResultIsCurrent(startedGeneration: number, currentGeneration: number): boolean {
  return startedGeneration === currentGeneration;
}
