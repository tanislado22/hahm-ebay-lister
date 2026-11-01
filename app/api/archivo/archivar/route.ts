import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { existingVintedLink, type LocalRecord } from "@/lib/archive/link";
import { saveWorkspaceArticle, setArchiveHidden } from "@/lib/archive/store";
import { exactSku } from "@/lib/archive/text";
import { archiveAccountKey, assertCanArchive } from "@/lib/archive/workspace";
import { ensureInventoryTables, getSql } from "@/lib/db";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import type { ItemGroup } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PHOTOS = 24;
const MAX_PHOTO_CHARS = 8_000_000;

function asGroup(value: unknown): ItemGroup | null {
  if (!value || typeof value !== "object") return null;
  const group = value as Partial<ItemGroup>;
  if (typeof group.id !== "string" || !group.id.trim()) return null;
  return {
    id: group.id,
    sku: typeof group.sku === "string" ? group.sku : "",
    name: typeof group.name === "string" ? group.name : "",
    photoIds: Array.isArray(group.photoIds) ? group.photoIds.filter((id): id is string => typeof id === "string") : [],
    listing: group.listing,
    status: group.status || "done",
    error: group.error,
    comps: group.comps,
    postStatus: group.postStatus,
    listingId: typeof group.listingId === "string" ? group.listingId : undefined,
    postError: group.postError,
    postWarnings: group.postWarnings,
    vintedStatus: group.vintedStatus,
    vintedListingUrl: typeof group.vintedListingUrl === "string" ? group.vintedListingUrl : undefined,
    clientId: group.clientId,
  };
}

function asPhotos(value: unknown): { id: string; mediaType: string; data: string }[] | { error: string } {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_PHOTOS) return { error: "Hay demasiadas fotos para archivar de una vez." };
  const photos: { id: string; mediaType: string; data: string }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const photo = entry as { id?: unknown; mediaType?: unknown; data?: unknown };
    const data = typeof photo.data === "string" ? photo.data : "";
    if (!data) continue;
    if (data.length > MAX_PHOTO_CHARS) return { error: "Una foto es demasiado grande. El artículo sigue en el área de trabajo." };
    const mediaType = typeof photo.mediaType === "string" && photo.mediaType.startsWith("image/") ? photo.mediaType : "image/jpeg";
    photos.push({ id: typeof photo.id === "string" ? photo.id : "", mediaType, data });
  }
  return photos;
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { workMode?: unknown; clientId?: unknown; group?: unknown; photos?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer el artículo." }, { status: 400 });
  }
  const accountKey = archiveAccountKey(body.workMode, body.clientId);
  if (!accountKey) return NextResponse.json({ ok: false, error: "La cuenta del archivo no es válida." }, { status: 400 });
  if (accountKey.startsWith("client:") && (await clientIsGuatemala(accountKey.slice("client:".length)))) {
    return NextResponse.json({ ok: false, error: "El inventario y el catálogo de Guatemala no se modifican desde el archivo." }, { status: 400 });
  }
  const group = asGroup(body.group);
  if (!group) return NextResponse.json({ ok: false, error: "Falta el artículo que se quiere archivar." }, { status: 400 });
  const blocked = assertCanArchive(group);
  if (blocked) return NextResponse.json({ ok: false, error: blocked }, { status: 400 });
  const photos = asPhotos(body.photos);
  if ("error" in photos) return NextResponse.json({ ok: false, error: photos.error }, { status: 400 });

  try {
    const sql = getSql();
    await ensureInventoryTables();
    const itemId = exactSku(group.listingId).replace(/\D/g, "");
    const sku = exactSku(group.sku);
    const rows = await sql`
      SELECT id, sku, ebay_item_id, vinted_listing_url, vinted_listing_id, vinted_title, vinted_status
      FROM platform_listings
      WHERE workspace_key = ${accountKey}
        AND ((${itemId} <> '' AND ebay_item_id = ${itemId}) OR (${sku} <> '' AND sku = ${sku}))
    `;
    const locals: LocalRecord[] = rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: String(record.id ?? ""),
        source: "platform",
        sku: exactSku(record.sku),
        ebayItemId: String(record.ebay_item_id ?? "").trim(),
        vintedListingUrl: String(record.vinted_listing_url ?? "").trim(),
        vintedListingId: String(record.vinted_listing_id ?? "").trim(),
        vintedTitle: String(record.vinted_title ?? "").trim(),
        vintedStatus: String(record.vinted_status ?? "").trim(),
      };
    });
    const vinted = existingVintedLink({
      rows: locals,
      ebayItemId: itemId,
      sku,
      groupUrl: group.vintedListingUrl || "",
      groupStatus: group.vintedStatus || "",
    });
    const saved = await saveWorkspaceArticle({
      accountKey,
      group,
      photos,
      vintedListingUrl: vinted.url,
      vintedListingId: vinted.id,
      vintedTitle: vinted.title,
      vintedStatus: vinted.status,
    });
    return NextResponse.json({ ok: true, id: saved.id });
  } catch (error) {
    console.error("[archivo] archivar", error);
    return NextResponse.json({ ok: false, error: "No se pudo guardar el artículo en el archivo. Sigue en el área de trabajo." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { id?: unknown; hidden?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo actualizar el archivo." }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ ok: false, error: "Falta el artículo." }, { status: 400 });
  }
  try {
    await setArchiveHidden(body.id, Boolean(body.hidden));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[archivo] hidden", error);
    return NextResponse.json({ ok: false, error: "No se pudo actualizar el archivo." }, { status: 500 });
  }
}
