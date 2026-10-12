import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import {
  listDuplicateGroups,
  listReviewedVintedIds,
  listVintedInventory,
  vintedInventoryCounts,
} from "@/lib/vinted/inventory-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  try {
    const query = req.nextUrl.searchParams.get("q") ?? "";
    const [counts, items, groups, reviewedIds] = await Promise.all([
      vintedInventoryCounts(),
      listVintedInventory(query),
      listDuplicateGroups(),
      listReviewedVintedIds(),
    ]);
    return NextResponse.json({ ok: true, counts, items, groups, reviewedIds });
  } catch (error) {
    console.error("[vinted/inventory]", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo leer el inventario de Vinted." }, { status: 500 });
  }
}
