import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { advanceArchiveImport } from "@/lib/archive/import-step";
import { loadImportRun } from "@/lib/archive/store";
import { configError, missingEbayConfig } from "@/lib/archive/trading-error";
import { archiveAccountKey } from "@/lib/archive/workspace";
import { requireEbayAccessToken } from "@/lib/ebay/route-access";
import { clientIsGuatemala } from "@/lib/markets/client-market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function accountOf(workMode: unknown, clientId: unknown): string | null {
  return archiveAccountKey(workMode ?? "store", clientId);
}

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const params = req.nextUrl.searchParams;
  const mode = params.get("mode") === "all" ? "all" : "sample";
  const accountKey = accountOf(params.get("workMode"), params.get("clientId"));
  if (!accountKey) return NextResponse.json({ ok: false, error: "La cuenta del archivo no es válida." }, { status: 400 });
  try {
    const run = await loadImportRun(accountKey, mode);
    if (!run) return NextResponse.json({ ok: true, status: "idle", found: 0, imported: 0, existing: 0, errors: [], notices: [], pending: 0 });
    return NextResponse.json({
      ok: true,
      status: run.status,
      found: run.found,
      imported: run.imported,
      existing: run.existing,
      errors: run.errors,
      notices: run.notices,
      pending: run.pendingIds.length,
      page: run.listPage,
      totalPages: run.totalPages,
      totalEntries: run.totalEntries,
      detail: run.detail,
    });
  } catch (error) {
    console.error("[archivo] import status", error);
    return NextResponse.json({ ok: false, error: "No se pudo leer el progreso de la importación." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { mode?: unknown; workMode?: unknown; clientId?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const mode = body.mode === "all" ? "all" : "sample";
  const workMode = body.workMode === "client" ? "client" : "store";
  const clientId = typeof body.clientId === "string" ? body.clientId : null;
  const accountKey = accountOf(workMode, clientId);
  if (!accountKey) return NextResponse.json({ ok: false, error: "La cuenta del archivo no es válida." }, { status: 400 });
  if (accountKey.startsWith("client:") && (await clientIsGuatemala(accountKey.slice("client:".length)))) {
    return NextResponse.json({ ok: false, error: "El inventario y el catálogo de Guatemala no se modifican desde el archivo." }, { status: 400 });
  }
  const missing = missingEbayConfig();
  if (missing.length) {
    return NextResponse.json(
      {
        ok: false,
        status: "error",
        error: configError(missing),
        missing,
        found: 0,
        imported: 0,
        existing: 0,
        errors: [],
      },
      { status: 503 }
    );
  }
  const token = await requireEbayAccessToken(req, { workMode, clientId });
  if (token instanceof NextResponse) {
    const payload = (await token.json()) as { error?: string };
    return NextResponse.json(
      {
        ok: false,
        status: "error",
        error: payload.error || "eBay no está conectado. Conecta la cuenta y vuelve a intentar.",
        missing: ["Cuenta de eBay conectada para esta área de trabajo"],
        found: 0,
        imported: 0,
        existing: 0,
        errors: [],
      },
      { status: token.status }
    );
  }
  try {
    const result = await advanceArchiveImport({ accessToken: token, accountKey, mode });
    return NextResponse.json(result, { status: result.ok ? 200 : result.retryable ? 200 : 502 });
  } catch (error) {
    console.error("[archivo] import", error);
    return NextResponse.json(
      {
        ok: false,
        status: "error",
        retryable: true,
        error: "La importación se interrumpió. Puedes continuarla; no se duplican los anuncios ya guardados.",
        found: 0,
        imported: 0,
        existing: 0,
        errors: [],
        missing: [],
      },
      { status: 500 }
    );
  }
}
