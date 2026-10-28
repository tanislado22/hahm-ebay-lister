import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { GUATEMALA_RECOVERY_MESSAGES } from "@/lib/markets/guatemala-recoveries";
import { createGuatemalaRecovery, queryGuatemalaRecovery } from "@/lib/markets/guatemala-expenses-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorizeGuatemalaRequest(request, request.nextUrl.searchParams.get("clientId") ?? "", "finance");
  if (!access.ok) return access.response;
  try {
    const result = await queryGuatemalaRecovery({ clientId: access.clientId });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/recoveries] list failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: GUATEMALA_RECOVERY_MESSAGES.loadFailed }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ ok: false, error: GUATEMALA_RECOVERY_MESSAGES.retry }, { status: 400 });
  }
  const access = await authorizeGuatemalaRequest(request, typeof body.clientId === "string" ? body.clientId : "", "finance");
  if (!access.ok) return access.response;
  try {
    const result = await createGuatemalaRecovery({
      clientId: access.clientId,
      actor: access.actor,
      recoveredOn: body.recoveredOn,
      description: body.description,
      amount: body.amount,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/recoveries] create failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: GUATEMALA_RECOVERY_MESSAGES.retry }, { status: 500 });
  }
}
