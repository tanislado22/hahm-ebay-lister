import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import {
  listGuatemalaInventory,
  saveGuatemalaInventoryItem,
} from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = guardApiRequest(request);
  if (denied) return denied;
  const clientId = request.nextUrl.searchParams.get("clientId") ?? "";
  const query = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const result = await listGuatemalaInventory(clientId, query);
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
  const denied = guardApiRequest(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la prenda." }, { status: 400 });
  }
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
