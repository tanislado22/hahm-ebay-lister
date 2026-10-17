import { NextRequest, NextResponse } from "next/server";
import { rateLimitRequest } from "@/lib/api-guard";
import { GUATEMALA_CATALOG_MESSAGES } from "@/lib/markets/guatemala-catalog";
import { listPublicGuatemalaCatalog } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = rateLimitRequest(request);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Demasiadas consultas. Espera un minuto." }, { status: 429 });
  }
  try {
    const result = await listPublicGuatemalaCatalog(request.nextUrl.searchParams.get("q") ?? "");
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, items: result.items });
  } catch (error) {
    console.error("[guatemala/catalog] list failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: GUATEMALA_CATALOG_MESSAGES.loadFailed }, { status: 500 });
  }
}
