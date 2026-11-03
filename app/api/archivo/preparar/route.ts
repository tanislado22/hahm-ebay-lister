import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { prepareArchivedArticle } from "@/lib/archive/store";
import { VINTED_REVIEW_LABEL } from "@/lib/archive/vinted-review";
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
    return NextResponse.json({ ok: false, error: "El inventario y el catálogo de Guatemala no se modifican desde el archivo." }, { status: 400 });
  }
  try {
    const result = await prepareArchivedArticle(accountKey, body.id);
    if (!result.ok) return NextResponse.json(result, { status: result.error.includes("no está") ? 404 : 400 });
    const place = result.already
      ? "Ya estaba en el área de trabajo y no se duplicó."
      : "Volvió al área de trabajo con el mismo identificador y sigue publicado.";
    return NextResponse.json({
      ok: true,
      jobId: result.jobId,
      sku: result.sku,
      review: result.review,
      queueHref: "/vinted",
      message: `${place} Quedó preparado para Vinted con el SKU ${result.sku}. No se publicó en Vinted y sigue como “${VINTED_REVIEW_LABEL[result.review]}”. El vínculo se guarda cuando pegues el enlace del anuncio.`,
    });
  } catch (error) {
    console.error("[archivo] preparar", error);
    return NextResponse.json({ ok: false, error: "No se pudo preparar el artículo para Vinted. No se publicó en Vinted." }, { status: 500 });
  }
}
