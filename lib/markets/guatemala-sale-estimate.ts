import { getClient, anthropicAuthError } from "@/lib/anthropic";
import { toImageBlock, type WireImage } from "@/lib/images";
import { GUATEMALA_CONDITION_CHOICES, unpublishedItemType } from "@/lib/markets/guatemala-inventory";
import { quoteGuatemalaPrice } from "@/lib/markets/guatemala-price-quote";
import type { StorePriceGuide } from "@/lib/markets/guatemala-price-match";
import { saleEstimateQuetzales } from "@/lib/markets/guatemala-sale-advice";
import type { GuatemalaCompReport } from "@/lib/types";

const ESTIMATE_MODEL = "claude-sonnet-4-6";
const ESTIMATE_TIMEOUT_MS = 25_000;

export function saleEstimateReferenceLines(input: {
  guides?: readonly StorePriceGuide[];
  report?: Pick<GuatemalaCompReport, "listed" | "sold" | "advertised" | "storeSales"> | null;
}): string[] {
  const lines: string[] = [];
  for (const sale of input.report?.sold ?? []) {
    lines.push(`Venta en la tienda: ${describeGarment(sale)} por Q${sale.priceGtq}.`);
  }
  for (const listing of input.report?.listed ?? []) {
    lines.push(`Anuncio en ${listing.sourceLabel}: ${describeGarment(listing)} por Q${listing.priceGtq}.`);
  }
  const advertised = input.report?.advertised;
  if (advertised && advertised.median != null && advertised.count > 0) {
    lines.push(`Mediana de ${advertised.count} anuncios similares: Q${advertised.median}.`);
  }
  const sales = input.report?.storeSales;
  if (sales && sales.median != null && sales.count > 0) {
    lines.push(`Mediana de ${sales.count} ventas similares de la tienda: Q${sales.median}.`);
  }
  for (const guide of input.guides ?? []) {
    if (guide.scope !== "general" || guide.priceGtq == null) continue;
    const low = guide.lowGtq ?? guide.priceGtq;
    const high = guide.highGtq ?? guide.priceGtq;
    lines.push(`Tabla de la tienda, ${guide.garment} ${guide.condition}: Q${low} a Q${high}.`);
  }
  return lines.slice(0, 12);
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
    "Responde solo JSON con un número entero de quetzales: {\"priceGtq\": 0}.",
    "Usa las referencias de prendas similares cuando apliquen. Si no hay, igual da un precio razonable.",
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

export async function estimateGuatemalaSaleQuetzales(input: {
  clientId: string;
  itemType: string;
  brand: string;
  size: string;
  condition: string;
  photos?: readonly WireImage[];
  guides?: readonly StorePriceGuide[];
}): Promise<number | null> {
  let report: GuatemalaCompReport | null = null;
  try {
    report = await quoteGuatemalaPrice(input.clientId, {
      itemType: input.itemType,
      brand: input.brand,
      size: input.size,
      condition: input.condition,
      title: unpublishedItemType(input.itemType)?.label ?? input.itemType,
    });
  } catch (error) {
    console.error("[guatemala/sale-estimate] references failed", error instanceof Error ? error.name : "Error");
  }
  const prompt = buildSaleEstimatePrompt({
    itemType: input.itemType,
    brand: input.brand,
    size: input.size,
    condition: input.condition,
    references: saleEstimateReferenceLines({ guides: input.guides, report }),
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
    return text && text.type === "text" ? saleEstimateQuetzales(text.text) : null;
  } catch (error) {
    const fatal = anthropicAuthError(error);
    console.error("[guatemala/sale-estimate] model failed", fatal ? fatal.status : error instanceof Error ? error.name : "Error");
    return null;
  }
}

function describeGarment(item: { title?: string; brand?: string; size?: string; condition?: string }): string {
  return [item.title, item.brand, item.size, item.condition].map((part) => part?.trim() ?? "").filter(Boolean).join(" ") || "prenda";
}
