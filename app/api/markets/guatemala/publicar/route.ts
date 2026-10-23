import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { exactGuatemalaSku } from "@/lib/markets/guatemala";
import { GUATEMALA_INVENTORY_MESSAGES } from "@/lib/markets/guatemala-inventory";
import { guatemalaSkuTaken, saveGuatemalaInventoryItem } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorizeGuatemalaRequest(request, request.nextUrl.searchParams.get("clientId") ?? "", "publish");
  if (!access.ok) return access.response;
  const sku = exactGuatemalaSku(request.nextUrl.searchParams.get("sku") ?? "").trim();
  if (!sku) {
    return NextResponse.json({ ok: false, error: GUATEMALA_INVENTORY_MESSAGES.skuRequired }, { status: 400 });
  }
  try {
    const taken = await guatemalaSkuTaken(access.clientId, sku);
    return NextResponse.json({
      ok: true,
      available: !taken,
      error: taken ? GUATEMALA_INVENTORY_MESSAGES.skuInUse : undefined,
    });
  } catch (error) {
    console.error("[guatemala/publicar] sku failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo comprobar el SKU." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la prenda." }, { status: 400 });
  }
  const requested =
    body && typeof body === "object" && "clientId" in body ? String((body as { clientId?: unknown }).clientId ?? "") : "";
  const access = await authorizeGuatemalaRequest(request, requested, "publish");
  if (!access.ok) return access.response;
  const record =
    body && typeof body === "object" ? { ...(body as Record<string, unknown>), clientId: access.clientId } : { clientId: access.clientId };
  try {
    const result = await saveGuatemalaInventoryItem(record, access.actor);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({
      ok: true,
      action: result.action,
      item: {
        id: result.item.id,
        sku: result.item.sku,
        priceGtq: result.item.priceGtq,
        createdBy: result.item.createdBy
          ? { role: result.item.createdBy.role, username: result.item.createdBy.username }
          : null,
      },
    });
  } catch (error) {
    console.error("[guatemala/publicar] save failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: GUATEMALA_INVENTORY_MESSAGES.retry }, { status: 500 });
  }
}
