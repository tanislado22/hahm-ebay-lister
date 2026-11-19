import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { GUATEMALA_INVENTORY_MESSAGES } from "@/lib/markets/guatemala-inventory";
import { savePhotoLessRegistration, saveUnpublishedGuatemalaItem } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ ok: false, error: GUATEMALA_INVENTORY_MESSAGES.retry }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(request, typeof body.clientId === "string" ? body.clientId : "", "publish");
  if (!access.ok) return access.response;
  try {
    const result = body.registro === true
      ? await savePhotoLessRegistration({
          clientId: access.clientId,
          actor: access.actor,
          sku: body.sku,
          title: body.title,
          description: body.description,
          brand: body.brand,
          size: body.size,
          condition: body.condition,
          price: body.price,
          lotId: body.lotId,
        })
      : await saveUnpublishedGuatemalaItem({
          clientId: access.clientId,
          actor: access.actor,
          sku: body.sku,
          itemType: body.itemType,
          brand: body.brand,
          size: body.size,
          condition: body.condition,
          price: body.price,
          lotId: body.lotId,
          cost: body.cost,
          photo: body.photo,
          supportPhotos: body.supportPhotos,
        });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, existing: result.existing ?? null },
        { status: result.status }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/sin-fotos] create failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: GUATEMALA_INVENTORY_MESSAGES.retry }, { status: 500 });
  }
}
