import { NextRequest, NextResponse } from "next/server";
import { analyzeListing } from "@/lib/analyze-listing";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { GUATEMALA_MARKET } from "@/lib/markets/guatemala";
import type { AnalyzeRequestBody } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const access = await authorizeGuatemalaRequest(request, "", "publish");
  if (!access.ok) return access.response;
  let body: Partial<AnalyzeRequestBody>;
  try {
    body = (await request.json()) as Partial<AnalyzeRequestBody>;
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudieron leer las fotos." }, { status: 400 });
  }
  const result = await analyzeListing({
    images: Array.isArray(body.images) ? body.images : [],
    profile: "auto",
    market: GUATEMALA_MARKET.code,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  const listing = result.listing;
  return NextResponse.json({
    ok: true,
    listing: {
      title: listing.title ?? "",
      description: listing.description ?? "",
      brand: listing.brand ?? "",
      size: listing.size ?? "",
      condition: listing.condition ?? "",
      itemType: listing.item_type ?? "",
      category: listing.category ?? "",
    },
  });
}
