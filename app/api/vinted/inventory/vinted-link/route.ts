import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { saveInventoryVintedLink } from "@/lib/vinted/prepare-listing-run";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { vintedItemId?: unknown; url?: unknown; confirm?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "No se guardó el enlace." }, { status: 400 });
  }
  if (body.confirm !== true) {
    return NextResponse.json(
      { ok: false, error: "Confirma el enlace antes de guardarlo. No se modificó el registro." },
      { status: 400 }
    );
  }
  try {
    const result = await saveInventoryVintedLink(
      typeof body.vintedItemId === "string" ? body.vintedItemId : "",
      body.url
    );
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, url: result.url });
  } catch (error) {
    console.error("[vinted/inventory/vinted-link]", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo guardar el enlace. No se modificó el registro." }, { status: 500 });
  }
}
