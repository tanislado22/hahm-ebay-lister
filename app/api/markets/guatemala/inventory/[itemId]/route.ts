import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { readGuatemalaInventoryItem } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  const denied = guardApiRequest(request);
  if (denied) return denied;
  const { itemId } = await context.params;
  const clientId = request.nextUrl.searchParams.get("clientId") ?? "";
  try {
    const result = await readGuatemalaInventoryItem(clientId, itemId);
    if ("ok" in result && result.ok === false) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, item: result });
  } catch (error) {
    console.error("[guatemala/inventory] read failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo abrir la prenda." }, { status: 500 });
  }
}
