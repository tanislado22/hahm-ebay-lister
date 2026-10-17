import { NextRequest, NextResponse } from "next/server";
import { ownerAccessGranted, rateLimitRequest } from "@/lib/api-guard";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import { GUATEMALA_INVENTORY_MESSAGES } from "@/lib/markets/guatemala-inventory";
import type { SaleActor } from "@/lib/markets/guatemala-inventory";
import { decideGuatemalaAccess, STAFF_COOKIE, type GuatemalaAction } from "@/lib/markets/guatemala-staff";
import { loadStaffAuth, staffCookieMaxAge } from "@/lib/markets/guatemala-staff-store";

export async function authorizeGuatemalaRequest(
  request: NextRequest,
  requestedClientId: string,
  action: GuatemalaAction
): Promise<{ ok: true; actor: SaleActor; clientId: string } | { ok: false; response: NextResponse }> {
  const limited = rateLimitRequest(request);
  if (limited) return { ok: false, response: limited };
  const token = request.cookies.get(STAFF_COOKIE)?.value;
  const loaded = await loadStaffAuth(token);
  const decision = decideGuatemalaAccess({
    owner: ownerAccessGranted(request),
    account: loaded?.account ?? null,
    session: loaded?.session ?? null,
    requestedClientId,
    action,
  });
  if (!decision.ok) {
    const code = decision.code === "ACCESS_CODE_REQUIRED" && token ? "STAFF_SESSION_ENDED" : decision.code;
    const error = code === "STAFF_SESSION_ENDED" ? "Tu sesión ya no es válida. Entra de nuevo." : decision.error;
    return {
      ok: false,
      response: NextResponse.json({ ok: false, code, error }, { status: decision.status }),
    };
  }
  if (action !== "manage" && !(await clientIsGuatemala(decision.clientId))) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: GUATEMALA_INVENTORY_MESSAGES.notGuatemala },
        { status: 403 }
      ),
    };
  }
  return decision;
}

export function withStaffCookie(response: NextResponse, token: string | null): NextResponse {
  response.cookies.set(STAFF_COOKIE, token ?? "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: token ? staffCookieMaxAge() : 0,
  });
  return response;
}
