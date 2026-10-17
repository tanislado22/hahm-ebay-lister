import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { correctGuatemalaSale } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await context.params;
  let body: {
    clientId?: unknown;
    action?: unknown;
    chargedPrice?: unknown;
    expectedChargedPrice?: unknown;
    reason?: unknown;
    correctionId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la corrección." }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(
    request,
    typeof body.clientId === "string" ? body.clientId : "",
    "correct"
  );
  if (!access.ok) return access.response;
  if (body.action !== "corregir" && body.action !== "anular") {
    return NextResponse.json({ ok: false, error: "Elige corregir o anular." }, { status: 400 });
  }
  try {
    const result = await correctGuatemalaSale({
      clientId: access.clientId,
      itemId,
      action: body.action,
      correctionId: typeof body.correctionId === "string" ? body.correctionId : "",
      reason: body.reason,
      chargedPrice: body.chargedPrice,
      expectedChargedPrice: body.expectedChargedPrice,
      actor: access.actor,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/inventory] correction failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo guardar la corrección." }, { status: 500 });
  }
}
