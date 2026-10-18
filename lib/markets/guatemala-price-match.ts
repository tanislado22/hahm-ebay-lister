import { formatQuetzales, GUATEMALA_MARKET } from "@/lib/markets/guatemala";
import type {
  GuatemalaAdvertisedComp,
  GuatemalaCompReport,
  GuatemalaSoldComp,
} from "@/lib/types";

export const MIN_RELEVANT_COMPS = 3;

export const GUATEMALA_ADVERTISED_LABEL =
  "Estos son precios anunciados, no ventas comprobadas.";

export interface GarmentQuery {
  title?: string;
  itemType?: string;
  brand?: string;
  condition?: string;
  size?: string;
  category?: string;
}

export interface CatalogListing {
  source: "megapaca" | "econopaca";
  title: string;
  priceGtq: number;
  url: string;
  brand: string;
  itemType: string;
  condition: string;
  size: string;
  audience: string;
}

export interface StoreSaleInput {
  sku: string;
  title: string;
  brand: string;
  size: string;
  condition: string;
  priceGtq: number;
  soldAt: string;
}

interface GarmentKind {
  key: string;
  search: string;
  query: string;
}

const GARMENT_KINDS: GarmentKind[] = [
  { key: "camiseta", search: "camiseta", query: "camiseta|playera" },
  { key: "camisa", search: "camisa", query: "camisa(?!eta)" },
  { key: "blusa", search: "blusa", query: "blusa" },
  { key: "vestido", search: "vestido", query: "vestido|dress" },
  { key: "jeans", search: "jeans", query: "jeans?" },
  { key: "short", search: "short", query: "shorts?" },
  { key: "pantalon", search: "pantalón", query: "pantal[oó]n" },
  { key: "falda", search: "falda", query: "falda|skirt" },
  { key: "chaqueta", search: "chaqueta", query: "chaqueta|chamarra|jacket|chumpa" },
  { key: "sudadera", search: "sudadera", query: "sudadera|hoodie" },
  { key: "sueter", search: "suéter", query: "su[eé]ter|sweater" },
  { key: "polo", search: "polo", query: "polo" },
  { key: "tenis", search: "tenis", query: "tenis|sneaker" },
  { key: "bota", search: "bota", query: "botas?|boots?" },
  { key: "zapato", search: "zapato", query: "zapatos?|shoes?" },
  { key: "bolso", search: "bolso", query: "bolso|bolsa|cartera" },
];

const KIND_BY_KEY = new Map(GARMENT_KINDS.map((kind) => [kind.key, kind]));

const DETECTORS: { key: string; pattern: RegExp }[] = [
  { key: "camiseta", pattern: /camiseta|playera|t-?shirt|\btee\b/ },
  { key: "camisa", pattern: /camisa(?!eta)/ },
  { key: "blusa", pattern: /\bblusa\b/ },
  { key: "vestido", pattern: /\bvestido\b|\bdress\b/ },
  { key: "jeans", pattern: /\bjeans?\b/ },
  { key: "short", pattern: /\bshorts?\b/ },
  { key: "pantalon", pattern: /\bpantalon(es)?\b/ },
  { key: "falda", pattern: /\bfalda\b|\bskirt\b/ },
  { key: "chaqueta", pattern: /\bchaqueta\b|\bchamarra\b|\bjacket\b|\bchumpa\b/ },
  { key: "sudadera", pattern: /\bsudadera\b|\bhoodie\b/ },
  { key: "sueter", pattern: /\bsueter\b|\bsweater\b/ },
  { key: "polo", pattern: /\bpolo\b/ },
  { key: "tenis", pattern: /\btenis\b|\bsneakers?\b/ },
  { key: "bota", pattern: /\bbotas?\b|\bboots?\b/ },
  { key: "zapato", pattern: /\bzapatos?\b|\bshoes?\b/ },
  { key: "bolso", pattern: /\b(bolso|bolsa|cartera|handbag)\b/ },
];

const SIZE_RULES: { pattern: RegExp; key: string }[] = [
  { pattern: /\b0XL\b/, key: "0XL" },
  { pattern: /\bXXXL\b|\b3XL\b/, key: "3XL" },
  { pattern: /\bXXL\b|\b2XL\b|\bEEG\b/, key: "2XL" },
  { pattern: /\bXL\b|\bEG\b|\bXG\b/, key: "XL" },
  { pattern: /\bXXS\b/, key: "XXS" },
  { pattern: /\bXS\b|\bCH\b/, key: "XS" },
  { pattern: /\bL\b|\bG\b/, key: "L" },
  { pattern: /\bM\b/, key: "M" },
  { pattern: /\bS\b/, key: "S" },
];

