import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { recordEbayPublished } from "@/lib/inventory/links";
import { workspaceKey } from "@/lib/inventory/workspace";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: {
    workMode?: string;
    clientId?: string | null;
    sku?: string;
    ebayItemId?: string;
    ebayTitle?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const workspace = workspaceKey(body.workMode, body.clientId);
  const sku = body.sku?.trim() ?? "";
  const ebayItemId = body.ebayItemId?.trim() ?? "";
  if (!workspace || !sku || !ebayItemId) {
    return NextResponse.json(
      { ok: false, error: "Workspace, SKU, and eBay item ID are required." },
      { status: 400 }
    );
  }

  try {
    await recordEbayPublished({
      workspaceKey: workspace,
      sku,
      ebayItemId,
      ebayTitle: (body.ebayTitle ?? "").trim(),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[inventory/ebay-published]", error);
    return NextResponse.json({ ok: false, error: "Could not save the eBay link." }, { status: 500 });
  }
}
