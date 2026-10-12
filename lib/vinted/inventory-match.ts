import { normalizeTitle } from "@/lib/vinted/match";

export const VINTED_SYNC_PILOT_LIMIT = 10;
export const VINTED_SYNC_BATCH_LIMIT = 50;

export interface EbayInventoryCandidate {
  sku: string;
  ebayTitle: string;
  vintedTitle: string;
  brand: string;
  size: string;
  photoUrl: string;
}

export interface VintedCollectedItem {
  vintedItemId: string;
  title: string;
  url: string;
  photoUrl: string;
  brand: string;
  size: string;
}

export type VintedMatchStatus = "verified" | "review" | "unmatched";

export interface VintedInventoryMatch {
  status: VintedMatchStatus;
  sku: string;
  suggestedSku: string;
  title: string;
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

function signalMatch(itemValue: string, candidateValue: string): "match" | "miss" | "skip" {
  if (!itemValue.trim() || !candidateValue.trim()) return "skip";
  return sameText(itemValue, candidateValue) ? "match" : "miss";
}

export function matchVintedListing(
  item: VintedCollectedItem,
  candidates: EbayInventoryCandidate[]
): VintedInventoryMatch {
  const title = item.title.trim();
  const exact = candidates.filter((candidate) =>
    titlesOf(candidate).some((stored) => sameText(stored, title))
  );
  if (exact.length === 1) {
    const chosen = exact[0];
    return {
      status: "verified",
      sku: chosen.sku,
      suggestedSku: "",
      title: titlesOf(chosen)[0] || title,
      detail: "Coincidencia exacta y única de título.",
    };
  }
  if (exact.length > 1) {
    return {
      status: "review",
      sku: "",
      suggestedSku: "",
      title,
      detail: `Varios SKU comparten el título: ${exact.map((candidate) => candidate.sku).join(", ")}.`,
    };
  }

  const ranked = candidates
    .map((candidate) => {
      const brand = signalMatch(item.brand, candidate.brand);
      const size = signalMatch(item.size, candidate.size);
      const photo = signalMatch(item.photoUrl, candidate.photoUrl);
      const signals = [brand, size, photo];
      const comparable = signals.filter((signal) => signal !== "skip").length;
      const matched = signals.filter((signal) => signal === "match").length;
      const missed = signals.filter((signal) => signal === "miss").length;
      return { candidate, comparable, matched, missed };
    })
    .filter((row) => row.comparable > 0 && row.matched === row.comparable && row.missed === 0);

  if (ranked.length === 1) {
    return {
      status: "review",
      sku: "",
      suggestedSku: ranked[0].candidate.sku,
      title,
      detail: "El título no coincide. Marca, talla o foto apuntan a un solo SKU; queda para revisión.",
    };
  }
  if (ranked.length > 1) {
    return {
      status: "review",
      sku: "",
      suggestedSku: "",
      title,
      detail: `Varias coincidencias parciales: ${ranked.map((row) => row.candidate.sku).join(", ")}.`,
    };
  }
  return {
    status: "unmatched",
    sku: "",
    suggestedSku: "",
    title,
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
    };
  });
}

function parseCsvImport(raw: string): VintedCollectedItem[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].toLowerCase();
  const start = /title|url|id/.test(header) ? 1 : 0;
  return lines.slice(start).map((line) => {
    const [title = "", url = "", id = "", photo = "", brand = "", size = ""] = splitCsv(line);
    return { vintedItemId: id, title, url, photoUrl: photo, brand, size };
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
