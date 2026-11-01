import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { getArchiveDetail } from "@/lib/archive/store";
import { plainDescription } from "@/lib/archive/text";
import { archiveAccountKey } from "@/lib/archive/workspace";
import { clientIsGuatemala } from "@/lib/markets/client-market";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const accountKey = archiveAccountKey(req.nextUrl.searchParams.get("workMode"), req.nextUrl.searchParams.get("clientId"));
  if (!accountKey) return NextResponse.json({ ok: false, error: "La cuenta del archivo no es válida." }, { status: 400 });
  if (accountKey.startsWith("client:") && (await clientIsGuatemala(accountKey.slice("client:".length)))) {
    return NextResponse.json({ ok: false, error: "El inventario de Guatemala no forma parte de este archivo." }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    const article = await getArchiveDetail(accountKey, id);
    if (!article) return NextResponse.json({ ok: false, error: "Ese artículo no está en el archivo." }, { status: 404 });
    return NextResponse.json({ ok: true, article: { ...article, plainDescription: plainDescription(article.description) } });
  } catch (error) {
    console.error("[archivo] detail", error);
    return NextResponse.json({ ok: false, error: "No se pudo abrir el artículo." }, { status: 500 });
  }
}
