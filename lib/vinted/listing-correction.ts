// Local corrections for one Vinted inventory row.
// The SKU is text: "1195" is not "01195", "1195.0", or "11950".

export interface ActiveSkuListing {
  sku: string;
  title: string;
  photoUrl: string;
  ebayItemId: string;
  active?: boolean;
}

export interface SkuPhotoMatch {
  sku: string;
  title: string;
  photoUrl: string;
  ebayItemId: string;
}

export interface UnlinkSnapshot {
  sku: string;
  url: string;
  photoUrl: string;
  ebayItemId: string;
  title: string;
  vintedUnlinkedAt?: string;
}

export interface UnlinkedRecord {
  sku: string;
  url: string;
  status: "unmatched";
  reviewedAt: "";
  verifiedAt: "";
  suggestedSku: "";
  photoUrl: string;
  ebayItemId: string;
  title: string;
  vintedUnlinked: true;
  discardedVintedUrl: string;
  detail: string;
}

export function skuText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function sameSkuText(left: unknown, right: unknown): boolean {
  const a = skuText(left);
  const b = skuText(right);
  return a.length > 0 && a === b;
}

export function selectUniqueActiveSkuPhoto(
  sku: unknown,
  listings: ActiveSkuListing[]
): { ok: true; match: SkuPhotoMatch } | { ok: false; error: string } {
  const wanted = skuText(sku);
  if (!wanted) return { ok: false, error: "Este registro no tiene SKU. No se cambió la foto." };
  const matches: SkuPhotoMatch[] = [];
  const seen = new Set<string>();
  for (const listing of listings) {
    if (listing.active === false) continue;
    if (!sameSkuText(listing.sku, wanted)) continue;
    const ebayItemId = String(listing.ebayItemId || "").replace(/\D/g, "");
    const photoUrl = String(listing.photoUrl || "").trim();
    const title = String(listing.title || "").trim();
    const foundSku = skuText(listing.sku);
    const key = ebayItemId || `${foundSku}\n${title}\n${photoUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ sku: foundSku, title, photoUrl, ebayItemId });
  }
  if (matches.length === 0) {
    return { ok: false, error: `No hay una publicación activa con el SKU ${wanted}. No se cambió la foto.` };
  }
  if (matches.length > 1) {
    return { ok: false, error: `Hay ${matches.length} publicaciones activas con el SKU ${wanted}. No se cambió la foto.` };
  }
  const match = matches[0];
  if (!match.photoUrl) {
    return { ok: false, error: `La publicación activa con el SKU ${wanted} no tiene foto. No se cambió la imagen.` };
  }
  return { ok: true, match };
}

export function confirmPhotoMatchesPreview(
  match: SkuPhotoMatch,
  preview: { sku: unknown; ebayItemId: unknown }
): boolean {
  if (!sameSkuText(match.sku, preview.sku)) return false;
  const wanted = typeof preview.ebayItemId === "string" ? preview.ebayItemId.replace(/\D/g, "") : "";
  const found = match.ebayItemId.replace(/\D/g, "");
  return Boolean(found) && wanted === found;
}

export function planVintedUnlink(
  row: UnlinkSnapshot
): { ok: true; next: UnlinkedRecord } | { ok: false; error: string } {
  if (row.vintedUnlinkedAt) {
    return { ok: false, error: "Esa publicación de Vinted ya está desvinculada. No se modificó el registro." };
  }
  return {
    ok: true,
    next: {
      sku: row.sku,
      url: "",
      status: "unmatched",
      reviewedAt: "",
      verifiedAt: "",
      suggestedSku: "",
      photoUrl: row.photoUrl,
      ebayItemId: row.ebayItemId,
      title: row.title,
      vintedUnlinked: true,
      discardedVintedUrl: row.url.trim(),
      detail: "Publicación de Vinted desvinculada. El SKU se conserva y el registro queda pendiente de vincular.",
    },
  };
}

export function syncKeepsDiscardedVinted(stored: { vintedUnlinkedAt?: string | null } | null | undefined): boolean {
  return Boolean(stored?.vintedUnlinkedAt);
}

export function urlAfterSync(
  stored: { url: string; manualVintedUrlAt?: string | null },
  incomingUrl: string
): string {
  if (stored.manualVintedUrlAt) return stored.url;
  return incomingUrl;
}

export function photoAfterSync(
  stored: { photoUrl: string; manualPhotoAt?: string | null },
  incomingPhoto: string,
  verified: boolean
): string {
  if (stored.manualPhotoAt) return stored.photoUrl;
  if (verified) return incomingPhoto !== "" ? incomingPhoto : stored.photoUrl;
  return incomingPhoto;
}

export function keptAfterDiscardedSync<T extends { vintedUnlinkedAt?: string | null }>(stored: T): T | null {
  return syncKeepsDiscardedVinted(stored) ? stored : null;
}
