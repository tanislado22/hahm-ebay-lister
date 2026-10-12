import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { listVintedInventory, vintedInventoryCounts } from "@/lib/vinted/inventory-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  try {
    const query = req.nextUrl.searchParams.get("q") ?? "";
    const [counts, items] = await Promise.all([vintedInventoryCounts(), listVintedInventory(query)]);
    return NextResponse.json({ ok: true, counts, items });
  } catch (error) {
    console.error("[vinted/inventory]", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo leer el inventario de Vinted." }, { status: 500 });
  }
}
