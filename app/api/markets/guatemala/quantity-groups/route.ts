import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { createGuatemalaQuantityGroup, listGuatemalaQuantityGroups } from "@/lib/markets/guatemala-quantity-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId") ?? "";
  const access = await authorizeGuatemalaRequest(request, clientId, "read");
  if (!access.ok) return access.response;
  try {
    const result = await listGuatemalaQuantityGroups(access.clientId);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/quantity] list failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudieron cargar los grupos." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: { clientId?: unknown; name?: unknown; lotId?: unknown; quantity?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer el grupo." }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(request, typeof body.clientId === "string" ? body.clientId : "", "sell");
  if (!access.ok) return access.response;
  try {
    const result = await createGuatemalaQuantityGroup({
      clientId: access.clientId,
      actor: access.actor,
      name: body.name,
      lotId: body.lotId,
      quantity: body.quantity,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/quantity] create failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo crear el grupo." }, { status: 500 });
  }
}
