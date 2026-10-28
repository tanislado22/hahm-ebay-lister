import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import {
  createGuatemalaStaff,
  deactivateGuatemalaStaff,
  inviteGuatemalaStaff,
  listGuatemalaStaff,
  reactivateGuatemalaStaff,
  setGuatemalaStaffLotPermissions,
} from "@/lib/markets/guatemala-staff-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorizeGuatemalaRequest(request, "", "manage");
  if (!access.ok) return access.response;
  try {
    const result = await listGuatemalaStaff();
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 409 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[guatemala/staff] list failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudieron cargar las cuentas." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const access = await authorizeGuatemalaRequest(request, "", "manage");
  if (!access.ok) return access.response;
  let body: {
    action?: unknown;
    username?: unknown;
    password?: unknown;
    accountId?: unknown;
    canCorrectLots?: unknown;
    canVoidLots?: unknown;
    canManageExpenses?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la cuenta." }, { status: 400 });
  }
  try {
    if (body.action === "crear") {
      const result = await createGuatemalaStaff({ username: body.username, password: body.password });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, account: result.account });
    }
    if (body.action === "invitar") {
      const result = await inviteGuatemalaStaff({ username: body.username });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({
        ok: true,
        username: result.username,
        code: result.code,
        expiresAt: result.expiresAt,
      });
    }
    if (body.action === "desactivar") {
      const result = await deactivateGuatemalaStaff(body.accountId);
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "reactivar") {
      const result = await reactivateGuatemalaStaff(body.accountId);
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, username: result.username });
    }
    if (body.action === "permisos") {
      const result = await setGuatemalaStaffLotPermissions({
        accountId: body.accountId,
        canCorrectLots: body.canCorrectLots,
        canVoidLots: body.canVoidLots,
        canManageExpenses: body.canManageExpenses,
      });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "Elige crear, invitar, desactivar o reactivar." }, { status: 400 });
  } catch (error) {
    console.error("[guatemala/staff] change failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo actualizar el acceso." }, { status: 500 });
  }
}
