import {
  brandKey,
  brandPattern,
  garmentKind,
  sizeKey,
  type CatalogListing,
  type GarmentQuery,
} from "@/lib/markets/guatemala-price-match";

const MEGAPACA_ORIGIN = "https://megapaca.store";
const MEGAPACA_SHOP = "megapacas.myshopify.com";
// Public catalog search embedded in Megapaca's storefront. No key.
const MEGAPACA_SEARCH = "https://services.mybcapps.com/bc-sf-filter/search";
const ECONOPACA_ORIGIN = "https://store.econopaca.com";
// Public id shipped in Econopaca's storefront. It is not a secret.
const ECONOPACA_APP_ID = "6949e71bf5e5a516607433ce";
const REQUEST_TIMEOUT_MS = 8000;
const MEGAPACA_LIMIT = "50";

// Megapaca titles say "playera" and "chumpa" where this store says camiseta and chaqueta.
const MEGAPACA_WORDS: Record<string, string[]> = {
  camiseta: ["playera", "camiseta"],
  chaqueta: ["chaqueta", "chumpa"],
  sueter: ["sueter", "sweater"],
};

const TAG_PRIORITY = [
  "jeans",
  "camiseta",
  "chaqueta",
  "sudadera",
  "sueter",
  "vestido",
  "short",
  "falda",
  "polo",
  "tenis",
  "bota",
  "zapato",
  "bolso",
  "blusa",
  "camisa",
  "pantalon",
];

export interface CatalogFetch {
  items: CatalogListing[];
  errors: string[];
}

export async function fetchGuatemalaAdvertised(query: GarmentQuery): Promise<CatalogFetch> {
  const [megapaca, econopaca] = await Promise.all([
    fetchMegapaca(query),
    fetchEconopaca(query),
  ]);
  return {
    items: [...megapaca.items, ...econopaca.items],
    errors: [megapaca.error, econopaca.error].filter((error): error is string => Boolean(error)),
  };
}

async function fetchMegapaca(query: GarmentQuery): Promise<{ items: CatalogListing[]; error: string | null }> {
  const kind = garmentKind(query.itemType, query.title);
  if (!kind) return { items: [], error: null };
  const brand = brandKey(query.brand);
  const words = MEGAPACA_WORDS[kind.key] ?? [kind.search];
  const searches = await Promise.all(
    words.map((word) => searchMegapaca([brand, word].filter(Boolean).join(" ")))
  );
  const failed = searches.every((result) => result.failed);
  return {
    items: searches.flatMap((result) => result.items),
    error: failed ? "No se pudo consultar Megapaca." : null,
  };
}

async function searchMegapaca(term: string): Promise<{ items: CatalogListing[]; failed: boolean }> {
  const boostParams = new URLSearchParams({
    shop: MEGAPACA_SHOP,
    q: term,
    limit: MEGAPACA_LIMIT,
    page: "1",
  });
  const boost = await requestJson(`${MEGAPACA_SEARCH}?${boostParams.toString()}`);
  if (boost.ok && boost.body && typeof boost.body === "object") {
    return { items: parseMegapacaBoost(boost.body), failed: false };
  }
  const params = new URLSearchParams();
  params.set("q", term);
  params.set("resources[type]", "product");
  params.set("resources[limit]", "10");
  params.set("resources[options][unavailable_products]", "last");
  const suggest = await requestJson(`${MEGAPACA_ORIGIN}/search/suggest.json?${params.toString()}`);
  if (suggest.ok && suggest.body && typeof suggest.body === "object") {
    return { items: parseMegapacaSuggest(suggest.body), failed: false };
  }
  return { items: [], failed: true };
}

async function fetchEconopaca(query: GarmentQuery): Promise<{ items: CatalogListing[]; error: string | null }> {
  const kind = garmentKind(query.itemType, query.title);
  if (!kind) return { items: [], error: null };
  const brand = brandKey(query.brand);
  const precise = await requestEconopaca(kind.query, brand);
  if (precise.ok && Array.isArray(precise.body)) {
    return { items: parseEconopacaProducts(precise.body), error: null };
  }
  const simpler = await requestEconopaca(kind.search, brand);
  if (simpler.ok && Array.isArray(simpler.body)) {
    return { items: parseEconopacaProducts(simpler.body), error: null };
  }
  return { items: [], error: "No se pudo consultar Econopaca." };
}

async function requestEconopaca(typePattern: string, brand: string | null) {
  const filter: Record<string, unknown> = {
    is_active: true,
    stock: { $gte: 1 },
    type: { $regex: typePattern, $options: "i" },
  };
  if (brand) filter.brand = { $regex: brandPattern(brand), $options: "i" };
  const params = new URLSearchParams({
    q: JSON.stringify(filter),
    limit: "80",
    fields: "name,price,brand,type,condition,size,id,subcategory,stock",
    sort: "-updated_date",
  });
  return requestJson(
    `${ECONOPACA_ORIGIN}/api/apps/${ECONOPACA_APP_ID}/entities/Product?${params.toString()}`,
    { headers: { "X-App-Id": ECONOPACA_APP_ID, Accept: "application/json" } }
  );
}

