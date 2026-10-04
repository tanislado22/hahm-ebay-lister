export interface VintedCategoryRule {
  itemType: string;
  path: string[];
}

// Reusable item-type → Vinted catalog path. These are Vinted's own labels,
// not eBay categories. The upload form is clicked step by step with this path.
export const DEFAULT_VINTED_CATEGORY_RULES: VintedCategoryRule[] = [
  { itemType: "Men's Jeans", path: ["Men", "Clothing", "Jeans"] },
  { itemType: "Women's Jeans", path: ["Women", "Clothing", "Jeans"] },
  { itemType: "Women's Shorts", path: ["Women", "Clothing", "Shorts & cropped pants"] },
  { itemType: "Men's Shorts", path: ["Men", "Clothing", "Shorts"] },
  { itemType: "Women's Blouse", path: ["Women", "Clothing", "Blouses"] },
  { itemType: "Men's Sneakers", path: ["Men", "Shoes", "Sneakers"] },
  { itemType: "Women's Sneakers", path: ["Women", "Shoes", "Sneakers"] },
  { itemType: "Men's T-shirts", path: ["Men", "Clothing", "T-shirts"] },
  { itemType: "Women's T-shirts", path: ["Women", "Clothing", "Tops & t-shirts"] },
];

export interface CategorySource {
  title?: string;
  brand?: string;
  itemType?: string;
  bucket?: string;
  savedCategory?: string;
}

export interface VintedCategoryMatch {
  itemType: string;
  path: string[];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseVintedCategoryPath(value: string): string[] {
  return value
    .split(/\s*(?:›|>|\/)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function formatVintedCategoryPath(path: string[]): string {
  return path.join(" › ");
}

function tokens(itemType: string): string[] {
  return normalize(itemType)
    .split(" ")
    .filter((token) => token && token !== "and" && token !== "the");
}

function haystack(source: CategorySource): string {
  return normalize(
    [source.bucket, source.itemType, source.title, source.brand].filter(Boolean).join(" ")
  );
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(?:^| )${word}(?: |$)`).test(text);
}

function isWomen(text: string): boolean {
  return hasWord(text, "women") || hasWord(text, "womens") || hasWord(text, "ladies");
}

function isMen(text: string): boolean {
  return !isWomen(text) && (hasWord(text, "men") || hasWord(text, "mens"));
}

function ruleByType(rules: VintedCategoryRule[], itemType: string): VintedCategoryRule | undefined {
  return rules.find((rule) => normalize(rule.itemType) === normalize(itemType));
}

function tokenMatch(rules: VintedCategoryRule[], text: string): VintedCategoryRule | null {
  const ranked = rules
    .map((rule) => ({ rule, tokens: tokens(rule.itemType) }))
    .filter((entry) => entry.tokens.length > 0 && entry.tokens.every((token) => hasWord(text, token)))
    .sort((a, b) => b.tokens.length - a.tokens.length);
  return ranked[0]?.rule ?? null;
}

function builtinMatch(text: string): VintedCategoryMatch | null {
  const women = isWomen(text);
  const men = isMen(text) || (!women && /shoe|sneaker/.test(text));
  const jeans = /jean/.test(text);
  const shorts = /short/.test(text);
  const blouse = /blouse/.test(text);
  const sneakers = /sneaker|jordan|dunk|air force|air max|trainer|running shoe|\bshoes?\b/.test(text);
  const tee = /t shirt|tshirt|\btee\b/.test(text);

  const pick = (itemType: string): VintedCategoryMatch | null => {
    const rule = ruleByType(DEFAULT_VINTED_CATEGORY_RULES, itemType);
    return rule ? { itemType: rule.itemType, path: [...rule.path] } : null;
  };

  if (women && blouse) return pick("Women's Blouse");
  if (women && shorts) return pick("Women's Shorts");
  if (men && shorts) return pick("Men's Shorts");
  if (women && jeans) return pick("Women's Jeans");
  if (men && jeans) return pick("Men's Jeans");
  if (women && sneakers) return pick("Women's Sneakers");
  if ((men || /nike/.test(text)) && sneakers && !women) return pick("Men's Sneakers");
  if (women && tee) return pick("Women's T-shirts");
  if (men && tee) return pick("Men's T-shirts");
  return null;
}

// Saved path wins. Otherwise a stored map wins over the built-in item types.
export function resolveVintedCategory(
  source: CategorySource,
  maps: VintedCategoryRule[] = []
): VintedCategoryMatch | null {
  const saved = parseVintedCategoryPath(source.savedCategory ?? "");
  if (saved.length >= 2) {
    return { itemType: source.itemType?.trim() || saved[saved.length - 1], path: saved };
  }
  const text = haystack(source);
  if (!text) return null;
  const fromMap = tokenMatch(maps, text);
  if (fromMap) return { itemType: fromMap.itemType, path: [...fromMap.path] };
  return builtinMatch(text);
}
