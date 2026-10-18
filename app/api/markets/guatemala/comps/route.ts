import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { quoteGuatemalaPrice } from "@/lib/markets/guatemala-price-quote";

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
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  return NextResponse.json(await quoteGuatemalaPrice(clientId, listing));
}
