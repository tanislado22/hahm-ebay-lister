import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { OWNER_COOKIE, ownerCookieOptions, ownerSessionToken } from "@/lib/owner-session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const token = ownerSessionToken();
  const response = NextResponse.json({ ok: true });
  if (token) response.cookies.set(OWNER_COOKIE, token, ownerCookieOptions());
  return response;
}
