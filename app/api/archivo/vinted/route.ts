import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { setArchiveVintedControl } from "@/lib/archive/store";
import type { VintedReviewAction } from "@/lib/archive/vinted-review";
import { archiveAccountKey } from "@/lib/archive/workspace";
import { clientIsGuatemala } from "@/lib/markets/client-market";

export const dynamic = "force-dynamic";

function actionFrom(body: { action?: unknown; url?: unknown }): VintedReviewAction | null {
  if (body.action === "link") return { type: "link", url: typeof body.url === "string" ? body.url : "" };
  if (body.action === "unlink" || body.action === "pending" || body.action === "unverified") return { type: body.action };
  return null;
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { id?: unknown; workMode?: unknown; clientId?: unknown; action?: unknown; url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la solicitud." }, { status: 400 });
  }
  const accountKey = archiveAccountKey(body.workMode, body.clientId);
  const action = actionFrom(body);
  if (!accountKey || typeof body.id !== "string" || !body.id || !action) {
    return NextResponse.json({ ok: false, error: "Falta el artículo, la cuenta o la acción de Vinted." }, { status: 400 });
  }
  if (accountKey.startsWith("client:") && (await clientIsGuatemala(accountKey.slice("client:".length)))) {
    return NextResponse.json({ ok: false, error: "El inventario y el catálogo de Guatemala no se modifican desde el archivo." }, { status: 400 });
  }
  try {
    const result = await setArchiveVintedControl(accountKey, body.id, action);
    if (!result.ok) return NextResponse.json(result, { status: result.error.includes("no está") ? 404 : 400 });
    return NextResponse.json({ ok: true, review: result.review, vintedListingUrl: result.vintedListingUrl });
  } catch (error) {
    console.error("[archivo] vinted", error);
    return NextResponse.json({ ok: false, error: "No se pudo guardar el estado de Vinted." }, { status: 500 });
  }
}
