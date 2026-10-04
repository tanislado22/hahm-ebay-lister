export interface TitleCandidate {
  sku: string;
  vintedTitle: string;
  ebayTitle: string;
}

export type TitleMatch =
  | { kind: "unique"; sku: string; title: string }
  | { kind: "none" }
  | { kind: "ambiguous"; skus: string[] };

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayTitle(candidate: TitleCandidate): string {
  return (candidate.vintedTitle || candidate.ebayTitle || "").trim();
}

function storedTitles(candidate: TitleCandidate): string[] {
  return [candidate.vintedTitle, candidate.ebayTitle].map(normalizeTitle).filter(Boolean);
}

// Exact normalized title first. A single contained match is accepted only when
// the stored title is long enough to be specific. Zero or several matches stay
// unresolved so the caller can record a review event instead of guessing.
export function matchSoldTitle(emailTitle: string, candidates: TitleCandidate[]): TitleMatch {
  const needle = normalizeTitle(emailTitle);
  if (!needle) return { kind: "none" };

  const exact = candidates.filter((candidate) =>
    storedTitles(candidate).some((title) => title === needle)
  );
  if (exact.length === 1) {
    return { kind: "unique", sku: exact[0].sku, title: displayTitle(exact[0]) };
  }
  if (exact.length > 1) {
    return { kind: "ambiguous", skus: exact.map((candidate) => candidate.sku) };
  }

  const contained = candidates.filter((candidate) =>
    storedTitles(candidate).some((title) => title.length >= 12 && needle.includes(title))
  );
  if (contained.length === 1) {
    return { kind: "unique", sku: contained[0].sku, title: displayTitle(contained[0]) };
  }
  if (contained.length > 1) {
    return { kind: "ambiguous", skus: contained.map((candidate) => candidate.sku) };
  }
  return { kind: "none" };
}
