import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { findGuatemalaScan } from "@/lib/markets/guatemala-inventory-store";
import { scanQuery } from "@/lib/markets/guatemala-qr";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId") ?? "";
  const access = await authorizeGuatemalaRequest(request, clientId, "read");
  if (!access.ok) return access.response;
  const query = scanQuery({
    codigo: request.nextUrl.searchParams.get("codigo") ?? "",
    sku: request.nextUrl.searchParams.get("sku") ?? "",
  });
  if (!query.ok) return NextResponse.json({ ok: false, error: query.error }, { status: query.status });
  try {
    const result = await findGuatemalaScan(
      access.clientId,
      query.kind === "code" ? { itemId: query.itemId } : { sku: query.sku }
    );
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/qr] lookup failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo buscar la prenda." }, { status: 500 });
  }
}
