import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { archiveAccountKey } from "@/lib/archive/workspace";
import { recordEbayPublished } from "@/lib/inventory/links";
import { workspaceKey } from "@/lib/inventory/workspace";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import { rememberPublishedLot } from "@/lib/usa-lots/store";

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
    lotId?: string;
    jobId?: string;
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
    const accountKey = archiveAccountKey(body.workMode, body.clientId);
    let lotSaved = true;
    let lotError = "";
    if (accountKey && !(accountKey.startsWith("client:") && (await clientIsGuatemala(accountKey.slice("client:".length))))) {
      try {
        const lot = await rememberPublishedLot({
          accountKey,
          lotId: body.lotId?.trim() ?? "",
          sku,
          ebayItemId,
          title: (body.ebayTitle ?? "").trim(),
          jobId: body.jobId?.trim() ?? "",
        });
        lotSaved = lot.saved;
        lotError = lot.saved ? "" : lot.error;
      } catch (error) {
        console.error("[inventory/ebay-published] lot", error);
        lotSaved = false;
        lotError = "El anuncio quedó publicado, pero no se pudo guardar el lote.";
      }
    }
    return NextResponse.json({ ok: true, lotSaved, lotError });
  } catch (error) {
    console.error("[inventory/ebay-published]", error);
    return NextResponse.json({ ok: false, error: "Could not save the eBay link." }, { status: 500 });
  }
}
