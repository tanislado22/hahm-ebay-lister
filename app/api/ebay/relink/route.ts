import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { fetchAllActiveSellerListings } from "@/lib/ebay/active-inventory";
import { refreshEbayLinksFromListings } from "@/lib/ebay/relist-links-run";
import { requireEbayAccessToken } from "@/lib/ebay/route-access";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const token = await requireEbayAccessToken(req, { workMode: "store" });
  if (token instanceof NextResponse) return token;
  const active = await fetchAllActiveSellerListings(token);
  if (!active.ok) {
    return NextResponse.json(
      { ok: false, error: active.error, updated: 0, missing: 0, review: 0 },
      { status: 502 }
    );
  }
  try {
    const result = await refreshEbayLinksFromListings(token, active.listings);
    return NextResponse.json({
      ok: true,
      updated: result.updated,
      missing: result.missing,
      review: result.review,
      unchanged: result.unchanged,
      skipped: result.skipped,
    });
  } catch (error) {
    console.error("[ebay/relink]", error instanceof Error ? error.name : "Error");
    return NextResponse.json(
      {
        ok: false,
        error: "No se pudieron guardar los vínculos. No se marcó ninguna publicación como finalizada.",
        updated: 0,
        missing: 0,
        review: 0,
      },
      { status: 500 }
    );
  }
}
