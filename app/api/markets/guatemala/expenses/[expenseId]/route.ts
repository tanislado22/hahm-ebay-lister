import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { updateGuatemalaExpense } from "@/lib/markets/guatemala-expenses-store";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ expenseId: string }> }
) {
  const { expenseId } = await context.params;
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
    const result = await updateGuatemalaExpense({
      clientId: access.clientId,
      expenseId,
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
    console.error("[guatemala/expenses] update failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo guardar el gasto." }, { status: 500 });
  }
}
