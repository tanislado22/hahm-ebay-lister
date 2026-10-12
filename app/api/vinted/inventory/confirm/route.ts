import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { confirmVintedInventoryMatch } from "@/lib/vinted/inventory-store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { vintedItemId?: unknown; sku?: unknown; ebayItemId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  try {
    const result = await confirmVintedInventoryMatch(String(body.vintedItemId || ""), String(body.sku || ""), String(body.ebayItemId || ""));
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[vinted/inventory/confirm]", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo confirmar la asociación." }, { status: 500 });
  }
}
