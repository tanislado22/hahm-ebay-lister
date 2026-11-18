import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { GUATEMALA_INVENTORY_MESSAGES } from "@/lib/markets/guatemala-inventory";
import { PHOTO_SEARCH_MESSAGES } from "@/lib/markets/guatemala-photo-search";
import { searchGuatemalaGarmentsByPhoto } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ ok: false, error: PHOTO_SEARCH_MESSAGES.unreadable }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(request, typeof body.clientId === "string" ? body.clientId : "", "read");
  if (!access.ok) return access.response;
  const photo = body.photo && typeof body.photo === "object" ? (body.photo as { mediaType?: unknown; data?: unknown }) : {};
  try {
    const result = await searchGuatemalaGarmentsByPhoto({
      clientId: access.clientId,
      mediaType: photo.mediaType,
      data: photo.data,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/buscar-foto] search failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: GUATEMALA_INVENTORY_MESSAGES.retry }, { status: 500 });
  }
}