export function parseMegapacaSuggest(body: unknown): CatalogListing[] {
  const products = megapacaProducts(body);
  return products.flatMap((product) => {
    if (!product || typeof product !== "object") return [];
    const row = product as Record<string, unknown>;
    if (row.available === false) return [];
    const title = text(row.title);
    const tags = Array.isArray(row.tags) ? row.tags.map((tag) => text(tag)) : [];
    const handle = text(row.handle);
    const url = handle
      ? `${MEGAPACA_ORIGIN}/products/${handle}`
      : absoluteMegapacaUrl(text(row.url));
    const price = positivePrice(row.price);
    if (!title || !url || price == null) return [];
    const body = text(row.body);
    return [
      {
        source: "megapaca" as const,
        title,
        priceGtq: price,
        url,
        brand: text(row.vendor),
        itemType: garmentTag(tags) || title,
        condition: conditionTag(tags) || conditionPhrase(body),
        size: listingSize(title, tags, body),
        audience: audienceTag(tags),
      },
    ];
  });
}

export function parseMegapacaBoost(body: unknown): CatalogListing[] {
  if (!body || typeof body !== "object") return [];
  const products = (body as { products?: unknown[] }).products;
  if (!Array.isArray(products)) return [];
  return parseMegapacaSuggest({
    resources: {
      results: {
        products: products.map((product) => {
          if (!product || typeof product !== "object") return product;
          const row = product as Record<string, unknown>;
          return {
            available: row.available,
            title: row.title,
            tags: row.tags,
            handle: row.handle,
            vendor: row.vendor,
            body: row.body_html ?? row.body,
            price: variantPrice(row) ?? row.price_min ?? row.price,
          };
        }),
      },
    },
  });
}

function variantPrice(row: Record<string, unknown>): unknown {
  if (!Array.isArray(row.variants)) return undefined;
  const available = row.variants.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return (entry as { available?: unknown }).available !== false;
  }) as { price?: unknown } | undefined;
  return available?.price;
}

export function parseEconopacaProducts(body: unknown): CatalogListing[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((product) => {
    if (!product || typeof product !== "object") return [];
    const row = product as Record<string, unknown>;
    const id = text(row.id);
    const title = text(row.name) || text(row.type);
    const price = positivePrice(row.price);
    const stock = Number(row.stock);
    if (!id || !title || price == null) return [];
    if (Number.isFinite(stock) && stock < 1) return [];
    return [
      {
        source: "econopaca" as const,
        title,
        priceGtq: price,
        url: `${ECONOPACA_ORIGIN}/ProductDetail?id=${encodeURIComponent(id)}`,
        brand: text(row.brand),
        itemType: text(row.type) || title,
        condition: text(row.condition),
        size: text(row.size),
        audience: text(row.subcategory),
      },
    ];
  });
}

function megapacaProducts(body: unknown): unknown[] {
  if (!body || typeof body !== "object") return [];
  const resources = (body as { resources?: { results?: { products?: unknown[] } } }).resources;
  return resources?.results?.products ?? [];
}

function garmentTag(tags: string[]): string {
  let best = "";
  let bestRank = TAG_PRIORITY.length;
  for (const tag of tags) {
    // "Hombre de Paca Bolsa" names the wholesale bag, not a handbag.
    if (/paca/i.test(tag)) continue;
    const kind = garmentKind(tag);
    if (!kind) continue;
    const rank = TAG_PRIORITY.indexOf(kind.key);
    if (rank !== -1 && rank < bestRank) {
      bestRank = rank;
      best = tag;
    }
  }
  return best;
}

function conditionTag(tags: string[]): string {
  return (
    tags.find((tag) => /nuevo|usada|usado|etiqueta/i.test(tag) && !/paca/i.test(tag)) ?? ""
  );
}

function conditionPhrase(body: string): string {
  const nuevo = body.match(/nuevo con etiqueta|nuevo|usado/i);
  return nuevo ? nuevo[0] : "";
}

function audienceTag(tags: string[]): string {
  return tags.find((tag) => /caballero|hombre|dama|mujer|niñ[oa]|nino|nina/i.test(tag)) ?? "";
}

function listingSize(title: string, tags: string[], body: string): string {
  const sizeTag = tags.find((tag) => tag.toLowerCase().startsWith("talla "));
  if (sizeTag) {
    const key = sizeKey(sizeTag);
    if (key) return key;
  }
  return sizeKey(title) || sizeFromBody(body) || "";
}

function sizeFromBody(body: string): string {
  const match = body.match(/talla\s*:\s*([^.<\n]{1,24})/i);
  if (!match) return "";
  return sizeKey(match[1]) ?? "";
}

function absoluteMegapacaUrl(url: string): string {
  if (!url) return "";
  const path = url.split("?")[0];
  if (path.startsWith("http")) return path;
  if (path.startsWith("/")) return `${MEGAPACA_ORIGIN}${path}`;
  return "";
}

function positivePrice(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(text(value));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 20000) return null;
  return Math.round(parsed * 100) / 100;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

async function requestJson(url: string, init?: RequestInit): Promise<{ ok: boolean; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json", ...init?.headers },
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, body };
  } catch {
    return { ok: false, body: null };
  } finally {
    clearTimeout(timer);
  }
}
