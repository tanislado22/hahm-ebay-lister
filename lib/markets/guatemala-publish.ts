import { GUATEMALA_INVENTORY_MESSAGES, quetzalPriceText } from "@/lib/markets/guatemala-inventory";

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
