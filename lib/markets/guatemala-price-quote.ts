import { clientIsGuatemala } from "@/lib/markets/client-market";
import {
  buildGuatemalaCompReport,
  comparableBrandsFor,
  unavailableGuatemalaCompReport,
  type GarmentQuery,
  type StorePriceGuide,
} from "@/lib/markets/guatemala-price-match";
import { fetchGuatemalaAdvertised } from "@/lib/markets/guatemala-price-sources";
import { listGuatemalaPriceGuides } from "@/lib/markets/guatemala-price-guides-store";
import { listGuatemalaSaleReferences } from "@/lib/markets/guatemala-inventory-store";
import type { GuatemalaCompReport } from "@/lib/types";

export async function quoteGuatemalaPrice(
  clientId: string,
  listing: Record<string, unknown>
): Promise<GuatemalaCompReport> {
  const query: GarmentQuery = {
    title: text(listing.title),
    itemType: text(listing.item_type ?? listing.itemType),
    brand: text(listing.brand),
    condition: text(listing.condition),
    size: text(listing.size),
    category: text(listing.category),
  };
  try {
    const guides = await readPriceGuides(clientId);
    const catalogs = await fetchGuatemalaAdvertised(query, comparableBrandsFor(query, guides));
    const sales = await readStoreSales(clientId);
    return buildGuatemalaCompReport({
      query,
      advertised: catalogs.items,
      sourceErrors: catalogs.errors,
      sales: sales.rows,
      salesNote: sales.note,
      guides,
    });
  } catch (error) {
    console.error("[guatemala/comps] failed", error instanceof Error ? error.name : "Error");
    return unavailableGuatemalaCompReport();
  }
}

async function readPriceGuides(clientId: string): Promise<StorePriceGuide[]> {
  if (!clientId) return [];
  try {
    if (!(await clientIsGuatemala(clientId))) return [];
    return await listGuatemalaPriceGuides(clientId);
  } catch (error) {
    console.error("[guatemala/comps] price guides failed", error instanceof Error ? error.name : "Error");
    return [];
  }
}

async function readStoreSales(clientId: string): Promise<{
  rows: Awaited<ReturnType<typeof listGuatemalaSaleReferences>> | null;
  note?: string;
}> {
  if (!clientId) {
    return { rows: null, note: "No hay una tienda seleccionada, así que no se consultaron las ventas de esta tienda." };
  }
  try {
    if (!(await clientIsGuatemala(clientId))) {
      return { rows: null, note: "No se consultaron ventas porque la tienda seleccionada no es Tienda Guatemala." };
    }
    return { rows: await listGuatemalaSaleReferences(clientId) };
  } catch (error) {
    console.error("[guatemala/comps] sales failed", error instanceof Error ? error.name : "Error");
    return { rows: null, note: "No se pudieron consultar las ventas de esta tienda." };
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
