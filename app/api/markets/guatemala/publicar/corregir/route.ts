import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { PUBLICATION_MESSAGES } from "@/lib/markets/guatemala-publish";
import { correctGuatemalaPublication } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await readBody(request);
  if (!body) return NextResponse.json({ ok: false, error: "No se pudo leer la prenda." }, { status: 400 });
  const access = await authorizeGuatemalaRequest(request, text(body.clientId), "publish");
  if (!access.ok) return access.response;
  const itemId = text(body.itemId);
  if (!itemId) return NextResponse.json({ ok: false, error: PUBLICATION_MESSAGES.notFound }, { status: 404 });
  try {
    const result = await correctGuatemalaPublication(access.clientId, itemId, body, access.actor);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({
      ok: true,
      already: result.already,
      message: result.message,
      item: result.item,
    });
  } catch (error) {
    console.error("[guatemala/publicar] correct failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: PUBLICATION_MESSAGES.retry }, { status: 500 });
  }
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
