import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { readPricingSettings, savePricingSettings } from "@/lib/markets/guatemala-pricing-settings";
import { monthlyExpenseShare } from "@/lib/markets/guatemala-sale-advice";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId") ?? "";
  const access = await authorizeGuatemalaRequest(request, clientId, "read");
  if (!access.ok) return access.response;
  try {
    const settings = await readPricingSettings(access.clientId);
    return NextResponse.json({
      ok: true,
      configured: Boolean(settings),
      settings,
      expenseShareGtq: settings ? monthlyExpenseShare(settings) : null,
    });
  } catch (error) {
    console.error("[guatemala/pricing-settings] read failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo cargar la configuración del precio." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la configuración." }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(request, typeof body.clientId === "string" ? body.clientId : "", "manage");
  if (!access.ok) return access.response;
  try {
    const result = await savePricingSettings(access.clientId, body);
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json({
      ok: true,
      settings: result.settings,
      expenseShareGtq: monthlyExpenseShare(result.settings),
    });
  } catch (error) {
    console.error("[guatemala/pricing-settings] save failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo guardar la configuración del precio." }, { status: 500 });
  }
}
