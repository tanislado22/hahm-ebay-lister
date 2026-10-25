import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { fetchAllActiveSellerListings } from "@/lib/ebay/active-inventory";
import { acquireRelinkLock, refreshEbayLinksFromListings, releaseRelinkLock } from "@/lib/ebay/relist-links-run";
import { requireEbayAccessToken } from "@/lib/ebay/route-access";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const token = await requireEbayAccessToken(req, { workMode: "store" });
  if (token instanceof NextResponse) {
    if (token.status !== 401) return token;
    const body = (await token.json()) as { ok?: boolean; error?: string };
    return NextResponse.json(
      {
        ok: false,
        code: "EBAY_DISCONNECTED",
        error: body.error || "eBay no está conectado. Conecta la cuenta y vuelve a intentar.",
      },
      { status: 409 }
    );
  }
  let locked = false;
  try {
    locked = await acquireRelinkLock();
  } catch (error) {
    console.error("[ebay/relink] lock", error instanceof Error ? error.name : "Error");
    return NextResponse.json(
      {
        ok: false,
        error: "No se pudo iniciar la actualización. No se marcó ninguna publicación como finalizada.",
        updated: 0,
        missing: 0,
        review: 0,
      },
      { status: 500 }
    );
  }
  if (!locked) {
    return NextResponse.json(
      {
        ok: false,
        code: "RELINK_IN_PROGRESS",
        error: "Ya hay una actualización en curso. Espera a que termine antes de volver a intentar.",
        updated: 0,
        missing: 0,
        review: 0,
      },
      { status: 409 }
    );
  }
  try {
    const active = await fetchAllActiveSellerListings(token);
    if (!active.ok) {
      return NextResponse.json(
        { ok: false, error: active.error, updated: 0, missing: 0, review: 0 },
        { status: 502 }
      );
    }
    const result = await refreshEbayLinksFromListings(token, active.listings);
    return NextResponse.json({
      ok: true,
      updated: result.updated,
      missing: result.missing,
      review: result.review,
      unchanged: result.unchanged,
      skipped: result.skipped,
      lookupIncomplete: result.lookupIncomplete,
      unchecked: result.unchecked,
      activeCount: active.listings.length,
      pagesRead: active.pages,
      missingItems: result.plans
        .filter((plan) => plan.outcome === "missing")
        .map((plan) => ({
          id: plan.id,
          title: plan.title,
          sku: plan.sku,
          previousItemId: plan.previousItemId,
          source: plan.source,
        })),
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
  } finally {
    await releaseRelinkLock().catch((error) => {
      console.error("[ebay/relink] unlock", error instanceof Error ? error.name : "Error");
    });
  }
}
