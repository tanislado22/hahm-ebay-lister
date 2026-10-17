import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { GUATEMALA_PURGE_MESSAGES, purgeConfirmText, purgeCounts } from "@/lib/markets/guatemala-purge";
import { confirmGuatemalaPurge, listGuatemalaPurgePlan } from "@/lib/markets/guatemala-inventory-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: {
    clientId?: unknown;
    action?: unknown;
    itemIds?: unknown;
    confirmText?: unknown;
    expected?: { garments?: unknown; photos?: unknown; sales?: unknown; corrections?: unknown };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la solicitud." }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(
    request,
    typeof body.clientId === "string" ? body.clientId : "",
    "purge"
  );
  if (!access.ok) return access.response;
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((id): id is string => typeof id === "string") : [];
  try {
    if (body.action === "revisar") {
      const plan = await listGuatemalaPurgePlan(access.clientId);
      if (!plan.ok) return NextResponse.json({ ok: false, error: plan.error }, { status: plan.status });
      const selected = itemIds.length
        ? plan.garments.filter((garment) => itemIds.includes(garment.id))
        : plan.garments;
      if (itemIds.length && selected.length !== new Set(itemIds).size) {
        return NextResponse.json({ ok: false, error: GUATEMALA_PURGE_MESSAGES.notFound }, { status: 404 });
      }
      return NextResponse.json({
        ok: true,
        garments: selected,
        confirmText: itemIds.length ? purgeConfirmText(selected) : "",
        counts: purgeCounts(selected),
      });
    }
    if (body.action !== "confirmar") {
      return NextResponse.json({ ok: false, error: "Elige revisar o confirmar." }, { status: 400 });
    }
    const expected = {
      garments: Number(body.expected?.garments),
      photos: Number(body.expected?.photos),
      sales: Number(body.expected?.sales),
      corrections: Number(body.expected?.corrections),
    };
    const result = await confirmGuatemalaPurge({
      clientId: access.clientId,
      itemIds,
      confirmText: typeof body.confirmText === "string" ? body.confirmText : "",
      expected,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, garments: result.garments },
        { status: result.status }
      );
    }
    return NextResponse.json({ ok: true, removed: result.removed });
  } catch (error) {
    console.error("[guatemala/inventory] purge failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo preparar la eliminación." }, { status: 500 });
  }
}
