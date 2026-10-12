export interface MatchCandidateCard {
  sku: string;
  title: string;
  ebayItemId: string;
  photoUrl: string;
}

export interface RejectedCandidate {
  sku: string;
  ebayItemId: string;
}

export interface CandidateListing {
  vintedItemId: string;
  sku: string;
  suggestedSku: string;
  ebayItemId: string;
  matchStatus: string;
  detail: string;
  candidates: MatchCandidateCard[];
  rejected: RejectedCandidate[];
}

function cleanSku(value: string): string {
  return value.trim().toUpperCase();
}

function cleanItemId(value: string): string {
  return value.replace(/\D/g, "");
}

export function candidateIsRejected(
  candidate: { sku: string; ebayItemId: string },
  rejected: RejectedCandidate[]
): boolean {
  const sku = cleanSku(candidate.sku);
  const itemId = cleanItemId(candidate.ebayItemId);
  return rejected.some((row) => {
    const rejectedSku = cleanSku(row.sku);
    const rejectedId = cleanItemId(row.ebayItemId);
    if (itemId && rejectedId) return itemId === rejectedId;
    return Boolean(sku) && sku === rejectedSku && (!itemId || !rejectedId);
  });
}

export function withoutRejectedCandidates<T extends { sku: string; ebayItemId: string }>(
  candidates: T[],
  rejected: RejectedCandidate[]
): T[] {
  return candidates.filter((candidate) => !candidateIsRejected(candidate, rejected));
}

export function parseRejectedCandidates(value: unknown): RejectedCandidate[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 50).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const sku = String(record.sku || "").trim();
      const ebayItemId = String(record.ebayItemId || "").replace(/\D/g, "");
      if (!sku && !ebayItemId) return [];
      return [{ sku, ebayItemId }];
    });
  } catch {
    return [];
  }
}

export function rejectOneCandidate<T extends CandidateListing>(
  row: T,
  target: RejectedCandidate
): { ok: true; row: T } | { ok: false; error: string } {
  const sku = target.sku.trim();
  const ebayItemId = cleanItemId(target.ebayItemId);
  if (!sku && !ebayItemId) return { ok: false, error: "Falta la coincidencia." };
  if (row.matchStatus === "verified") return { ok: false, error: "Esa asociación ya está verificada." };
  const rejected = candidateIsRejected({ sku, ebayItemId }, row.rejected)
    ? row.rejected
    : [...row.rejected, { sku, ebayItemId }];
  const candidates = withoutRejectedCandidates(row.candidates, rejected);
  const suggestedStillThere = candidates.some((candidate) => cleanSku(candidate.sku) === cleanSku(row.suggestedSku));
  const suggestedSku = suggestedStillThere ? row.suggestedSku : candidates.find((candidate) => candidate.sku.trim())?.sku || "";
  return {
    ok: true,
    row: {
      ...row,
      sku: cleanSku(row.sku) === cleanSku(sku) ? "" : row.sku,
      suggestedSku,
      ebayItemId: ebayItemId && cleanItemId(row.ebayItemId) === ebayItemId ? "" : row.ebayItemId,
      matchStatus: candidates.length ? "review" : "unmatched",
      detail: candidates.length ? row.detail : "Coincidencia rechazada. No se borró la publicación.",
      candidates,
      rejected,
    },
  };
}

export function rejectCandidateOnListings<T extends CandidateListing>(
  rows: T[],
  vintedItemId: string,
  target: RejectedCandidate
): { ok: true; rows: T[] } | { ok: false; error: string } {
  const id = vintedItemId.trim();
  const index = rows.findIndex((row) => row.vintedItemId === id);
  if (index < 0) return { ok: false, error: "No existe esa publicación." };
  const result = rejectOneCandidate(rows[index], target);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, rows: rows.map((row, position) => (position === index ? result.row : row)) };
}

export function omitRejectedMatch<T extends { sku: string; suggestedSku: string; ebayItemId: string; status: string; detail: string; candidates: MatchCandidateCard[] }>(
  match: T,
  rejected: RejectedCandidate[]
): T {
  const candidates = withoutRejectedCandidates(match.candidates, rejected);
  const chosen = candidateIsRejected({ sku: match.sku || match.suggestedSku, ebayItemId: match.ebayItemId }, rejected);
  if (!chosen) return { ...match, candidates };
  const suggestedSku = candidates.find((candidate) => candidate.sku.trim())?.sku || "";
  return {
    ...match,
    status: candidates.length ? "review" : "unmatched",
    sku: "",
    suggestedSku,
    ebayItemId: "",
    detail: candidates.length ? "Hay otras coincidencias. La rechazada no se volvió a sugerir." : "Coincidencia rechazada. No se borró la publicación.",
    candidates,
  };
}

export function confirmCandidateOnListings<T extends CandidateListing>(
  rows: T[],
  vintedItemId: string,
  sku: string,
  ebayItemId: string
): { ok: true; rows: T[] } | { ok: false; error: string } {
  const id = vintedItemId.trim();
  const wantedSku = sku.trim();
  const wantedItemId = cleanItemId(ebayItemId);
  if (!id || !wantedSku) return { ok: false, error: "Faltan el anuncio de Vinted o el SKU." };
  const index = rows.findIndex((row) => row.vintedItemId === id);
  if (index < 0) return { ok: false, error: "No existe esa publicación." };
  const row = rows[index];
  if (row.matchStatus === "verified") return { ok: false, error: "Esa asociación ya está verificada." };
  const chosen = row.candidates.find((candidate) => {
    if (candidate.sku.trim() !== wantedSku) return false;
    if (wantedItemId && cleanItemId(candidate.ebayItemId) !== wantedItemId) return false;
    return true;
  });
  if (wantedItemId && !chosen) return { ok: false, error: "Esa coincidencia ya no está en esta publicación." };
  const linkedItemId = cleanItemId(chosen?.ebayItemId || "");
  const next = {
    ...row,
    sku: wantedSku,
    suggestedSku: "",
    ebayItemId: linkedItemId || row.ebayItemId,
    matchStatus: "verified",
    detail: "Confirmado manualmente.",
    candidates: [],
  };
  return { ok: true, rows: rows.map((item, position) => (position === index ? next : item)) };
}
