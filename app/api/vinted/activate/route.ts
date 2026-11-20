import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { getListingBySku, setVintedCurrentSku } from "@/lib/inventory/links";
import { workspaceKey } from "@/lib/inventory/workspace";
import { downloadEbayPhoto, materializeSavedPhotos } from "@/lib/vinted/saved-photo";
import { buildReadySnapshotFromPrepared } from "@/lib/vinted/snapshot";
import { replaceVintedReadySnapshot, savedPhotosForSku } from "@/lib/vinted/snapshot-store";

export const dynamic = "force-dynamic";

/**
 * Point the Vinted assist snapshot at a Ready queue item, including photos from
 * jobs (previewUrl / data / eBay URL). Opening Vinted from the queue calls this
 * so Fill Ready Vinted item receives the same pictures the queue shows.
 */
export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: { workMode?: string; clientId?: string | null; sku?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const workspace = workspaceKey(body.workMode, body.clientId);
  const sku = body.sku?.trim() ?? "";
  if (!workspace || !sku) {
    return NextResponse.json({ ok: false, error: "SKU and workspace are required." }, { status: 400 });
  }

  try {
    const listing = await getListingBySku(workspace, sku);
    if (!listing || (listing.vintedStatus !== "ready" && listing.vintedStatus !== "published")) {
      return NextResponse.json(
        { ok: false, error: `No Ready item with SKU ${sku}.` },
        { status: 404 }
      );
    }
    const prepared = listing.prepared;
    if (!prepared?.title) {
      return NextResponse.json(
        { ok: false, error: "This Ready item has no saved Vinted fields yet." },
        { status: 400 }
      );
    }

    const stored = await savedPhotosForSku(sku);
    const photos = await materializeSavedPhotos(stored, downloadEbayPhoto);
    const snapshot = buildReadySnapshotFromPrepared({
      prepared: { ...prepared, sku },
      photos,
    });
    await setVintedCurrentSku(workspace, snapshot.sku);
    await replaceVintedReadySnapshot(workspace, snapshot);

    return NextResponse.json({
      ok: true,
      sku: snapshot.sku,
      photoCount: snapshot.photos.length,
    });
  } catch (error) {
    console.error("[vinted/activate]", error);
    return NextResponse.json({ ok: false, error: "Could not open this item for Vinted." }, { status: 500 });
  }
}
