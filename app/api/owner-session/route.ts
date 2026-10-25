import { NextRequest, NextResponse } from "next/server";
import { rateLimitRequest } from "@/lib/api-guard";
import { ownerLoginBlocked, ownerLoginResult, ownerSessionProbe } from "@/lib/owner-login";
import { OWNER_COOKIE, ownerCookieOptions, ownerSessionToken } from "@/lib/owner-session";

export const dynamic = "force-dynamic";

function deploymentRequiresSecret(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function unconfigured(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: "UNCONFIGURED",
      error: "Este despliegue no tiene acceso de propietario configurado.",
    },
    { status: 503 }
  );
}

export async function GET(req: NextRequest) {
  const limited = rateLimitRequest(req);
  if (limited) return limited;
  if (!process.env.APP_SECRET) {
    return deploymentRequiresSecret() ? unconfigured() : NextResponse.json({ ok: true });
  }
  const probe = ownerSessionProbe(req.cookies.get(OWNER_COOKIE)?.value);
  if (probe.ok) return NextResponse.json({ ok: true });
  return NextResponse.json(
    {
      ok: false,
      code: probe.code,
      error:
        probe.code === "SESSION_EXPIRED"
          ? "La sesión del propietario venció."
          : "Hace falta el acceso del propietario.",
    },
    { status: 401 }
  );
}

async function submittedCode(req: NextRequest): Promise<string | null> {
  let fromBody = "";
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
    if (typeof body?.code === "string") fromBody = body.code.trim();
  }
  if (fromBody) return fromBody;
  const header = req.headers.get("x-app-secret")?.trim() ?? "";
  return header || null;
}

export async function POST(req: NextRequest) {
  const limited = rateLimitRequest(req);
  if (limited) return limited;
  if (ownerLoginBlocked(clientIp(req))) {
    return NextResponse.json(
      { ok: false, error: "Demasiados intentos. Espera un minuto y vuelve a entrar." },
      { status: 429 }
    );
  }
  if (!process.env.APP_SECRET) {
    return deploymentRequiresSecret() ? unconfigured() : NextResponse.json({ ok: true, remember: false });
  }
  const result = ownerLoginResult(await submittedCode(req), {
    appSecret: process.env.APP_SECRET,
    recoveryCode: process.env.OWNER_RECOVERY_CODE,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: result.code,
        error:
          result.code === "ACCESS_CODE_REJECTED"
            ? "Ese código no corresponde al acceso del propietario."
            : "Hace falta el acceso del propietario.",
      },
      { status: 401 }
    );
  }
  const token = ownerSessionToken();
  const response = NextResponse.json({ ok: true, remember: result.remember });
  if (token) response.cookies.set(OWNER_COOKIE, token, ownerCookieOptions());
  return response;
}
