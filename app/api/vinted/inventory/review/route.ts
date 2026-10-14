import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { requireEbayAccessToken } from "@/lib/ebay/route-access";
import { planManualEbayItem } from "@/lib/vinted/manual-ebay-item";
import { loadOwnEbayCandidates, reviewVintedInventory } from "@/lib/vinted/inventory-store";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["confirm_duplicate", "not_duplicate", "withdrawn", "not_sold", "mark_reviewed", "set_ebay_item", "reject_suggestion", "archive", "restore", "mark_removed", "drop_removed"]);

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
  let manualItem: { ebayItemId: string; suggestedSku: string; title: string; detail: string } | undefined;
  if (action === "set_ebay_item") {
    const token = await requireEbayAccessToken(req, { workMode: "store" });
    if (token instanceof NextResponse) {
      const payload = (await token.json().catch(() => null)) as { error?: string } | null;
      return NextResponse.json(
        { ok: false, error: payload?.error || "eBay no está conectado. No se guardó el Item ID." },
        { status: token.status }
      );
    }
    try {
      const catalog = await loadOwnEbayCandidates(token);
      const plan = planManualEbayItem(
        String(body.ebayItemId || ""),
        catalog.map((listing) => ({
          ebayItemId: listing.ebayItemId || "",
          sku: listing.sku,
          title: listing.ebayTitle,
        }))
      );
      if (!plan.ok) return NextResponse.json({ ok: false, error: plan.error }, { status: 400 });
      manualItem = plan;
    } catch (error) {
      console.error("[vinted/inventory/review]", error instanceof Error ? error.name : "Error");
      return NextResponse.json(
        { ok: false, error: "No se pudo consultar tu cuenta de eBay. No se guardó el Item ID." },
        { status: 502 }
      );
    }
  }
  try {
    const result = await reviewVintedInventory({
      vintedItemId: String(body.vintedItemId || ""),
      action: action as "confirm_duplicate" | "not_duplicate" | "withdrawn" | "not_sold" | "mark_reviewed" | "set_ebay_item" | "reject_suggestion" | "archive" | "restore" | "mark_removed" | "drop_removed",
      relatedIds,
      ebayItemId: String(body.ebayItemId || ""),
      sku: String(body.sku || ""),
      manualItem,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[vinted/inventory/review]", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo guardar la revisión." }, { status: 500 });
  }
}
