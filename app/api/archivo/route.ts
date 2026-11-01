import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { ARCHIVE_PAGE_SIZE, listArchivePage } from "@/lib/archive/store";
import { archiveAccountKey } from "@/lib/archive/workspace";
import { clientIsGuatemala } from "@/lib/markets/client-market";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const params = req.nextUrl.searchParams;
  const accountKey = archiveAccountKey(params.get("workMode"), params.get("clientId"));
  if (!accountKey) {
    return NextResponse.json({ ok: false, error: "La cuenta del archivo no es válida." }, { status: 400 });
  }
  if (accountKey.startsWith("client:") && (await clientIsGuatemala(accountKey.slice("client:".length)))) {
    return NextResponse.json({ ok: false, error: "El inventario de Guatemala no forma parte de este archivo." }, { status: 400 });
  }
  const page = Number(params.get("page") || "1");
  const query = params.get("q") || "";
  try {
    const result = await listArchivePage(accountKey, query, page);
    const pages = Math.max(1, Math.ceil(result.total / ARCHIVE_PAGE_SIZE));
    return NextResponse.json({
      ok: true,
      page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
      pageSize: ARCHIVE_PAGE_SIZE,
      pages,
      total: result.total,
      articles: result.articles,
    });
  } catch (error) {
    console.error("[archivo] list", error);
    return NextResponse.json({ ok: false, error: "No se pudo leer el archivo." }, { status: 500 });
  }
}
