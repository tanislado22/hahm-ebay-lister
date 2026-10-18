import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import {
  deleteGuatemalaPriceGuide,
  listGuatemalaPriceGuides,
  saveGuatemalaPriceGuide,
} from "@/lib/markets/guatemala-price-guides-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId") ?? "";
  const access = await authorizeGuatemalaRequest(request, clientId, "read");
  if (!access.ok) return access.response;
  try {
    const guides = await listGuatemalaPriceGuides(access.clientId);
    return NextResponse.json({ ok: true, guides });
  } catch (error) {
    console.error("[guatemala/price-guides] list failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo cargar la tabla de precios." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la regla." }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(request, text(body.clientId), "manage");
  if (!access.ok) return access.response;
  try {
    if (body.action === "delete") {
      const result = await deleteGuatemalaPriceGuide(access.clientId, text(body.id));
      if (!result.ok) return NextResponse.json(result, { status: 400 });
      return NextResponse.json(result);
    }
    const result = await saveGuatemalaPriceGuide(access.clientId, {
      scope: body.scope,
      brand: body.brand,
      garment: body.garment,
      condition: body.condition,
      priceGtq: body.priceGtq,
      adjustmentGtq: body.adjustmentGtq,
      comparableBrands: body.comparableBrands,
    });
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/price-guides] save failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo guardar la regla." }, { status: 500 });
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
