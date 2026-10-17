import { NextRequest, NextResponse } from "next/server";
import { rateLimitRequest } from "@/lib/api-guard";
import { withStaffCookie } from "@/lib/markets/guatemala-guard";
import { STAFF_COOKIE } from "@/lib/markets/guatemala-staff";
import { GUATEMALA_STAFF_MESSAGES } from "@/lib/markets/guatemala-staff";
import { loginGuatemalaStaff, revokeStaffToken, staffSessionFromToken } from "@/lib/markets/guatemala-staff-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = rateLimitRequest(request);
  if (limited) return limited;
  try {
    const session = await staffSessionFromToken(request.cookies.get(STAFF_COOKIE)?.value);
    if (!session) {
      return NextResponse.json(
        { ok: false, code: "STAFF_SESSION_ENDED", error: GUATEMALA_STAFF_MESSAGES.sessionEnded },
        { status: 401 }
      );
    }
    return NextResponse.json({ ok: true, username: session.username });
  } catch (error) {
    console.error("[guatemala/sesion] read failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo comprobar la sesión." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const limited = rateLimitRequest(request);
  if (limited) return limited;
  let body: { username?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: GUATEMALA_STAFF_MESSAGES.loginFailed }, { status: 400 });
  }
  try {
    const result = await loginGuatemalaStaff(body);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
    }
    return withStaffCookie(
      NextResponse.json({ ok: true, username: result.session.username }),
      result.token
    );
  } catch (error) {
    console.error("[guatemala/sesion] login failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo iniciar la sesión." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(STAFF_COOKIE)?.value;
  try {
    await revokeStaffToken(token);
  } catch (error) {
    console.error("[guatemala/sesion] logout failed", error instanceof Error ? error.name : "Error");
  }
  return withStaffCookie(NextResponse.json({ ok: true }), null);
}
