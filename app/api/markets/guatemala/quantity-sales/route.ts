import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { confirmQuantityCheckout } from "@/lib/markets/guatemala-quantity-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: {
    clientId?: unknown;
    requestId?: unknown;
    chargedPrice?: unknown;
    paymentMethod?: unknown;
    cashReceived?: unknown;
    pieceLines?: unknown;
    itemIds?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la venta." }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(request, typeof body.clientId === "string" ? body.clientId : "", "sell");
  if (!access.ok) return access.response;
  try {
    const result = await confirmQuantityCheckout({
      clientId: access.clientId,
      actor: access.actor,
      requestId: body.requestId,
      chargedPrice: body.chargedPrice,
      paymentMethod: body.paymentMethod,
      cashReceived: body.cashReceived,
      pieceLines: body.pieceLines,
      itemIds: body.itemIds,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/quantity] sale failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo registrar la venta." }, { status: 500 });
  }
}
