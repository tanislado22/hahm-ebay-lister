import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { archiveAccountKey } from "@/lib/archive/workspace";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import { advanceUsaSaleSync } from "@/lib/usa-lots/sync-step";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { workMode?: unknown; clientId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const accountKey = archiveAccountKey(body.workMode, body.clientId);
  if (!accountKey) return NextResponse.json({ ok: false, error: "La cuenta no es válida." }, { status: 400 });
  if (accountKey.startsWith("client:") && (await clientIsGuatemala(accountKey.slice("client:".length)))) {
    return NextResponse.json({ ok: false, error: "El inventario de Guatemala no se sincroniza desde aquí." }, { status: 400 });
  }
  try {
    const result = await advanceUsaSaleSync(accountKey);
    return NextResponse.json(result, { status: result.ok || result.retryable ? 200 : 400 });
  } catch (error) {
    console.error("[lotes] sincronizar", error);
    return NextResponse.json({ ok: false, error: "No se pudo leer la siguiente ventana de ventas. No se modificó ningún anuncio.", retryable: true }, { status: 500 });
  }
}
