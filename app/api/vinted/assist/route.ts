import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { getSql } from "@/lib/db";
import {
  getLatestVintedCurrent,
  getVintedCurrentSku,
  listListings,
  type PlatformListing,
} from "@/lib/inventory/links";
import { workspaceKey } from "@/lib/inventory/workspace";
import {
  formatVintedCategoryPath,
  resolveVintedCategory,
} from "@/lib/vinted/category-map";
import { listVintedCategoryMaps } from "@/lib/vinted/category-maps";
import { photosForPreparedSku, type VintedPrepared } from "@/lib/vinted/prepare";

export const dynamic = "force-dynamic";

const MAX_PHOTOS = 20;

function assistJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  });
}

interface StoredPhoto {
  mediaType?: string;
  data?: string;
}

function photoName(sku: string, index: number, mediaType: string): string {
  const safe = sku.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  const ext = /png/i.test(mediaType) ? "png" : /webp/i.test(mediaType) ? "webp" : "jpg";
  return `${safe}-${index + 1}.${ext}`;
}

function jobPhotos(raw: unknown): { sku: string; photos: StoredPhoto[] } {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const record = data as { group?: { sku?: string }; photos?: StoredPhoto[] } | null;
  const photos = Array.isArray(record?.photos) ? record.photos : [];
  return { sku: String(record?.group?.sku ?? ""), photos };
}

async function photosForSku(sku: string): Promise<StoredPhoto[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT data
    FROM jobs
    WHERE data->'group'->>'sku' = ${sku}
    ORDER BY updated_at DESC
    LIMIT 20
  `;
  const jobs = rows.map((row) => jobPhotos((row as Record<string, unknown>).data));
  return photosForPreparedSku(jobs, sku).slice(0, MAX_PHOTOS);
}

function categoryFor(listing: PlatformListing, maps: { itemType: string; path: string[] }[]) {
  const prepared: Partial<VintedPrepared> = listing.prepared ?? {};
  return resolveVintedCategory(
    {
      title: prepared.title || listing.vintedTitle || listing.ebayTitle || "",
      brand: prepared.brand || "",
      bucket: prepared.category || "",
      savedCategory: prepared.vintedCategory || "",
    },
    maps
  );
}

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  const explicitSku = req.nextUrl.searchParams.get("sku")?.trim() || "";
  const workModeParam = req.nextUrl.searchParams.get("workMode");

  try {
    let workspace: string | null = null;
    let sku = explicitSku;
    if (workModeParam) {
      workspace = workspaceKey(workModeParam, req.nextUrl.searchParams.get("clientId"));
      if (!workspace) {
        return assistJson({ ok: false, error: "Select a client first." }, 400);
      }
      if (!sku) sku = (await getVintedCurrentSku(workspace)) || "";
    } else {
      const latest = await getLatestVintedCurrent();
      workspace = latest?.workspaceKey ?? null;
      if (!sku) sku = latest?.sku ?? "";
    }
    if (!workspace || !sku) {
      return assistJson(
        { ok: false, error: "Prepare one item for Vinted in Listing Writer first." },
        404
      );
    }

    const maps = await listVintedCategoryMaps();
    const listings = await listListings(workspace);
    const ready = listings.filter((listing) => listing.vintedStatus === "ready");
    const chosen = ready.find((listing) => listing.sku === sku);
    if (!chosen) {
      return assistJson({ ok: false, error: `No Ready item with SKU ${sku}.` }, 404);
    }

    const prepared = chosen.prepared;
    const category = categoryFor(chosen, maps);
    const photoParam = req.nextUrl.searchParams.get("photo");
    if (photoParam !== null) {
      const index = Number(photoParam);
      const photos = await photosForSku(chosen.sku);
      const photo = photos[index];
      if (!Number.isInteger(index) || index < 0 || !photo?.data) {
        return assistJson({ ok: false, error: "That photo is not on this item." }, 404);
      }
      const mediaType = photo.mediaType || "image/jpeg";
      return assistJson({
        ok: true,
        sku: chosen.sku,
        photo: {
          name: photoName(chosen.sku, index, mediaType),
          mediaType,
          data: photo.data,
        },
      });
    }

    let photoCount = 0;
    try {
      photoCount = (await photosForSku(chosen.sku)).length;
    } catch (error) {
      console.error("[vinted/assist] photos", error);
    }

    return assistJson({
      ok: true,
      sku: chosen.sku,
      title: prepared?.title || chosen.vintedTitle || "",
      description: prepared?.description || "",
      price: prepared?.price || "",
      itemType: category?.itemType || "",
      vintedCategory: category ? formatVintedCategoryPath(category.path) : "",
      vintedCategoryPath: category?.path || [],
      photoCount,
    });
  } catch (error) {
    console.error("[vinted/assist]", error);
    return assistJson({ ok: false, error: "Could not load the Vinted assist item." }, 500);
  }
}
