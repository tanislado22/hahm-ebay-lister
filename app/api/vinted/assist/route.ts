import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { getSql } from "@/lib/db";
import { listListings, type PlatformListing } from "@/lib/inventory/links";
import { workspaceKey } from "@/lib/inventory/workspace";
import {
  formatVintedCategoryPath,
  resolveVintedCategory,
} from "@/lib/vinted/category-map";
import { listVintedCategoryMaps } from "@/lib/vinted/category-maps";
import type { VintedPrepared } from "@/lib/vinted/prepare";

export const dynamic = "force-dynamic";

const MAX_PHOTOS = 20;

interface StoredPhoto {
  mediaType?: string;
  data?: string;
}

function isNike(listing: PlatformListing): boolean {
  const prepared = listing.prepared;
  const text = [prepared?.brand, prepared?.title, listing.vintedTitle, listing.ebayTitle]
    .filter(Boolean)
    .join(" ");
  return /nike/i.test(text);
}

function photoName(sku: string, index: number, mediaType: string): string {
  const safe = sku.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  const ext = /png/i.test(mediaType) ? "png" : /webp/i.test(mediaType) ? "webp" : "jpg";
  return `${safe}-${index + 1}.${ext}`;
}

async function photosForSku(sku: string): Promise<StoredPhoto[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT data
    FROM jobs
    WHERE data->'group'->>'sku' = ${sku}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return [];
  const raw = (rows[0] as Record<string, unknown>).data;
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const photos = (data as { photos?: StoredPhoto[] } | null)?.photos;
  return Array.isArray(photos) ? photos.filter((photo) => photo?.data).slice(0, MAX_PHOTOS) : [];
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

  const workspace = workspaceKey(
    req.nextUrl.searchParams.get("workMode") || "store",
    req.nextUrl.searchParams.get("clientId")
  );
  if (!workspace) {
    return NextResponse.json({ ok: false, error: "Select a client first." }, { status: 400 });
  }

  try {
    const maps = await listVintedCategoryMaps();
    const listings = await listListings(workspace);
    const ready = listings.filter((listing) => listing.vintedStatus === "ready");
    const sku = req.nextUrl.searchParams.get("sku")?.trim();
    const match = (req.nextUrl.searchParams.get("match") || "nike").toLowerCase();
    const chosen = sku
      ? ready.find((listing) => listing.sku === sku)
      : match === "nike"
        ? ready.find(isNike)
        : ready[0];
    if (!chosen) {
      return NextResponse.json(
        { ok: false, error: sku ? `No Ready item with SKU ${sku}.` : "No Ready Nike item." },
        { status: 404 }
      );
    }

    const prepared = chosen.prepared;
    const category = categoryFor(chosen, maps);
    const photoParam = req.nextUrl.searchParams.get("photo");
    if (photoParam !== null) {
      const index = Number(photoParam);
      const photos = await photosForSku(chosen.sku);
      const photo = photos[index];
      if (!Number.isInteger(index) || index < 0 || !photo?.data) {
        return NextResponse.json({ ok: false, error: "That photo is not on this item." }, { status: 404 });
      }
      const mediaType = photo.mediaType || "image/jpeg";
      return NextResponse.json({
        ok: true,
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

    return NextResponse.json({
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
    return NextResponse.json({ ok: false, error: "Could not load the Vinted assist item." }, { status: 500 });
  }
}
