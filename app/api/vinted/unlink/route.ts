import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { unlinkVintedListing } from "@/lib/inventory/links";
import { workspaceKey } from "@/lib/inventory/workspace";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: { workMode?: string; clientId?: string | null; sku?: string; groupId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la solicitud." }, { status: 400 });
  }

  const workspace = workspaceKey(body.workMode, body.clientId);
  const sku = body.sku?.trim() ?? "";
  if (!workspace || !sku) {
    return NextResponse.json({ ok: false, error: "Falta el artículo para desvincular." }, { status: 400 });
  }

  try {
    const updated = await unlinkVintedListing({
      workspaceKey: workspace,
      sku,
      groupId: typeof body.groupId === "string" ? body.groupId : null,
    });
    if (!updated) {
      return NextResponse.json({ ok: false, error: "No se encontró el vínculo de Vinted de este artículo." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, vintedStatus: "not_prepared" });
  } catch (error) {
    console.error("[vinted/unlink]", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo desvincular el artículo." }, { status: 500 });
  }
}
