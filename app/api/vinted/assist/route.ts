import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { workspaceKey } from "@/lib/inventory/workspace";
import { getLatestReadySnapshot, getVintedReadySnapshot } from "@/lib/vinted/snapshot-store";

export const dynamic = "force-dynamic";

function assistJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  });
}

function photoName(sku: string, index: number, mediaType: string): string {
  const safe = sku.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  const ext = /png/i.test(mediaType) ? "png" : /webp/i.test(mediaType) ? "webp" : "jpg";
  return `${safe}-${index + 1}.${ext}`;
}

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  const workModeParam = req.nextUrl.searchParams.get("workMode");
  const workspace = workModeParam
    ? workspaceKey(workModeParam, req.nextUrl.searchParams.get("clientId"))
    : "store";
  if (!workspace) {
    return assistJson({ ok: false, error: "Select a client first." }, 400);
  }

  try {
    const snapshot = workModeParam
      ? await getVintedReadySnapshot(workspace)
      : await getLatestReadySnapshot();
    if (!snapshot) {
      return assistJson(
        { ok: false, error: "Prepare one item for Vinted in Listing Writer first." },
        404
      );
    }
    const requestedSku = req.nextUrl.searchParams.get("sku")?.trim() || "";
    if (requestedSku && requestedSku !== snapshot.sku) {
      return assistJson({ ok: false, error: `No Ready item with SKU ${requestedSku}.` }, 404);
    }

    const photoParam = req.nextUrl.searchParams.get("photo");
    if (photoParam !== null) {
      const index = Number(photoParam);
      const photo = snapshot.photos[index];
      if (!Number.isInteger(index) || index < 0 || !photo?.data) {
        return assistJson({ ok: false, error: "That photo is not on this item." }, 404);
      }
      const mediaType = photo.mediaType || "image/jpeg";
      return assistJson({
        ok: true,
        sku: snapshot.sku,
        updatedAt: snapshot.updatedAt,
        photo: {
          name: photoName(snapshot.sku, index, mediaType),
          mediaType,
          data: photo.data,
        },
      });
    }

    return assistJson({
      ok: true,
      sku: snapshot.sku,
      title: snapshot.title,
      description: snapshot.description,
      price: snapshot.price,
      brand: snapshot.brand,
      category: snapshot.category,
      itemType: snapshot.itemType,
      size: snapshot.size,
      color: snapshot.color,
      condition: snapshot.condition,
      photoCount: snapshot.photos.length,
      updatedAt: snapshot.updatedAt,
    });
  } catch (error) {
    console.error("[vinted/assist]", error);
    return assistJson({ ok: false, error: "Could not load the Vinted assist item." }, 500);
  }
}
