import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import {
  parseInventoryImport,
  VINTED_SYNC_BATCH_LIMIT,
  VINTED_SYNC_PILOT_LIMIT,
  type VintedCollectedItem,
} from "@/lib/vinted/inventory-match";
import { syncVintedInventory } from "@/lib/vinted/inventory-store";

export const dynamic = "force-dynamic";

function cleanItem(value: unknown): VintedCollectedItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const vintedItemId = String(row.vintedItemId || row.id || "").trim();
  const url = String(row.url || "").trim();
  if (!vintedItemId || !url) return null;
  return {
    vintedItemId,
    title: String(row.title || "").trim(),
    url,
    photoUrl: String(row.photoUrl || row.photo || "").trim(),
    brand: String(row.brand || "").trim(),
    size: String(row.size || "").trim(),
  };
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { items?: unknown; text?: unknown; confirmFullSync?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const fromItems = Array.isArray(body.items) ? body.items.map(cleanItem).filter((item): item is VintedCollectedItem => Boolean(item)) : [];
  const fromFile = typeof body.text === "string" ? parseInventoryImport(body.text) : [];
  const seen = new Set<string>();
  const items = [...fromItems, ...fromFile].filter((item) => {
    if (seen.has(item.vintedItemId)) return false;
    seen.add(item.vintedItemId);
    return true;
  });
  if (!items.length) {
    return NextResponse.json({ ok: false, error: "No hay publicaciones de Vinted para sincronizar." }, { status: 400 });
  }
  const full = body.confirmFullSync === true;
  const limit = full ? VINTED_SYNC_BATCH_LIMIT : VINTED_SYNC_PILOT_LIMIT;
  if (items.length > limit) {
    return NextResponse.json(
      {
        ok: false,
        error: full
          ? `Cada lote acepta hasta ${VINTED_SYNC_BATCH_LIMIT} publicaciones.`
          : `La prueba inicial acepta ${VINTED_SYNC_PILOT_LIMIT} publicaciones. No se sincronizó ninguna.`,
      },
      { status: 400 }
    );
  }
  try {
    const result = await syncVintedInventory(items);
    return NextResponse.json({ ok: true, ...result, pilot: !full });
  } catch (error) {
    console.error("[vinted/inventory/sync]", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo guardar la sincronización." }, { status: 500 });
  }
}
