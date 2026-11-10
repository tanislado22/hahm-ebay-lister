import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { confirmSkuLessSale } from "@/lib/markets/guatemala-skuless-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { clientId?: unknown; requestId?: unknown; pieces?: unknown; chargedPrice?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la venta." }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(request, typeof body.clientId === "string" ? body.clientId : "", "sell");
  if (!access.ok) return access.response;
  try {
    const result = await confirmSkuLessSale({
      clientId: access.clientId,
      actor: access.actor,
      requestId: body.requestId,
      pieces: body.pieces,
      chargedPrice: body.chargedPrice,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/skuless] sale failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo registrar la venta." }, { status: 500 });
  }
}
