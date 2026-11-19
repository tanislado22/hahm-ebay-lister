import { getClient, anthropicAuthError } from "@/lib/anthropic";
import { toImageBlock, type WireImage } from "@/lib/images";
import { GUATEMALA_CONDITION_CHOICES, unpublishedItemType } from "@/lib/markets/guatemala-inventory";
import { listGuatemalaSaleReferences } from "@/lib/markets/guatemala-inventory-store";
import {
  MIN_RELEVANT_COMPS,
  brandKey,
  brandsMatch,
  conditionBucket,
  garmentKind,
  plainText,
} from "@/lib/markets/guatemala-price-match";
import { fetchGuatemalaAdvertised } from "@/lib/markets/guatemala-price-sources";
import { saleEstimateQuote, type MarketEstimate } from "@/lib/markets/guatemala-sale-advice";

const ESTIMATE_MODEL = "claude-sonnet-4-6";
const ESTIMATE_TIMEOUT_MS = 25_000;

export interface UsedMarketReference {
  source: "paid" | "advertised";
  label: string;
  priceGtq: number;
}

export interface UsedReferenceReport {
  lines: string[];
  note: string;
  basis: "paid" | "advertised" | "estimate";
  widened: boolean;
}

export function referenceSearchKind(itemType?: string, title?: string): string | null {
  const kind = garmentKind(itemType, title);
  if (!kind) return null;
  if (kind.key === "pantalon") return "jeans";
  return kind.key;
}

export function selectUsedGuatemalaReferences(input: {
  itemType?: string;
  brand?: string;
  sales?: readonly { title?: string; brand?: string; condition?: string; priceGtq: number; size?: string }[];
  advertised?: readonly {
    title?: string;
    brand?: string;
    itemType?: string;
    condition?: string;
    priceGtq: number;
    sourceLabel?: string;
    size?: string;
  }[];
}): UsedReferenceReport {
  const kind = referenceSearchKind(input.itemType, input.itemType);
  const wantedBrand = brandKey(input.brand);
  const garment = kind === "jeans" ? "jeans usados" : kind ? `${kind} usada` : "ropa usada";
  const brandName = input.brand?.trim() || "esa marca";
  if (!kind) return estimateReport();
  const paidSame: UsedMarketReference[] = [];
  const paidOther: UsedMarketReference[] = [];
  for (const sale of input.sales ?? []) {
    if (!usableUsedReference(kind, sale.condition, sale.title, undefined, sale.brand, wantedBrand)) continue;
    const same = sameWantedBrand(wantedBrand, sale.brand, sale.title);
    const label = `Pagado en Variedades San Andrés: ${describeReference(sale)} Q${sale.priceGtq}.`;
    (same ? paidSame : paidOther).push({ source: "paid", label, priceGtq: sale.priceGtq });
  }
  const adsSame: UsedMarketReference[] = [];
  const adsOther: UsedMarketReference[] = [];
  for (const listing of input.advertised ?? []) {
    if (!usableUsedReference(kind, listing.condition, listing.title, listing.itemType, listing.brand, wantedBrand)) continue;
    const same = sameWantedBrand(wantedBrand, listing.brand, listing.title);
    const place = listing.sourceLabel?.trim() || "el mercado guatemalteco";
    const label = `Precio anunciado en ${place}: ${describeReference(listing)} Q${listing.priceGtq}.`;
    (same ? adsSame : adsOther).push({ source: "advertised", label, priceGtq: listing.priceGtq });
  }
  const chosen = [...paidSame];
  let widened = false;
  if (chosen.length < MIN_RELEVANT_COMPS && paidOther.length > 0) {
    chosen.push(...paidOther);
    widened = true;
  }
  if (chosen.length < MIN_RELEVANT_COMPS) chosen.push(...adsSame);
  if (chosen.length < MIN_RELEVANT_COMPS && adsOther.length > 0) {
    chosen.push(...adsOther);
    widened = true;
  }
  const used = chosen.slice(0, 8);
  if (used.length === 0) return estimateReport();
  const paid = used.some((item) => item.source === "paid");
  const advertised = used.some((item) => item.source === "advertised");
  const notes: string[] = [];
  if (widened) notes.push(`No hubo suficientes ${garment} de ${brandName}. Se usaron ${garment} comparables.`);
  else if (paid && !advertised) notes.push(`Referencias pagadas de ${garment} de ${brandName} en Variedades San Andrés.`);
  if (advertised) {
    notes.push(
      paid
        ? "Los anuncios se identifican como precios anunciados, no como ventas pagadas."
        : "Estos montos son precios anunciados, no ventas pagadas."
    );
  }
  return { lines: used.map((item) => item.label), note: notes.join(" "), basis: paid ? "paid" : "advertised", widened };
}

function estimateReport(): UsedReferenceReport {
  return {
    lines: [],
    note: "No hay comparables de ropa usada en Guatemala. Este precio es una estimación.",
    basis: "estimate",
    widened: false,
  };
}

function usableUsedReference(
  kind: string,
  condition?: string,
  title?: string,
  itemType?: string,
  brand?: string,
  wantedBrand?: string | null
): boolean {
  const text = plainText(`${title ?? ""} ${condition ?? ""}`);
  if (/precio original|precio de tienda|\bretail\b|\bmsrp\b/.test(text)) return false;
  if (conditionBucket(condition) !== "usado") return false;
  const titleText = plainText(title ?? "");
  if ((/\bnuevo\b|\bnew\b/.test(titleText) && !/como nuevo/.test(titleText))) return false;
  const keys = [garmentKind(itemType)?.key, garmentKind(undefined, title)?.key];
  if (keys.includes(kind)) return true;
  return kind === "jeans" && keys.includes("pantalon") && sameWantedBrand(wantedBrand ?? null, brand, title);
}

