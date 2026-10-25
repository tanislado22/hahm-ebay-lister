import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { requireEbayAccessToken } from "@/lib/ebay/route-access";
import { commitPrepareDraft, lookupPrepareDraft } from "@/lib/vinted/prepare-listing-run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: {
    vintedItemId?: unknown;
    confirm?: unknown;
    sku?: unknown;
    ebayItemId?: unknown;
    title?: unknown;
    description?: unknown;
    price?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "No se preparó ningún artículo." }, { status: 400 });
  }
  const token = await requireEbayAccessToken(req, { workMode: "store" });
  if (token instanceof NextResponse) {
    return NextResponse.json({ ok: false, error: "eBay no está conectado. No se preparó ningún artículo." }, { status: 401 });
  }
  const vintedItemId = typeof body.vintedItemId === "string" ? body.vintedItemId : "";
  try {
    if (body.confirm === true) {
      const result = await commitPrepareDraft(token, {
        vintedItemId,
        sku: body.sku,
        ebayItemId: body.ebayItemId,
        title: body.title,
        description: body.description,
        price: body.price,
      });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true, sku: result.sku, photoCount: result.photoCount, missingPhotos: result.missingPhotos });
    }
    const result = await lookupPrepareDraft(token, vintedItemId);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, draft: result.draft });
  } catch (error) {
    console.error("[vinted/inventory/prepare]", error instanceof Error ? error.name : "Error");
    return NextResponse.json(
      { ok: false, error: "No se pudo consultar tu cuenta de eBay. No se preparó ningún artículo." },
      { status: 500 }
    );
  }
}
