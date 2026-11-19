import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { listGuatemalaPurchaseLots } from "@/lib/markets/guatemala-lots-store";
import { listGuatemalaPriceGuides } from "@/lib/markets/guatemala-price-guides-store";
import { readPricingSettings } from "@/lib/markets/guatemala-pricing-settings";
import {
  adviseSalePrice,
  garmentCostInputForActor,
  presentSaleAdvice,
} from "@/lib/markets/guatemala-sale-advice";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la prenda." }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(request, typeof body.clientId === "string" ? body.clientId : "", "read");
  if (!access.ok) return access.response;
  try {
    const role = access.actor.role === "propietario" ? "propietario" : "encargado";
    const [settings, guides, lots] = await Promise.all([
      readPricingSettings(access.clientId),
      listGuatemalaPriceGuides(access.clientId),
      listGuatemalaPurchaseLots(access.clientId),
    ]);
    const lotId = typeof body.lotId === "string" ? body.lotId : "";
    const lot = lots.ok ? lots.lots.find((entry) => entry.id === lotId && entry.status === "activo") : undefined;
    const advice = adviseSalePrice({
      itemType: typeof body.itemType === "string" ? body.itemType : "",
      brand: typeof body.brand === "string" ? body.brand : "",
      condition: typeof body.condition === "string" ? body.condition : "",
      individualCost: garmentCostInputForActor(role, body.individualCost),
      lotAverage: lot?.averageGtq ?? null,
      settings,
      guides,
    });
    return NextResponse.json({ ok: true, advice: presentSaleAdvice(advice, role) });
  } catch (error) {
    console.error("[guatemala/sale-advice] quote failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo calcular el precio." }, { status: 500 });
  }
}