function sameWantedBrand(wanted: string | null, brand?: string, title?: string): boolean {
  if (!wanted) return false;
  return brandsMatch(wanted, brandKey(brand)) || brandsMatch(wanted, brandKey(title));
}

function describeReference(item: { title?: string; brand?: string; size?: string; condition?: string }): string {
  return [item.title, item.brand, item.size, item.condition].map((part) => part?.trim() ?? "").filter(Boolean).join(" ") || "prenda usada";
}

export function buildSaleEstimatePrompt(input: {
  itemType: string;
  brand: string;
  size: string;
  condition: string;
  references: readonly string[];
}): string {
  const type = unpublishedItemType(input.itemType)?.label || input.itemType.trim() || "Prenda";
  const condition =
    GUATEMALA_CONDITION_CHOICES.find((choice) => choice.value === input.condition)?.label || input.condition.trim() || "Sin estado";
  const references =
    input.references.length > 0
      ? input.references.join("\n")
      : "No hay referencias de prendas similares. Estima con el tipo, la marca, el estado y las fotos.";
  return [
    "Estima el precio de venta de esta prenda en una tienda de ropa de Guatemala.",
    "Responde solo JSON: {\"priceGtq\": 0, \"reasonableUpToGtq\": 0}.",
    "priceGtq es el precio que cobrarías. reasonableUpToGtq es el precio más alto que aún sería razonable para esta prenda; puede ser igual.",
    "Usa únicamente estas referencias de ropa usada en Guatemala.",
    "Prioriza los precios pagados en Variedades San Andrés. Si una línea dice Precio anunciado, es un anuncio activo, no una venta pagada.",
    "No uses precios de ropa nueva ni el precio original de tienda.",
    "Si no hay referencias, igual da un precio razonable: ese resultado es una estimación.",
    "No uses el costo de compra ni una ganancia fija.",
    "",
    `Tipo: ${type}`,
    `Marca: ${input.brand.trim() || "Sin marca"}`,
    `Talla: ${input.size.trim() || "Sin talla"}`,
    `Estado: ${condition}`,
    "",
    "Referencias en Guatemala:",
    references,
  ].join("\n");
}

export interface SaleEstimateOutcome {
  quote: MarketEstimate | null;
  references: UsedReferenceReport;
}

export async function estimateGuatemalaSaleQuetzales(input: {
  clientId: string;
  itemType: string;
  brand: string;
  size: string;
  condition: string;
  photos?: readonly WireImage[];
}): Promise<SaleEstimateOutcome> {
  const references = await loadUsedGuatemalaReferences(input);
  const prompt = buildSaleEstimatePrompt({
    itemType: input.itemType,
    brand: input.brand,
    size: input.size,
    condition: input.condition,
    references: references.lines,
  });
  const images = (input.photos ?? []).slice(0, 2).flatMap((photo) => {
    const block = toImageBlock(photo);
    return block ? [block] : [];
  });
  try {
    const client = getClient();
    const response = await client.messages.create(
      {
        model: ESTIMATE_MODEL,
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: [...images, { type: "text", text: prompt }],
          },
        ],
      },
      { timeout: ESTIMATE_TIMEOUT_MS, maxRetries: 0 }
    );
    const text = response.content.find((block) => block.type === "text");
    return { quote: text && text.type === "text" ? saleEstimateQuote(text.text) : null, references };
  } catch (error) {
    const fatal = anthropicAuthError(error);
    console.error("[guatemala/sale-estimate] model failed", fatal ? fatal.status : error instanceof Error ? error.name : "Error");
    return { quote: null, references };
  }
}

async function loadUsedGuatemalaReferences(input: {
  clientId: string;
  itemType: string;
  brand: string;
  condition: string;
}): Promise<UsedReferenceReport> {
  const kind = referenceSearchKind(input.itemType);
  if (!kind) return estimateReport();
  const query = { itemType: kind, condition: input.condition, title: kind };
  const [sales, branded, open] = await Promise.all([
    listGuatemalaSaleReferences(input.clientId).catch((error: unknown) => {
      console.error("[guatemala/sale-estimate] sales failed", error instanceof Error ? error.name : "Error");
      return [];
    }),
    fetchGuatemalaAdvertised({ ...query, brand: input.brand }).catch(() => ({ items: [], errors: [] })),
    fetchGuatemalaAdvertised({ ...query, brand: "" }).catch(() => ({ items: [], errors: [] })),
  ]);
  const seen = new Set<string>();
  const advertised = [...branded.items, ...open.items].flatMap((item) => {
    const key = item.url || `${item.source}|${item.title}|${item.priceGtq}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        title: item.title,
        brand: item.brand,
        itemType: item.itemType,
        condition: item.condition,
        priceGtq: item.priceGtq,
        sourceLabel: item.source === "megapaca" ? "Megapaca" : "Econopaca",
        size: item.size,
      },
    ];
  });
  return selectUsedGuatemalaReferences({
    itemType: input.itemType,
    brand: input.brand,
    sales,
    advertised,
  });
}
