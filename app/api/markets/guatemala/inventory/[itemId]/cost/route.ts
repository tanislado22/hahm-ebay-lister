import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { updateGuatemalaGarmentCost } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await context.params;
  let body: { clientId?: unknown; cost?: unknown; includesPhotography?: unknown };
  try {
    body = (await request.json()) as { clientId?: unknown; cost?: unknown; includesPhotography?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer el costo." }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(
    request,
    typeof body?.clientId === "string" ? body.clientId : "",
    "write"
  );
  if (!access.ok) return access.response;
  try {
    const result = await updateGuatemalaGarmentCost({
      clientId: access.clientId,
      itemId,
      cost: body?.cost,
      includesPhotography: body?.includesPhotography,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/inventory] cost failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo guardar el costo." }, { status: 500 });
  }
}
