import { NextRequest, NextResponse } from "next/server";
import { rateLimitRequest } from "@/lib/api-guard";
import { GUATEMALA_CATALOG_MESSAGES } from "@/lib/markets/guatemala-catalog";
import { readPublicGuatemalaCatalogItem } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  const limited = rateLimitRequest(request);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Demasiadas consultas. Espera un minuto." }, { status: 429 });
  }
  const { itemId } = await context.params;
  try {
    const result = await readPublicGuatemalaCatalogItem(itemId);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, item: result.item });
  } catch (error) {
    console.error("[guatemala/catalog] detail failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: GUATEMALA_CATALOG_MESSAGES.detailFailed }, { status: 500 });
  }
}
