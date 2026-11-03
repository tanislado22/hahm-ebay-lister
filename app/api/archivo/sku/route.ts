import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { saveManualSku } from "@/lib/archive/store";
import { archiveAccountKey } from "@/lib/archive/workspace";
import { clientIsGuatemala } from "@/lib/markets/client-market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { id?: unknown; jobId?: unknown; ebayItemId?: unknown; sku?: unknown; workMode?: unknown; clientId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la solicitud." }, { status: 400 });
  }
  const accountKey = archiveAccountKey(body.workMode, body.clientId);
  if (!accountKey || typeof body.sku !== "string") {
    return NextResponse.json({ ok: false, error: "Falta el SKU o la cuenta." }, { status: 400 });
  }
  if (accountKey.startsWith("client:") && (await clientIsGuatemala(accountKey.slice("client:".length)))) {
    return NextResponse.json({ ok: false, error: "El inventario de Guatemala no se modifica desde el archivo." }, { status: 400 });
  }
  try {
    const result = await saveManualSku({
      accountKey,
      sku: body.sku,
      articleId: typeof body.id === "string" ? body.id : undefined,
      jobId: typeof body.jobId === "string" ? body.jobId : undefined,
      ebayItemId: typeof body.ebayItemId === "string" ? body.ebayItemId : undefined,
    });
    if (!result.ok) return NextResponse.json(result, { status: result.error.includes("no está") ? 404 : 400 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[archivo] sku", error);
    return NextResponse.json({ ok: false, error: "No se pudo guardar el SKU. No se modificó el anuncio en eBay." }, { status: 500 });
  }
}
