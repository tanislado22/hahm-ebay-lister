import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { setVintedCurrentSku, upsertVintedReady } from "@/lib/inventory/links";
import { workspaceKey } from "@/lib/inventory/workspace";
import { prepareVintedFields } from "@/lib/vinted/prepare";
import { skuForVintedPrepare } from "@/lib/sku";
import type { ListingResult } from "@/lib/types";

export const dynamic = "force-dynamic";

interface PrepareItem {
  sku?: string;
  listing?: ListingResult;
  ebayItemId?: string | null;
  publishedOnEbay?: boolean;
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: { workMode?: string; clientId?: string | null; items?: PrepareItem[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const workspace = workspaceKey(body.workMode, body.clientId);
  if (!workspace) {
    return NextResponse.json({ ok: false, error: "Select a client before preparing Vinted." }, { status: 400 });
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: "No items to prepare." }, { status: 400 });
  }
  if (items.length > 100) {
    return NextResponse.json({ ok: false, error: "Prepare at most 100 items at a time." }, { status: 400 });
  }

  try {
    let prepared = 0;
    let currentSku = "";
    for (const item of items) {
      const sku = skuForVintedPrepare(item.sku);
      if (!sku || !item.listing?.title) continue;
      if (items.length === 1) {
        currentSku = sku;
        await setVintedCurrentSku(workspace, sku);
      }
      const fields = prepareVintedFields(sku, item.listing);
      await upsertVintedReady({
        workspaceKey: workspace,
        prepared: fields,
        ebayItemId: item.ebayItemId,
        ebayTitle: item.listing.title,
        publishedOnEbay: item.publishedOnEbay,
      });
      prepared += 1;
    }
    if (prepared === 0) {
      return NextResponse.json(
        { ok: false, error: "Each item needs a SKU and a written listing." },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, prepared, sku: currentSku });
  } catch (error) {
    console.error("[vinted/prepare]", error);
    return NextResponse.json({ ok: false, error: "Could not prepare Vinted items." }, { status: 500 });
  }
}
