import { cleanEbayItemId, cleanVintedCard, sizesEquivalent } from "@/lib/vinted/card-text";
import { normalizeTitle } from "@/lib/vinted/match";

export const VINTED_SYNC_PILOT_LIMIT = 30;
export const VINTED_SYNC_BATCH_LIMIT = 30;

export interface EbayInventoryCandidate {
  sku: string;
  ebayTitle: string;
  vintedTitle: string;
  brand: string;
  size: string;
  photoUrl: string;
  color?: string;
  category?: string;
  ebayItemId?: string;
}

export interface VintedCollectedItem {
  vintedItemId: string;
  title: string;
  url: string;
  photoUrl: string;
  brand: string;
  size: string;
  listedSku?: string;
  cardText?: string;
  color?: string;
  category?: string;
}

export type VintedMatchStatus = "verified" | "review" | "unmatched";

export interface VintedInventoryMatch {
  status: VintedMatchStatus;
  sku: string;
  suggestedSku: string;
  title: string;
  ebayItemId: string;
  detail: string;
}

function sameText(left: string, right: string): boolean {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  return Boolean(a) && a === b;
}

function titlesOf(candidate: EbayInventoryCandidate): string[] {
  return [candidate.ebayTitle, candidate.vintedTitle].map((title) => title.trim()).filter(Boolean);
}

function signalMatch(itemValue: string, candidateValue: string, kind: "text" | "size" = "text"): "match" | "miss" | "skip" {
  if (!itemValue.trim() || !candidateValue.trim()) return "skip";
  const matched = kind === "size" ? sizesEquivalent(itemValue, candidateValue) : sameText(itemValue, candidateValue);
  return matched ? "match" : "miss";
}

function itemIdOf(candidate: EbayInventoryCandidate): string {
  return cleanEbayItemId(candidate.ebayItemId || "") || "";
}

export function prepareCollectedItem(item: VintedCollectedItem): VintedCollectedItem {
  const fromCard = cleanVintedCard(item.cardText || "");
  const fromTitle = cleanVintedCard(item.title);
  const title = fromTitle.title || fromCard.title || item.title.trim();
  return {
    ...item,
    title,
    brand: item.brand.trim() || fromCard.brand,
    size: item.size.trim() || fromCard.size || fromTitle.size,
  };
}

export function uniqueVerifiedVintedUrl(urls: string[]): string | null {
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  return unique.length === 1 ? unique[0] : null;
}

export function skuFromStoredText(...parts: string[]): string {
  for (const part of parts) {
    const match = String(part || "").match(/\bSKU:\s*([A-Za-z0-9][A-Za-z0-9-]{2,40})\b/i);
    if (match?.[1]) return match[1];
  }
  return "";
}

export function reserveUniqueSkus(
  proposals: { id: string; match: VintedInventoryMatch }[],
  alreadyVerified: string[]
): { id: string; match: VintedInventoryMatch }[] {
  const used = new Set(alreadyVerified.map((sku) => sku.trim()).filter(Boolean));
  const claimed = new Map<string, number>();
  for (const proposal of proposals) {
    if (proposal.match.status !== "verified" || !proposal.match.sku) continue;
    claimed.set(proposal.match.sku, (claimed.get(proposal.match.sku) ?? 0) + 1);
  }
  return proposals.map((proposal) => {
    if (proposal.match.status !== "verified" || !proposal.match.sku) return proposal;
    const duplicated = (claimed.get(proposal.match.sku) ?? 0) > 1 || used.has(proposal.match.sku);
    if (!duplicated) {
      used.add(proposal.match.sku);
      return proposal;
    }
    return {
      id: proposal.id,
      match: {
        ...proposal.match,
        status: "review",
        sku: "",
        suggestedSku: proposal.match.sku,
        ebayItemId: "",
        detail: used.has(proposal.match.sku)
          ? "Ese SKU ya está asociado a otra publicación de Vinted."
          : "Ese SKU corresponde a varios artículos de Vinted. Queda para revisión.",
      },
    };
  });
}

