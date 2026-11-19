import { NextRequest, NextResponse } from "next/server";
import type { WireImage } from "@/lib/images";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { listGuatemalaPurchaseLots } from "@/lib/markets/guatemala-lots-store";
import { listGuatemalaPriceGuides } from "@/lib/markets/guatemala-price-guides-store";
import { readPricingSettings } from "@/lib/markets/guatemala-pricing-settings";
import { estimateGuatemalaSaleQuetzales } from "@/lib/markets/guatemala-sale-estimate";
import {
  adviseSalePrice,
  applyMarketEstimate,
  garmentCostInputForActor,
  presentSaleAdvice,
} from "@/lib/markets/guatemala-sale-advice";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    const itemType = typeof body.itemType === "string" ? body.itemType : "";
    const brand = typeof body.brand === "string" ? body.brand : "";
    const size = typeof body.size === "string" ? body.size : "";
    const condition = typeof body.condition === "string" ? body.condition : "";
    const advice = adviseSalePrice({
      itemType,
      brand,
      condition,
      individualCost: garmentCostInputForActor(role, body.individualCost),
      lotAverage: lot?.averageGtq ?? null,
      settings,
      guides,
    });
    const estimate =
      advice.status === "ready"
        ? await estimateGuatemalaSaleQuetzales({
            clientId: access.clientId,
            itemType,
            brand,
            size,
            condition,
            photos: readAdvicePhotos(body.photos),
          })
        : null;
    const priced = applyMarketEstimate(advice, estimate?.quote ?? null);
    return NextResponse.json({
      ok: true,
      advice: presentSaleAdvice(
        estimate
          ? { ...priced, referenceNote: estimate.references.note, referenceLines: estimate.references.lines }
          : priced,
        role
      ),
    });
  } catch (error) {
    console.error("[guatemala/sale-advice] quote failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo calcular el precio." }, { status: 500 });
  }
}

function readAdvicePhotos(value: unknown): WireImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((photo) => {
    if (!photo || typeof photo !== "object") return [];
    const mediaType = "mediaType" in photo && typeof photo.mediaType === "string" ? photo.mediaType : "";
    const data = "data" in photo && typeof photo.data === "string" ? photo.data : "";
    if (!mediaType || !data || data.length > 7_000_000) return [];
    return [{ mediaType, data }];
  }).slice(0, 2);
}
