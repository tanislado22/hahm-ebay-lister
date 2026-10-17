import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { listGuatemalaSalesReport } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId") ?? "";
  const access = await authorizeGuatemalaRequest(request, clientId, "read");
  if (!access.ok) return access.response;
  const period = request.nextUrl.searchParams.get("periodo");
  const from = request.nextUrl.searchParams.get("desde");
  const to = request.nextUrl.searchParams.get("hasta");
  const includeTests = request.nextUrl.searchParams.get("incluirPruebas") === "1";
  try {
    const result = await listGuatemalaSalesReport({
      clientId: access.clientId,
      period,
      from,
      to,
      includeTests,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/reports] failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json(
      { ok: false, error: "No se pudieron cargar los reportes de ventas." },
      { status: 500 }
    );
  }
}
