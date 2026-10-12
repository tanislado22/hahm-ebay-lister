import { normalizeTitle } from "@/lib/vinted/match";

const PRICE_LINE =
  /^(?:(?:us|usd|eur|gbp)\s*)?(?:[$€£]\s*)?\d{1,5}(?:[.,]\d{2})?(?:\s*[$€£])?(?:\s*(?:usd|eur|gbp))?$/i;
const CONDITION_LINE =
  /^(?:brand new|new with tags|new without tags|very good|good|satisfactory|nuevo(?:\s+con\s+etiquetas|\s+sin\s+etiquetas)?|muy bueno|bueno|satisfactorio)$/i;
const SIZE_LINE =
  /^(?:xxs|xs|s|m|l|xl|xxl|xxxl|ym|yl|ys|yxs|yxl|youth\s+(?:xs|s|m|l|xl|small|medium|large)|small|medium|med|large|x-large|xx-large|extra large|\d{1,2}(?:\.\d)?|\d{2}\s*[x×]\s*\d{2})$/i;

const SIZE_ALIASES: Record<string, string> = {
  ys: "youth-s",
  "youth s": "youth-s",
  "youth small": "youth-s",
  yxs: "youth-xs",
  "youth xs": "youth-xs",
  ym: "youth-m",
  "youth m": "youth-m",
  "youth medium": "youth-m",
  yl: "youth-l",
  "youth l": "youth-l",
  "youth large": "youth-l",
  yxl: "youth-xl",
  "youth xl": "youth-xl",
  "youth extra large": "youth-xl",
  xxs: "adult-xxs",
  xs: "adult-xs",
  "extra small": "adult-xs",
  s: "adult-s",
  small: "adult-s",
  m: "adult-m",
  medium: "adult-m",
  med: "adult-m",
  l: "adult-l",
  large: "adult-l",
  xl: "adult-xl",
  "x large": "adult-xl",
  "extra large": "adult-xl",
  xxl: "adult-xxl",
  xxxl: "adult-xxxl",
};

export interface VintedCardFields {
  title: string;
  brand: string;
  size: string;
  condition: string;
  price: string;
}

function linesOf(raw: string): string[] {
  return raw
    .split(/\r?\n|·|\||•/g)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function stripDecorations(title: string): string {
  return title
    .replace(/\bSKU:\s*[A-Za-z0-9][A-Za-z0-9-]{2,40}\b/gi, " ")
    .replace(/\s*(?:[$€£]\s*)?\d{1,5}[.,]\d{2}\s*(?:[$€£])?\s*$/g, " ")
    .replace(/\s+(?:very good|good|satisfactory|new with tags|new without tags|muy bueno|bueno|satisfactorio)\s*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanVintedCard(raw: string): VintedCardFields {
  const fields: VintedCardFields = { title: "", brand: "", size: "", condition: "", price: "" };
  const titleLines: string[] = [];
  for (const line of linesOf(raw)) {
    if (PRICE_LINE.test(line) || (/[$€£]\s?\d/.test(line) && line.length < 24)) {
      if (!fields.price) fields.price = line;
      continue;
    }
    if (CONDITION_LINE.test(line)) {
      if (!fields.condition) fields.condition = line;
      continue;
    }
    if (/^SKU:\s*[A-Za-z0-9][A-Za-z0-9-]{2,40}$/i.test(line)) continue;
    if (SIZE_LINE.test(line)) {
      if (!fields.size) fields.size = line;
      continue;
    }
    titleLines.push(line);
  }
  fields.title = stripDecorations(titleLines.join(" "));
  return fields;
}

export function canonicalSize(value: string): string {
  const key = normalizeTitle(value);
  if (!key) return "";
  return SIZE_ALIASES[key] || key;
}

export function sizesEquivalent(left: string, right: string): boolean {
  const a = canonicalSize(left);
  const b = canonicalSize(right);
  return Boolean(a) && a === b;
}

export function ebayItemUrl(itemId: string): string | null {
  const id = itemId.replace(/\D/g, "");
  if (id.length < 10 || id.length > 15) return null;
  return `https://www.ebay.com/itm/${id}`;
}

export function ebaySearchUrl(title: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(title.trim())}&_sacat=0`;
}

export function cleanEbayItemId(value: string): string | null {
  const id = value.replace(/\D/g, "");
  if (id.length < 10 || id.length > 15) return null;
  return id;
}
