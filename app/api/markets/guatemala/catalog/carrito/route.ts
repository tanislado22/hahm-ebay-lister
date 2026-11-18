import { NextRequest, NextResponse } from "next/server";
import { rateLimitRequest } from "@/lib/api-guard";
import { GUATEMALA_CATALOG_MESSAGES } from "@/lib/markets/guatemala-catalog";
import { PUBLIC_CART_MESSAGES, cartIdsFromRequest } from "@/lib/markets/guatemala-cart";
import { quotePublicGuatemalaCart } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const limited = rateLimitRequest(request);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Demasiadas consultas. Espera un minuto." }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: PUBLIC_CART_MESSAGES.confirmFailed }, { status: 400 });
  }
  const ids = cartIdsFromRequest(body);
  if (!ids) return NextResponse.json({ ok: false, error: PUBLIC_CART_MESSAGES.confirmFailed }, { status: 400 });
  try {
    const result = await quotePublicGuatemalaCart(ids);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, lines: result.lines });
  } catch (error) {
    console.error("[guatemala/catalog/carrito] quote failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: GUATEMALA_CATALOG_MESSAGES.loadFailed }, { status: 500 });
  }
}