const UNBRANDED =
  /^(sin marca|no visible|unbranded|generic|desconocida|desconocido|sin etiqueta|n a|na|none|no brand|marca no visible)$/;

export function plainText(value: string): string {
  return value
    .toLowerCase()
    .replace(/á/g, "a")
    .replace(/é/g, "e")
    .replace(/í/g, "i")
    .replace(/ó/g, "o")
    .replace(/ú/g, "u")
    .replace(/ü/g, "u")
    .replace(/ñ/g, "n");
}

export function garmentKind(itemType?: string, title?: string): GarmentKind | null {
  const fromType = detectKind(itemType ?? "");
  if (fromType) return fromType;
  return detectKind(title ?? "");
}

function detectKind(value: string): GarmentKind | null {
  const text = plainText(value);
  if (!text.trim()) return null;
  for (const detector of DETECTORS) {
    if (detector.pattern.test(text)) return KIND_BY_KEY.get(detector.key) ?? null;
  }
  return null;
}

export function brandKey(value: string | undefined): string | null {
  const text = plainText(value ?? "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || UNBRANDED.test(text)) return null;
  return text;
}

export function brandsMatch(wanted: string | null, found: string | null): boolean {
  if (!wanted) return found == null;
  if (!found) return false;
  if (wanted === found || wanted.replace(/ /g, "") === found.replace(/ /g, "")) return true;
  const wantedTokens = wanted.split(" ");
  const foundTokens = found.split(" ");
  if (wantedTokens.length >= 2 && wantedTokens.every((token) => foundTokens.includes(token))) return true;
  if (foundTokens.length >= 2 && foundTokens.every((token) => wantedTokens.includes(token))) return true;
  if (wantedTokens.length === 1 && wantedTokens[0].length >= 3 && foundTokens.includes(wantedTokens[0])) {
    return true;
  }
  if (foundTokens.length === 1 && foundTokens[0].length >= 3 && wantedTokens.includes(foundTokens[0])) {
    return true;
  }
  return false;
}

export function brandPattern(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^a-z0-9]*");
}

export function conditionBucket(value: string | undefined): "nuevo" | "usado" | null {
  const text = plainText(value ?? "");
  if (!text.trim()) return null;
  if (/usado|pre-?owned|segunda|excellent|very_good|very good|\bgood\b|\bfair\b|como nuevo/.test(text)) {
    return "usado";
  }
  if (/new_with_tags|new_no_tags|nuevo|\bnew\b/.test(text)) return "nuevo";
  return null;
}

