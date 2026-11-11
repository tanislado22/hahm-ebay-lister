import type { VintedStatus } from "@/lib/types";

export const VINTED_UNLINK_MESSAGE =
  "¿Seguro que quieres desvincular este artículo de Vinted? Se quitará el enlace guardado y podrás volver a prepararlo para publicar. Esto no eliminará ninguna publicación en Vinted ni afectará eBay.";

export interface VintedAssociation {
  vintedStatus: "not_prepared" | "ready" | "published";
  vintedListingUrl: string | null;
  vintedListingId: string | null;
  publishedOnVinted: boolean;
  publishedOnEbay: boolean;
  ebayItemId: string | null;
  prepared: unknown;
  photos: readonly string[];
}

export function unlinkVintedAssociation(card: VintedAssociation): VintedAssociation {
  return {
    ...card,
    vintedStatus: "not_prepared",
    vintedListingUrl: null,
    vintedListingId: null,
    publishedOnVinted: false,
  };
}

export function vintedStatusLabel(status: VintedStatus | undefined): string {
  if (status === "published") return "Published";
  if (status === "ready") return "Ready";
  return "Not Published";
}

export function applyStoredVintedLink<T extends { vintedStatus?: VintedStatus; vintedListingUrl?: string }>(
  group: T,
  link: { vintedStatus?: VintedStatus | null; vintedListingUrl?: string | null }
): T {
  if (!link.vintedStatus) return group;
  return {
    ...group,
    vintedStatus: link.vintedStatus,
    vintedListingUrl: link.vintedListingUrl || undefined,
  };
}

export function showsVintedPrepare(status: VintedStatus | undefined): boolean {
  return status !== "published";
}

export function showsVintedQueue(status: VintedStatus | undefined): boolean {
  return status === "ready" || status === "not_prepared";
}