export function matchVintedListing(
  item: VintedCollectedItem,
  candidates: EbayInventoryCandidate[]
): VintedInventoryMatch {
  const prepared = prepareCollectedItem(item);
  const title = prepared.title.trim();
  const listedSku = prepared.listedSku?.trim() ?? "";
  const exact = candidates.filter((candidate) =>
    titlesOf(candidate).some((stored) => sameText(stored, title))
  );
  const byListedSku = listedSku ? candidates.filter((candidate) => candidate.sku === listedSku) : [];
  if (byListedSku.length > 1) {
    return {
      status: "review",
      sku: "",
      suggestedSku: "",
      title,
      ebayItemId: "",
      detail: "Ese SKU aparece en varias publicaciones de eBay.",
    };
  }
  if (byListedSku.length === 1) {
    const chosen = byListedSku[0];
    const titleAgrees = titlesOf(chosen).some((stored) => sameText(stored, title));
    const titleElsewhere = exact.some((candidate) => candidate.sku !== listedSku);
    if (titleAgrees && !titleElsewhere) {
      return {
        status: "verified",
        sku: listedSku,
        suggestedSku: "",
        title,
        ebayItemId: itemIdOf(chosen),
        detail: "El SKU de la descripción y el título coinciden con una sola publicación de eBay.",
      };
    }
    return {
      status: "review",
      sku: "",
      suggestedSku: listedSku,
      title,
      ebayItemId: "",
      detail: titleElsewhere
        ? "El SKU de la descripción y el título no señalan el mismo artículo."
        : "El SKU está en eBay, pero el título no confirma que sea el mismo artículo.",
    };
  }
  if (listedSku && !byListedSku.length && exact.length === 1 && exact[0].sku !== listedSku) {
    return {
      status: "review",
      sku: "",
      suggestedSku: "",
      title,
      ebayItemId: "",
      detail: "La publicación trae un SKU que no está en eBay y el título apunta a otro.",
    };
  }
  if (exact.length === 1) {
    const chosen = exact[0];
    return {
      status: "verified",
      sku: chosen.sku,
      suggestedSku: "",
      title,
      ebayItemId: itemIdOf(chosen),
      detail: "Coincidencia exacta y única de título.",
    };
  }
  if (exact.length > 1) {
    return {
      status: "review",
      sku: "",
      suggestedSku: "",
      title,
      ebayItemId: "",
      detail: `Varios SKU comparten el título: ${exact.map((candidate) => candidate.sku).join(", ")}.`,
    };
  }

  const ranked = candidates
    .map((candidate) => {
      const brand = signalMatch(prepared.brand, candidate.brand);
      const size = signalMatch(prepared.size, candidate.size, "size");
      const photo = signalMatch(item.photoUrl, candidate.photoUrl);
      const color = signalMatch(prepared.color || "", candidate.color || "");
      const category = signalMatch(prepared.category || "", candidate.category || "");
      const signals = [brand, size, photo, color, category];
      const comparable = signals.filter((signal) => signal !== "skip").length;
      const matched = signals.filter((signal) => signal === "match").length;
      const missed = signals.filter((signal) => signal === "miss").length;
      return { candidate, comparable, matched, missed };
    })
    .filter((row) => row.comparable >= 2 && row.matched === row.comparable && row.missed === 0);

  if (ranked.length === 1) {
    return {
      status: "review",
      sku: "",
      suggestedSku: ranked[0].candidate.sku,
      title,
      ebayItemId: "",
      detail: "El título no coincide. Marca, talla o foto apuntan a un solo SKU; queda para revisión.",
    };
  }
  if (ranked.length > 1) {
    return {
      status: "review",
      sku: "",
      suggestedSku: "",
      title,
      ebayItemId: "",
      detail: `Varias coincidencias parciales: ${ranked.map((row) => row.candidate.sku).join(", ")}.`,
    };
  }
  return {
    status: "unmatched",
    sku: "",
    suggestedSku: "",
    title,
    ebayItemId: "",
    detail: "No hay una coincidencia única con el inventario de eBay.",
  };
}

const ITEM_PATH = /\/items\/(\d+)(?:-[^/?#]*)?/i;

export function parseVintedItemLink(href: string): { vintedItemId: string; url: string } | null {
  const match = href.match(ITEM_PATH);
  if (!match?.[1]) return null;
  let url: URL;
  try {
    url = new URL(href, "https://www.vinted.com");
  } catch {
    return null;
  }
  if (!/vinted\./i.test(url.hostname)) return null;
  url.hash = "";
  url.search = "";
  return { vintedItemId: match[1], url: url.toString() };
}

export function parseInventoryImport(text: string): VintedCollectedItem[] {
  const raw = text.trim();
  if (!raw) return [];
  const rows = raw.startsWith("[") || raw.startsWith("{") ? parseJsonImport(raw) : parseCsvImport(raw);
  const seen = new Set<string>();
  const items: VintedCollectedItem[] = [];
  for (const row of rows) {
    const link = parseVintedItemLink(row.url || "");
    const vintedItemId = (row.vintedItemId || link?.vintedItemId || "").trim();
    const url = (link?.url || row.url || "").trim();
    if (!vintedItemId || !url || seen.has(vintedItemId)) continue;
    seen.add(vintedItemId);
    items.push({
      vintedItemId,
      title: row.title.trim(),
      url,
      photoUrl: row.photoUrl.trim(),
      brand: row.brand.trim(),
      size: row.size.trim(),
      listedSku: (row.listedSku || "").trim(),
    });
  }
  return items;
}

function parseJsonImport(raw: string): VintedCollectedItem[] {
  const parsed = JSON.parse(raw) as unknown;
  const list = Array.isArray(parsed) ? parsed : [];
  return list.map((row) => {
    const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    return {
      vintedItemId: String(record.vintedItemId || record.id || ""),
      title: String(record.title || ""),
      url: String(record.url || ""),
      photoUrl: String(record.photoUrl || record.photo || ""),
      brand: String(record.brand || ""),
      size: String(record.size || ""),
      listedSku: String(record.listedSku || record.sku || ""),
    };
  });
}

function parseCsvImport(raw: string): VintedCollectedItem[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].toLowerCase();
  const start = /title|url|id/.test(header) ? 1 : 0;
  return lines.slice(start).map((line) => {
    const [title = "", url = "", id = "", photo = "", brand = "", size = "", listedSku = ""] = splitCsv(line);
    return { vintedItemId: id, title, url, photoUrl: photo, brand, size, listedSku };
  });
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}
