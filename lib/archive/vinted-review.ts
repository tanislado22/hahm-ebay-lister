import type { ItemGroup } from "@/lib/types";
import { listingUrlForPlatform } from "@/lib/telegram/sale-links";

export type VintedReview = "linked" | "pending" | "unverified";
export type ArchiveVintedFilter = "all" | VintedReview;

export const VINTED_REVIEW_LABEL: Record<VintedReview, string> = {
  linked: "Vinculado a Vinted",
  pending: "Pendiente de publicar",
  unverified: "Sin verificar",
};

// Same acceptance rule as listingUrlForPlatform("vinted"), including an optional
// trailing slash or query. Used by the archive list so the filter stays in SQL.
export const ARCHIVE_VINTED_URL_PATTERN =
  "^https://(?:www\\.)?vinted\\.[a-z.]+/items/[0-9]{6,}(?:-[^/?#]*)?/?(?:[?#][^\\s]*)?$";

const ARCHIVE_VINTED_URL = new RegExp(ARCHIVE_VINTED_URL_PATTERN, "i");

export function savedVintedListingUrl(value: string | null | undefined): string {
  return listingUrlForPlatform("vinted", value) || "";
}

export function archiveVintedUrlMatchesSql(value: string): boolean {
  return ARCHIVE_VINTED_URL.test(value.trim());
}

export function vintedItemIdFromUrl(value: string): string {
  const saved = savedVintedListingUrl(value);
  if (!saved) return "";
  return new URL(saved).pathname.match(/\/items\/(\d{6,})/)?.[1] || "";
}

// A saved listing URL is the only proof of a link. "not_prepared", "ready",
// and a missing URL stay unverified until the seller says otherwise.
export function vintedReviewOf(url: string, stored: string): VintedReview {
  if (savedVintedListingUrl(url)) return "linked";
  if (stored === "pending") return "pending";
  return "unverified";
}

export function parseArchiveVintedFilter(value: unknown): ArchiveVintedFilter | null {
  if (value == null || value === "" || value === "all") return "all";
  if (value === "linked" || value === "pending" || value === "unverified") return value;
  return null;
}

export type VintedReviewAction =
  | { type: "link"; url: string }
  | { type: "unlink" }
  | { type: "pending" }
  | { type: "unverified" };

export function applyVintedReviewAction(
  current: { url: string; stored: string },
  action: VintedReviewAction
): { ok: true; url: string; id: string; stored: string; review: VintedReview } | { ok: false; error: string } {
  const url = savedVintedListingUrl(current.url);
  if (action.type === "link") {
    const next = savedVintedListingUrl(action.url);
    if (!next) {
      return {
        ok: false,
        error: "Pega un enlace https de un anuncio de Vinted. Un ejemplo válido es https://www.vinted.com/items/12345678.",
      };
    }
    return { ok: true, url: next, id: vintedItemIdFromUrl(next), stored: "unverified", review: "linked" };
  }
  if (action.type === "unlink") {
    return { ok: true, url: "", id: "", stored: "unverified", review: "unverified" };
  }
  if (action.type === "pending") {
    if (url) {
      return {
        ok: false,
        error: "Este artículo tiene un enlace de Vinted. Quita el vínculo si quieres marcarlo como pendiente.",
      };
    }
    return { ok: true, url: "", id: "", stored: "pending", review: "pending" };
  }
  return { ok: true, url, id: url ? vintedItemIdFromUrl(url) : "", stored: "unverified", review: vintedReviewOf(url, "unverified") };
}

// Re-import keeps a saved URL and a manual pending mark. The incoming workspace
// status, including "not_prepared", never becomes "Pendiente de publicar".
export function vintedReviewAfterImport(input: {
  existingUrl: string;
  existingStored: string;
  incomingUrl: string;
  incomingStatus: string;
}): { url: string; stored: string; review: VintedReview } {
  const url = savedVintedListingUrl(input.existingUrl) || savedVintedListingUrl(input.incomingUrl) || "";
  const stored = input.existingStored === "pending" ? "pending" : "unverified";
  // incomingStatus is accepted so callers can pass "not_prepared" or "ready"
  // and see that neither one is turned into a pending mark.
  void input.incomingStatus;
  return { url, stored, review: vintedReviewOf(url, stored) };
}

export function workspaceGroupAfterVintedPrepare(group: ItemGroup, sku: string, ebayItemId: string): ItemGroup {
  const listingId = group.listingId || ebayItemId || undefined;
  return {
    ...group,
    sku: group.sku || sku,
    listingId,
    postStatus: listingId || group.postStatus === "posted" ? "posted" : group.postStatus,
    vintedStatus: group.vintedStatus === "published" ? "published" : "ready",
    vintedListingUrl: group.vintedListingUrl,
  };
}

export function planArchiveVintedPrepare(input: {
  reviewUrl: string;
  reviewStored: string;
  postStatus: string;
  ebayItemId: string;
  jobId: string;
  sku: string;
}): {
  review: VintedReview;
  postStatus: string;
  listingId: string;
  jobId: string;
  sku: string;
  ebayWrite: false;
  marksLinked: false;
} {
  const listingId = input.ebayItemId.trim();
  return {
    review: vintedReviewOf(input.reviewUrl, input.reviewStored),
    postStatus: listingId || input.postStatus === "posted" ? "posted" : input.postStatus,
    listingId,
    jobId: input.jobId,
    sku: input.sku,
    ebayWrite: false,
    marksLinked: false,
  };
}
