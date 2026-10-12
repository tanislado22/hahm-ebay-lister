import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { requireEbayAccessToken } from "@/lib/ebay/route-access";
import { identifySkuBatch, loadOwnEbayCandidates, reopenUnverifiedIdentification } from "@/lib/vinted/inventory-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let restart = false;
  try {
    const body = (await req.json()) as { restart?: unknown };
    restart = body.restart === true;
  } catch {
    restart = false;
  }
  const token = await requireEbayAccessToken(req, { workMode: "store" });
  if (token instanceof NextResponse) {
    const payload = (await token.json().catch(() => null)) as { error?: string } | null;
    return NextResponse.json(
      {
        ok: false,
        error: payload?.error || "eBay no está conectado. Conecta tu cuenta antes de identificar SKU. No se modificó ningún artículo.",
      },
      { status: 409 }
    );
  }
  let catalog;
  try {
    catalog = await loadOwnEbayCandidates(token);
  } catch (error) {
    console.error("[vinted/inventory/identify]", error instanceof Error ? error.name : "Error");
    return NextResponse.json(
      {
        ok: false,
        error: "No se pudo consultar tu inventario activo de eBay. No se marcó ningún artículo como sin coincidencia.",
      },
      { status: 502 }
    );
  }
  if (!catalog.length) {
    return NextResponse.json(
      {
        ok: false,
        error: "Tu cuenta de eBay no devolvió publicaciones activas. No se marcó ningún artículo como sin coincidencia.",
      },
      { status: 409 }
    );
  }
  try {
    const reopened = restart ? await reopenUnverifiedIdentification() : 0;
    const progress = await identifySkuBatch(30, catalog);
    return NextResponse.json({
      ok: true,
      ...progress,
      catalogSize: catalog.length,
      reopened,
      done: progress.identifyRemaining === 0,
    });
  } catch (error) {
    console.error("[vinted/inventory/identify]", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo guardar este lote. Los artículos ya confirmados no se modificaron." }, { status: 500 });
  }
}
