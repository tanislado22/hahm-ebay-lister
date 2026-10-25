import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { unlinkDiscardedVintedListing } from "@/lib/vinted/inventory-store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { vintedItemId?: unknown; confirm?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "No se modificó el registro." }, { status: 400 });
  }
  if (body.confirm !== true) {
    return NextResponse.json(
      { ok: false, error: "Confirma la desvinculación antes de quitar el vínculo. No se modificó el registro." },
      { status: 400 }
    );
  }
  try {
    const result = await unlinkDiscardedVintedListing(typeof body.vintedItemId === "string" ? body.vintedItemId : "");
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[vinted/inventory/unlink]", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo desvincular la publicación. No se modificó el registro." }, { status: 500 });
  }
}
