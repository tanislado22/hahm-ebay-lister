import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { reviewVintedInventory } from "@/lib/vinted/inventory-store";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["confirm_duplicate", "not_duplicate", "withdrawn", "not_sold", "mark_reviewed", "set_ebay_item", "reject_suggestion", "archive", "restore"]);

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { vintedItemId?: unknown; action?: unknown; relatedIds?: unknown; ebayItemId?: unknown; sku?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const action = String(body.action || "");
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, error: "Acción no permitida." }, { status: 400 });
  }
  const relatedIds = Array.isArray(body.relatedIds) ? body.relatedIds.map((id) => String(id)) : [];
  try {
    const result = await reviewVintedInventory({
      vintedItemId: String(body.vintedItemId || ""),
      action: action as "confirm_duplicate" | "not_duplicate" | "withdrawn" | "not_sold" | "mark_reviewed" | "set_ebay_item" | "reject_suggestion" | "archive" | "restore",
      relatedIds,
      ebayItemId: String(body.ebayItemId || ""),
      sku: String(body.sku || ""),
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[vinted/inventory/review]", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo guardar la revisión." }, { status: 500 });
  }
}
