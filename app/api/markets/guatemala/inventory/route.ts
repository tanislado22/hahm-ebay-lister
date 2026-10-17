import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import {
  listGuatemalaInventory,
  saveGuatemalaInventoryItem,
} from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId") ?? "";
  const access = await authorizeGuatemalaRequest(request, clientId, "read");
  if (!access.ok) return access.response;
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const filter = request.nextUrl.searchParams.get("estado");
  try {
    const result = await listGuatemalaInventory(access.clientId, query, filter);
    if ("ok" in result && result.ok === false) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[guatemala/inventory] list failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo cargar el inventario." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la prenda." }, { status: 400 });
  }
  const clientId =
    body && typeof body === "object" && "clientId" in body ? String((body as { clientId?: unknown }).clientId ?? "") : "";
  const access = await authorizeGuatemalaRequest(request, clientId, "write");
  if (!access.ok) return access.response;
  try {
    const result = await saveGuatemalaInventoryItem(
      body && typeof body === "object" ? body : {}
    );
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      action: result.action,
      item: {
        id: result.item.id,
        sku: result.item.sku,
        priceGtq: result.item.priceGtq,
        photoCount: result.item.photos.length,
      },
    });
  } catch (error) {
    console.error("[guatemala/inventory] save failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo guardar la prenda." }, { status: 500 });
  }
}
