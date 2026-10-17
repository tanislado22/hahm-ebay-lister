import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { confirmGuatemalaSale } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await context.params;
  let body: { clientId?: unknown; chargedPrice?: unknown };
  try {
    body = (await request.json()) as { clientId?: unknown; chargedPrice?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la venta." }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(request, typeof body?.clientId === "string" ? body.clientId : "", "sell");
  if (!access.ok) return access.response;
  try {
    const result = await confirmGuatemalaSale({
      clientId: access.clientId,
      itemId,
      chargedPrice: body?.chargedPrice,
      soldBy: access.actor,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/inventory] sale failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo registrar la venta." }, { status: 500 });
  }
}
