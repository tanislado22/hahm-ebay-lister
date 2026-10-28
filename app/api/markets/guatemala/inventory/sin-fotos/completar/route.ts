import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { GUATEMALA_INVENTORY_MESSAGES } from "@/lib/markets/guatemala-inventory";
import { completeUnpublishedGuatemalaItem } from "@/lib/markets/guatemala-inventory-store";

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
  const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
  if (!itemId) {
    return NextResponse.json({ ok: false, error: GUATEMALA_INVENTORY_MESSAGES.missingItem }, { status: 400 });
  }
  try {
    const result = await completeUnpublishedGuatemalaItem({
      clientId: access.clientId,
      itemId,
      actor: access.actor,
      publish: body.publish,
      title: body.title,
      description: body.description,
      brand: body.brand,
      size: body.size,
      condition: body.condition,
      price: body.price,
      photos: body.photos,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/sin-fotos] complete failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: GUATEMALA_INVENTORY_MESSAGES.retry }, { status: 500 });
  }
}
