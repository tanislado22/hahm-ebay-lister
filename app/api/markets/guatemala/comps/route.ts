import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import { buildGuatemalaCompReport, unavailableGuatemalaCompReport, type GarmentQuery } from "@/lib/markets/guatemala-price-match";
import { fetchGuatemalaAdvertised } from "@/lib/markets/guatemala-price-sources";
import { listGuatemalaSaleReferences } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

// Advertised prices come from the public Megapaca and Econopaca catalogs.
// This store's own sales stay in a separate section. Nothing here reads eBay.
export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: Record<string, unknown> = {};
  try {
    const parsed = (await req.json()) as unknown;
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  const listing = body.listing && typeof body.listing === "object" ? (body.listing as Record<string, unknown>) : body;
  const query: GarmentQuery = {
    title: text(listing.title),
    itemType: text(listing.item_type ?? listing.itemType),
    brand: text(listing.brand),
    condition: text(listing.condition),
    size: text(listing.size),
    category: text(listing.category),
  };
  const clientId = text(body.clientId);
  try {
    const catalogs = await fetchGuatemalaAdvertised(query);
    const sales = await readStoreSales(clientId);
    return NextResponse.json(
      buildGuatemalaCompReport({
        query,
        advertised: catalogs.items,
        sourceErrors: catalogs.errors,
        sales: sales.rows,
        salesNote: sales.note,
      })
    );
  } catch (error) {
    console.error("[guatemala/comps] failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json(unavailableGuatemalaCompReport());
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
