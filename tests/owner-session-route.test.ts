import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/owner-session/route";
import { guardApiRequest } from "@/lib/api-guard";
import { ownerLoginResult, ownerSessionProbe, resetOwnerLoginAttempts } from "@/lib/owner-login";
import { OWNER_COOKIE, ownerSessionToken } from "@/lib/owner-session";

const ORIGINAL_SECRET = process.env.APP_SECRET;
const ORIGINAL_RECOVERY = process.env.OWNER_RECOVERY_CODE;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;
const SECRET = "codigo-local-de-prueba";
const RECOVERY = "codigo-recuperacion-local";

beforeEach(() => {
  resetOwnerLoginAttempts();
  process.env.APP_SECRET = SECRET;
  delete process.env.OWNER_RECOVERY_CODE;
});

afterEach(() => {
  restore("APP_SECRET", ORIGINAL_SECRET);
  restore("OWNER_RECOVERY_CODE", ORIGINAL_RECOVERY);
  restore("NODE_ENV", ORIGINAL_NODE_ENV);
  restore("VERCEL_ENV", ORIGINAL_VERCEL_ENV);
  resetOwnerLoginAttempts();
});

describe("sesión del propietario", () => {
  it("acepta el secreto, la recuperación y rechaza el valor de prueba", () => {
    expect(ownerLoginResult(SECRET, { appSecret: SECRET, recoveryCode: RECOVERY })).toEqual({
      ok: true,
      remember: true,
    });
    expect(ownerLoginResult(RECOVERY, { appSecret: SECRET, recoveryCode: RECOVERY })).toEqual({
      ok: true,
      remember: false,
    });
    expect(ownerLoginResult("otro", { appSecret: SECRET, recoveryCode: RECOVERY }).ok).toBe(false);
    expect(ownerLoginResult("prueba-sesion", { appSecret: "prueba-sesion", recoveryCode: "prueba-sesion" })).toEqual({
      ok: false,
      code: "ACCESS_CODE_REJECTED",
    });
    expect(ownerLoginResult("  ", { appSecret: SECRET, recoveryCode: null })).toEqual({
      ok: false,
      code: "ACCESS_CODE_REQUIRED",
    });
  });

  it("distingue una sesión ausente de una vencida", () => {
    const now = Date.parse("2026-10-24T00:00:00.000Z");
    const token = ownerSessionToken(now);
    expect(ownerSessionProbe(undefined, now)).toEqual({ ok: false, code: "ACCESS_CODE_REQUIRED" });
    expect(ownerSessionProbe(token ?? undefined, now + 1000)).toEqual({ ok: true });
    expect(ownerSessionProbe(token ?? undefined, now + 15 * 24 * 60 * 60 * 1000)).toEqual({
      ok: false,
      code: "SESSION_EXPIRED",
    });
  });

  it("abre la cookie solo con una credencial válida y protege el endpoint", async () => {
    const missing = await POST(jsonRequest({}));
    expect(missing.status).toBe(401);
    expect(await bodyOf(missing)).toMatchObject({ code: "ACCESS_CODE_REQUIRED" });
    expect(missing.headers.get("set-cookie")).toBeNull();

    const rejected = await POST(jsonRequest({ code: "prueba-sesion" }));
    expect(rejected.status).toBe(401);
    expect(await bodyOf(rejected)).toMatchObject({ code: "ACCESS_CODE_REJECTED" });
    expect(rejected.headers.get("set-cookie")).toBeNull();

    const wrong = await POST(jsonRequest({ code: "no-es-el-codigo" }));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();

    process.env.OWNER_RECOVERY_CODE = RECOVERY;
    const recovered = await POST(jsonRequest({ code: RECOVERY }));
    expect(recovered.status).toBe(200);
    expect(await bodyOf(recovered)).toEqual({ ok: true, remember: false });
    const recoveredCookie = cookieValue(recovered);
    expect(recoveredCookie).toBeTruthy();

    const headerLogin = await POST(
      new NextRequest("http://localhost/api/owner-session", {
        method: "POST",
        headers: { "x-app-secret": SECRET, "x-forwarded-for": "203.0.113.20" },
      })
    );
    expect(headerLogin.status).toBe(200);
    expect((await bodyOf(headerLogin)).remember).toBe(true);
    const token = cookieValue(headerLogin);
    expect(token).toBeTruthy();

    const probe = await GET(
      new NextRequest("http://localhost/api/owner-session", {
        headers: { cookie: `${OWNER_COOKIE}=${token}` },
      })
    );
    expect(probe.status).toBe(200);

    const expiredToken = ownerSessionToken(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const expired = await GET(
      new NextRequest("http://localhost/api/owner-session", {
        headers: { cookie: `${OWNER_COOKIE}=${expiredToken}` },
      })
    );
    expect(expired.status).toBe(401);
    expect(await bodyOf(expired)).toMatchObject({ code: "SESSION_EXPIRED" });

    expect(
      guardApiRequest(
        new NextRequest("http://localhost/api/ebay/relink", {
          method: "POST",
          headers: { cookie: `${OWNER_COOKIE}=${token}` },
        })
      )
    ).toBeNull();
    expect(
      guardApiRequest(
        new NextRequest("http://localhost/api/ebay/relink", {
          method: "POST",
          headers: { "x-app-secret": "prueba-sesion" },
        })
      )?.status
    ).toBe(401);
    expect(
      guardApiRequest(
        new NextRequest("http://localhost/api/ebay/relink", {
          method: "POST",
          headers: { "x-app-secret": RECOVERY },
        })
      )?.status
    ).toBe(401);
    expect(
      guardApiRequest(
        new NextRequest("http://localhost/api/ebay/relink", {
          method: "POST",
          headers: { cookie: `${OWNER_COOKIE}=${recoveredCookie}`, "x-app-secret": RECOVERY },
        })
      )
    ).toBeNull();
  });

  it("bloquea los intentos seguidos sin abrir la sesión", async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await POST(jsonRequest({ code: "incorrecto" }, "203.0.113.30"));
      expect(response.status).toBe(401);
    }
    const blocked = await POST(jsonRequest({ code: SECRET }, "203.0.113.30"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("set-cookie")).toBeNull();
  });
});

function jsonRequest(body: unknown, ip = "203.0.113.10"): NextRequest {
  return new NextRequest("http://localhost/api/owner-session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

async function bodyOf(response: Response): Promise<{ code?: string; remember?: boolean }> {
  return (await response.json()) as { code?: string; remember?: boolean };
}

function cookieValue(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.match(new RegExp(`${OWNER_COOKIE}=([^;]+)`))?.[1] ?? "";
}

function restore(name: "APP_SECRET" | "OWNER_RECOVERY_CODE" | "NODE_ENV" | "VERCEL_ENV", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
