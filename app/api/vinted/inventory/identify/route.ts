import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { identifySkuBatch } from "@/lib/vinted/inventory-store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  try {
    const progress = await identifySkuBatch(30);
    return NextResponse.json({ ok: true, ...progress, done: progress.identifyRemaining === 0 });
  } catch (error) {
    console.error("[vinted/inventory/identify]", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo identificar este lote." }, { status: 500 });
  }
}
