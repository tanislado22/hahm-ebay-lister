import { NextRequest, NextResponse } from "next/server";
import { rateLimitRequest } from "@/lib/api-guard";
import { withStaffCookie } from "@/lib/markets/guatemala-guard";
import { acceptGuatemalaInvite } from "@/lib/markets/guatemala-staff-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const limited = rateLimitRequest(request);
  if (limited) return limited;
  let body: { username?: unknown; code?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la invitación." }, { status: 400 });
  }
  try {
    const result = await acceptGuatemalaInvite(body);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return withStaffCookie(
      NextResponse.json({ ok: true, username: result.session.username }),
      result.token
    );
  } catch (error) {
    console.error("[guatemala/invitacion] failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo aceptar la invitación." }, { status: 500 });
  }
}
