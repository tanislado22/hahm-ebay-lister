import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { deleteGuatemalaExpense } from "@/lib/markets/guatemala-expenses-store";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ expenseId: string }> }
) {
  const { expenseId } = await context.params;
  let body: { clientId?: unknown };
  try {
    body = (await request.json()) as { clientId?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer el gasto." }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(
    request,
    typeof body?.clientId === "string" ? body.clientId : "",
    "sell"
  );
  if (!access.ok) return access.response;
  try {
    const result = await deleteGuatemalaExpense({ clientId: access.clientId, expenseId });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/expenses] delete failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo eliminar el gasto." }, { status: 500 });
  }
}
