import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { restoreArchiveToWorkspace } from "@/lib/archive/store";
import { workspaceItemHref } from "@/lib/archive/manual-sku";
import { archiveAccountKey } from "@/lib/archive/workspace";
import { clientIsGuatemala } from "@/lib/markets/client-market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { id?: unknown; workMode?: unknown; clientId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la solicitud." }, { status: 400 });
  }
  const accountKey = archiveAccountKey(body.workMode, body.clientId);
  if (!accountKey || typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ ok: false, error: "Falta el artículo o la cuenta." }, { status: 400 });
  }
  if (accountKey.startsWith("client:") && (await clientIsGuatemala(accountKey.slice("client:".length)))) {
    return NextResponse.json({ ok: false, error: "El inventario de Guatemala no se modifica desde el archivo." }, { status: 400 });
  }
  try {
    const result = await restoreArchiveToWorkspace(accountKey, body.id);
    if (!result.ok) return NextResponse.json(result, { status: 404 });
    const workMode = body.workMode === "client" ? "client" : "store";
    const clientId = workMode === "client" && typeof body.clientId === "string" ? body.clientId : null;
    return NextResponse.json({
      ok: true,
      jobId: result.jobId,
      already: result.already,
      href: workspaceItemHref(result.jobId, workMode, clientId),
      message: result.already
        ? "Ese artículo ya está en el área de trabajo."
        : "Volvió al área de trabajo con su número de anuncio y el estado de publicado.",
    });
  } catch (error) {
    console.error("[archivo] devolver", error);
    return NextResponse.json({ ok: false, error: "No se pudo devolver el artículo al área de trabajo." }, { status: 500 });
  }
}