export function sizeKey(value: string | undefined): string | null {
  const text = plainText(value ?? "")
    .toUpperCase()
    .replace(/\bTALLA\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  const waist = text.match(/\b(\d{1,2})\s*X\s*(\d{1,2})\b/);
  if (waist) return `${waist[1]}X${waist[2]}`;
  for (const rule of SIZE_RULES) {
    if (rule.pattern.test(text)) return rule.key;
  }
  const numeric = text.match(/\b\d{1,2}(?:X\d{1,2})?\b/);
  return numeric ? numeric[0] : null;
}

export function audienceKey(...parts: (string | undefined)[]): "hombre" | "mujer" | "nino" | null {
  const text = plainText(parts.filter((part) => part && part.trim()).join(" "));
  if (!text) return null;
  if (/\b(nina|nino|bebe|infantil|kids|boys|girls|girl|boy)\b/.test(text)) return "nino";
  if (/\bwomens_/.test(text) || /\b(dama|mujer|women|woman)\b/.test(text)) return "mujer";
  if (/\bmens_/.test(text) || /\b(caballero|hombre|men|man)\b/.test(text)) return "hombre";
  return null;
}

export function listingIsRelevant(
  query: GarmentQuery,
  item: Pick<CatalogListing, "title" | "brand" | "itemType" | "condition" | "size" | "audience" | "priceGtq">
): boolean {
  const wanted = garmentKind(query.itemType, query.title);
  const found = garmentKind(item.itemType, item.title);
  if (!wanted || !found || wanted.key !== found.key) return false;
  if (!brandsMatch(brandKey(query.brand), brandKey(item.brand))) return false;
  const wantedCondition = conditionBucket(query.condition);
  const foundCondition = conditionBucket(item.condition);
  if (!wantedCondition || !foundCondition || wantedCondition !== foundCondition) return false;
  const wantedSize = sizeKey(query.size);
  if (wantedSize && sizeKey(item.size) !== wantedSize) return false;
  const wantedAudience = audienceKey(query.category, query.itemType, query.title);
  const foundAudience = audienceKey(item.audience, item.itemType, item.title);
  if (wantedAudience && foundAudience && wantedAudience !== foundAudience) return false;
  return Number.isFinite(item.priceGtq) && item.priceGtq > 0 && item.priceGtq <= 20000;
}

export function medianQuetzales(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(raw * 100) / 100;
}

export function guatemalaPriceIfEmpty(
  current: number | string | undefined | null,
  suggested: number | null | undefined
): number | string | undefined | null {
  if (suggested == null || !Number.isFinite(suggested) || suggested <= 0) return current;
  if (current == null || current === "") return suggested;
  const numeric = typeof current === "number" ? current : Number(current);
  if (!Number.isFinite(numeric) || numeric <= 0) return suggested;
  return current;
}

function range(values: number[]): { low: number | null; high: number | null } {
  if (values.length === 0) return { low: null, high: null };
  return { low: Math.min(...values), high: Math.max(...values) };
}

function comparedFields(query: GarmentQuery): string {
  const size = sizeKey(query.size) ? ", condición y talla" : " y condición";
  return `tipo, marca${size}`;
}

function salesLabel(count: number, prices: number[], note?: string): string {
  if (note) return note;
  if (count >= MIN_RELEVANT_COMPS) {
    const span = range(prices);
    const middle = medianQuetzales(prices);
    return `Ventas comprobadas de esta tienda: ${count}, entre ${formatQuetzales(span.low ?? 0)} y ${formatQuetzales(span.high ?? 0)}, mediana ${formatQuetzales(middle ?? 0)}. Estas ventas no se mezclan con los anuncios.`;
  }
  if (count > 0) {
    return `Ventas comprobadas de esta tienda: encontré ${count} venta${count === 1 ? "" : "s"} parecida${count === 1 ? "" : "s"}. Aún no son suficientes para usarlas como referencia.`;
  }
  return "Ventas comprobadas de esta tienda: todavía no hay ventas parecidas.";
}

export function unavailableGuatemalaCompReport(now = new Date(), salesNote?: string): GuatemalaCompReport {
  return buildGuatemalaCompReport({
    now,
    query: {},
    advertised: [],
    sourceErrors: ["No se pudo consultar Megapaca ni Econopaca."],
    sales: null,
    salesNote: salesNote ?? "No se pudieron consultar las ventas de esta tienda.",
  });
}

export function buildGuatemalaCompReport(input: {
  now?: Date;
  query: GarmentQuery;
  advertised: CatalogListing[];
  sourceErrors: string[];
  sales: StoreSaleInput[] | null;
  salesNote?: string;
}): GuatemalaCompReport {
  const now = input.now ?? new Date();
  const seen = new Set<string>();
  const advertised = input.advertised.filter((item) => {
    const key = `${item.source}:${item.url}`;
    if (!item.url || seen.has(key)) return false;
    seen.add(key);
    return listingIsRelevant(input.query, item);
  });
  const sales = (input.sales ?? []).filter((sale) =>
    listingIsRelevant(input.query, {
      title: sale.title,
      brand: sale.brand,
      itemType: "",
      condition: sale.condition,
      size: sale.size,
      audience: "",
      priceGtq: sale.priceGtq,
    })
  );
  const prices = advertised.map((item) => item.priceGtq);
  const salePrices = sales.map((sale) => sale.priceGtq);
  const advertisedRange = range(prices);
  const salesRange = range(salePrices);
  const suggested = prices.length >= MIN_RELEVANT_COMPS ? medianQuetzales(prices) : null;
  const bothSourcesFailed =
    input.advertised.length === 0 &&
    (input.sourceErrors.length >= 2 ||
      input.sourceErrors.some((error) => error.includes("Megapaca ni Econopaca")));
  const missingKind = !garmentKind(input.query.itemType, input.query.title);
  const missingCondition = !conditionBucket(input.query.condition);
  let message: string;
  if (bothSourcesFailed) {
    message = "No se pudo consultar Megapaca ni Econopaca. Escribe el precio manualmente.";
  } else if (missingKind) {
    message = "Falta el tipo de prenda para comparar con los catálogos. Escribe el precio manualmente.";
  } else if (missingCondition) {
    message = "Falta la condición de la prenda para comparar. Escribe el precio manualmente.";
  } else if (suggested != null) {
    message = `Sugerencia: ${formatQuetzales(suggested)}, según ${prices.length} precios anunciados entre ${formatQuetzales(advertisedRange.low ?? suggested)} y ${formatQuetzales(advertisedRange.high ?? suggested)}. ${GUATEMALA_ADVERTISED_LABEL} Puedes cambiar el precio.`;
  } else {
    message = `No hay suficientes precios anunciados parecidos para sugerir un monto. Encontré ${prices.length} con el mismo ${comparedFields(input.query)}${prices.length > 0 ? `, entre ${formatQuetzales(advertisedRange.low ?? 0)} y ${formatQuetzales(advertisedRange.high ?? 0)}` : ""}. ${GUATEMALA_ADVERTISED_LABEL} Se necesitan al menos ${MIN_RELEVANT_COMPS}. Escribe el precio manualmente.`;
  }
  if (!bothSourcesFailed && input.sourceErrors.length > 0 && !missingKind) {
    message = `${message} ${input.sourceErrors.join(" ")}`;
  }
  const listed: GuatemalaAdvertisedComp[] = advertised.slice(0, 8).map((item) => ({
    source: item.source,
    sourceLabel: item.source === "megapaca" ? "Megapaca" : "Econopaca",
    title: item.title,
    priceGtq: item.priceGtq,
    url: item.url,
    brand: item.brand,
    itemType: item.itemType,
    condition: item.condition,
    size: item.size,
  }));
  const sold: GuatemalaSoldComp[] = sales.slice(0, 8).map((sale) => ({
    sku: sale.sku,
    title: sale.title,
    priceGtq: sale.priceGtq,
    soldAt: sale.soldAt,
    brand: sale.brand,
    size: sale.size,
    condition: sale.condition,
  }));
  const salesMedian = salePrices.length >= MIN_RELEVANT_COMPS ? medianQuetzales(salePrices) : null;
  return {
    ok: true,
    status: suggested != null ? "ready" : bothSourcesFailed ? "unavailable" : "insufficient",
    currency: GUATEMALA_MARKET.currency,
    symbol: GUATEMALA_MARKET.symbol,
    timezone: GUATEMALA_MARKET.timezone,
    queriedAt: now.toISOString(),
    listed,
    sold,
    message,
    advertised: {
      count: prices.length,
      low: advertisedRange.low,
      high: advertisedRange.high,
      median: suggested,
      label: GUATEMALA_ADVERTISED_LABEL,
    },
    storeSales: {
      count: input.sales == null ? 0 : salePrices.length,
      low: salesMedian != null ? salesRange.low : null,
      high: salesMedian != null ? salesRange.high : null,
      median: salesMedian,
      label: salesLabel(input.sales == null ? 0 : salePrices.length, salePrices, input.sales == null ? input.salesNote : undefined),
    },
    suggestedPrice: suggested,
  };
}

const CURRENT_COMP_STATUSES = new Set(["ready", "insufficient", "unavailable"]);

// Saved jobs from before this report existed used another shape. Ignore those
// so the card asks again instead of reading fields that are not there.
export function coerceGuatemalaCompReport(value: unknown): GuatemalaCompReport | null {
  if (!value || typeof value !== "object") return null;
  const report = value as Partial<GuatemalaCompReport>;
  if (!CURRENT_COMP_STATUSES.has(String(report.status))) return null;
  const sales = report.storeSales;
  const salesReady = Boolean(sales && typeof sales.label === "string" && typeof sales.count === "number");
  return {
    ok: true,
    status: report.status as GuatemalaCompReport["status"],
    currency: "GTQ",
    symbol: "Q",
    timezone: "America/Guatemala",
    queriedAt: typeof report.queriedAt === "string" ? report.queriedAt : new Date(0).toISOString(),
    listed: Array.isArray(report.listed) ? report.listed : [],
    sold: Array.isArray(report.sold) ? report.sold : [],
    message: typeof report.message === "string" ? report.message : "",
    advertised: {
      count: typeof report.advertised?.count === "number" ? report.advertised.count : 0,
      low: report.advertised?.low ?? null,
      high: report.advertised?.high ?? null,
      median: report.advertised?.median ?? null,
      label: typeof report.advertised?.label === "string" ? report.advertised.label : GUATEMALA_ADVERTISED_LABEL,
    },
    storeSales: salesReady
      ? sales!
      : {
          count: 0,
          low: null,
          high: null,
          median: null,
          label: "No se pudieron consultar las ventas de esta tienda.",
        },
    suggestedPrice: typeof report.suggestedPrice === "number" ? report.suggestedPrice : null,
  };
}
