import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { createGuatemalaExpense, queryGuatemalaExpenses } from "@/lib/markets/guatemala-expenses-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId") ?? "";
  const access = await authorizeGuatemalaRequest(request, clientId, "finance");
  if (!access.ok) return access.response;
  try {
    const result = await queryGuatemalaExpenses({
      clientId: access.clientId,
      period: request.nextUrl.searchParams.get("periodo"),
      from: request.nextUrl.searchParams.get("desde"),
      to: request.nextUrl.searchParams.get("hasta"),
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/expenses] list failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudieron cargar los gastos." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer el gasto." }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(
    request,
    typeof body.clientId === "string" ? body.clientId : "",
    "finance"
  );
  if (!access.ok) return access.response;
  try {
    const result = await createGuatemalaExpense({
      clientId: access.clientId,
      actor: access.actor,
      spentOn: body.spentOn,
      category: body.category,
      description: body.description,
      amount: body.amount,
      payee: body.payee,
      includedInGarmentCost: body.includedInGarmentCost,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/expenses] create failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo guardar el gasto." }, { status: 500 });
  }
}
