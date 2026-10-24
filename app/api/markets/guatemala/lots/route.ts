import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { GUATEMALA_LOT_MESSAGES } from "@/lib/markets/guatemala-lots";
import {
  addGuatemalaLotExpense,
  assignGuatemalaItemLot,
  correctGuatemalaLotExpense,
  createGuatemalaPurchaseLot,
  deleteEmptyGuatemalaPurchaseLot,
  listGuatemalaPurchaseLots,
  readGuatemalaLotSku,
  updateGuatemalaPurchaseLot,
  voidGuatemalaLotExpense,
  voidGuatemalaPurchaseLot,
} from "@/lib/markets/guatemala-lots-store";

export const dynamic = "force-dynamic";

function clientFrom(request: NextRequest, body?: { clientId?: unknown }): string {
  return body?.clientId ? String(body.clientId) : request.nextUrl.searchParams.get("clientId") ?? "";
}

export async function GET(request: NextRequest) {
  const clientId = clientFrom(request);
  const access = await authorizeGuatemalaRequest(request, clientId, "read");
  if (!access.ok) return access.response;
  try {
    const lotId = request.nextUrl.searchParams.get("skuLote");
    if (lotId) {
      const sku = await readGuatemalaLotSku(access.clientId, lotId);
      if (!sku.ok) return NextResponse.json({ ok: false, error: sku.error }, { status: sku.status });
      return NextResponse.json({ ...sku, note: GUATEMALA_LOT_MESSAGES.skuSuggested });
    }
    const result = await listGuatemalaPurchaseLots(access.clientId);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({
      ok: true,
      lots: result.lots,
      note: GUATEMALA_LOT_MESSAGES.notProfit,
      permissions: access.lotPermissions,
    });
  } catch (error) {
    console.error("[guatemala/lots] list failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudieron cargar los lotes." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer el lote." }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const accessAction =
    action === "eliminar"
      ? "lotDelete"
      : action === "corregir" || action === "corregir-gasto"
        ? "lotCorrect"
        : action === "anular" || action === "anular-gasto"
          ? "lotVoid"
          : "lotWrite";
  const access = await authorizeGuatemalaRequest(request, clientFrom(request, body), accessAction);
  if (!access.ok) return access.response;
  try {
    if (action === "crear") {
      const result = await createGuatemalaPurchaseLot({ ...body, clientId: access.clientId, actor: access.actor });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, lot: result.lot, message: GUATEMALA_LOT_MESSAGES.saved });
    }
    if (action === "gasto") {
      const result = await addGuatemalaLotExpense({
        ...body,
        clientId: access.clientId,
        lotId: String(body.lotId ?? ""),
        actor: access.actor,
      });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({ ...result, message: GUATEMALA_LOT_MESSAGES.expenseSaved });
    }
    if (action === "corregir-gasto") {
      const result = await correctGuatemalaLotExpense({
        ...body,
        clientId: access.clientId,
        expenseId: String(body.expenseId ?? ""),
        actor: access.actor,
      });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({ ...result, message: GUATEMALA_LOT_MESSAGES.expenseUpdated });
    }
    if (action === "anular-gasto") {
      const result = await voidGuatemalaLotExpense({
        clientId: access.clientId,
        expenseId: String(body.expenseId ?? ""),
        actor: access.actor,
      });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({ ...result, message: GUATEMALA_LOT_MESSAGES.expenseVoidedNotice });
    }
    if (action === "corregir") {
      const result = await updateGuatemalaPurchaseLot({
        ...body,
        clientId: access.clientId,
        lotId: String(body.lotId ?? ""),
        actor: access.actor,
      });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, lot: result.lot, message: GUATEMALA_LOT_MESSAGES.lotUpdated });
    }
    if (action === "eliminar") {
      const result = await deleteEmptyGuatemalaPurchaseLot({
        clientId: access.clientId,
        lotId: String(body.lotId ?? ""),
      });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, lotNumber: result.lotNumber, message: GUATEMALA_LOT_MESSAGES.lotDeleted });
    }
    if (action === "anular") {
      const result = await voidGuatemalaPurchaseLot({
        clientId: access.clientId,
        lotId: String(body.lotId ?? ""),
        actor: access.actor,
      });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, message: GUATEMALA_LOT_MESSAGES.lotVoided });
    }
    if (action === "asignar") {
      const result = await assignGuatemalaItemLot({
        clientId: access.clientId,
        itemId: String(body.itemId ?? ""),
        lotId: String(body.lotId ?? ""),
      });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({ ...result, message: GUATEMALA_LOT_MESSAGES.assigned });
    }
    return NextResponse.json({ ok: false, error: "No se reconoció la operación." }, { status: 400 });
  } catch (error) {
    console.error("[guatemala/lots] change failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo guardar el lote." }, { status: 500 });
  }
}
