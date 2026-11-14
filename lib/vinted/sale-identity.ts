import { extractSoldTitle } from "@/lib/vinted/email";
import { matchSoldTitle, type TitleCandidate } from "@/lib/vinted/match";

export const UNIDENTIFIED_ITEM_TITLE = "No identificado";

const SKU_TOKEN = /SKU:[ \t]*([A-Za-z0-9][A-Za-z0-9-]{2,40})\b/gi;

/** SKU lines written into Vinted descriptions: `SKU: 2830`. Several different values are not a match. */
export function extractDescriptionSkus(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(SKU_TOKEN)) {
    const sku = match[1]?.trim() ?? "";
    if (sku && !found.includes(sku)) found.push(sku);
  }
  return found;
}

function titleOf(candidate: TitleCandidate | undefined): string {
  return (candidate?.vintedTitle || candidate?.ebayTitle || "").trim();
}

/**
 * Prefer one `SKU:` token from the email. Otherwise use one exact title match.
 * If those two disagree, leave the SKU empty instead of choosing one.
 */
export function resolveSaleIdentity(
  emailTitle: string,
  body: string,
  candidates: TitleCandidate[]
): { sku: string; title: string } {
  const listed = extractDescriptionSkus(body);
  const emailSku = listed.length === 1 ? listed[0] : "";
  const matched = emailTitle.trim() ? matchSoldTitle(emailTitle, candidates) : { kind: "none" as const };
  const titleSku = matched.kind === "unique" ? matched.sku : "";
  const storedTitle = matched.kind === "unique" ? matched.title : "";
  let title = (storedTitle || emailTitle.trim() || UNIDENTIFIED_ITEM_TITLE).slice(0, 180);
  if (emailSku && titleSku && emailSku !== titleSku) return { sku: "", title };
  const sku = emailSku || titleSku;
  if (sku && title === UNIDENTIFIED_ITEM_TITLE) {
    const known = titleOf(candidates.find((candidate) => candidate.sku === sku));
    if (known) title = known.slice(0, 180);
  }
  return { sku, title };
}

const MARKETPLACE_SALE_LINES = [
  /you (?:just )?made a sale/i,
  /your item (?:just )?sold/i,
  /ka-ching|cha-ching/i,
  /congrats,? you sold/i,
  /you(?:'ve| have) sold/i,
  /sold! time to ship/i,
];

function pushGuess(guesses: string[], value: string): void {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length < 6 || clean.length > 180) return;
  if (guesses.some((item) => item.toLowerCase() === clean.toLowerCase())) return;
  guesses.push(clean);
}

/** Subject and body lines that might be the garment title in a Poshmark or Depop email. */
export function marketplaceTitleGuesses(subject: string, body: string): string[] {
  const guesses: string[] = [];
  pushGuess(guesses, extractSoldTitle(subject, body, MARKETPLACE_SALE_LINES));
  const subjectItem = subject.match(/(?:sold|sale)[:\s-]+(.{6,180})$/i);
  if (subjectItem?.[1]) pushGuess(guesses, subjectItem[1]);
  for (const line of body.split(/\r?\n/)) {
    const clean = line.replace(/\s+/g, " ").trim();
    if (/^(order\b|total\b|buyer\b|ship\b|shipping\b|thanks\b|thank you\b|poshmark\b|depop\b|view\b|http|www\.)/i.test(clean)) continue;
    if (/^SKU:/i.test(clean)) continue;
    pushGuess(guesses, clean);
    if (guesses.length >= 12) break;
  }
  return guesses;
}

/**
 * Match a Poshmark or Depop email to one garment by a single SKU line or by one title.
 * Several different matches stay unidentified.
 */
export function resolveMarketplaceIdentity(
  subject: string,
  body: string,
  candidates: TitleCandidate[]
): { sku: string; title: string } {
  const guesses = marketplaceTitleGuesses(subject, body);
  const primary = guesses[0] || "";
  const listed = extractDescriptionSkus(body);
  const emailSku = listed.length === 1 ? listed[0] : "";
  const matchedSkus = new Set<string>();
  let storedTitle = "";
  for (const guess of guesses) {
    const matched = matchSoldTitle(guess, candidates);
    if (matched.kind === "ambiguous") {
      return { sku: "", title: (storedTitle || primary || UNIDENTIFIED_ITEM_TITLE).slice(0, 180) };
    }
    if (matched.kind === "unique" && matched.sku) {
      matchedSkus.add(matched.sku);
      storedTitle = matched.title;
    }
  }
  let title = (storedTitle || primary || UNIDENTIFIED_ITEM_TITLE).slice(0, 180);
  const titleSku = matchedSkus.size === 1 ? [...matchedSkus][0] : "";
  if (emailSku && titleSku && emailSku !== titleSku) return { sku: "", title };
  if (matchedSkus.size > 1) return { sku: "", title };
  const sku = emailSku || titleSku;
  if (sku && title === UNIDENTIFIED_ITEM_TITLE) {
    const known = titleOf(candidates.find((candidate) => candidate.sku === sku));
    if (known) title = known.slice(0, 180);
  }
  return { sku, title };
}
