import { afterEach, describe, expect, it, vi } from "vitest";
import { apiPost, isAccessCodeChallenge, readAccessCode, rememberAccessCode } from "@/lib/api-client";
import { isOwnerAccessFailure, ownerAccessMessage } from "@/lib/owner-access-messages";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("acceso del propietario", () => {
  it("solo el reto del código de acceso pide la credencial guardada", () => {
    expect(isAccessCodeChallenge(401, "ACCESS_CODE_REQUIRED")).toBe(true);
    expect(isAccessCodeChallenge(401, undefined)).toBe(false);
    expect(isAccessCodeChallenge(409, "ACCESS_CODE_REQUIRED")).toBe(false);
    expect(isAccessCodeChallenge(200, "ACCESS_CODE_REQUIRED")).toBe(false);
    expect(isOwnerAccessFailure(401, "ACCESS_CODE_REQUIRED")).toBe(true);
    expect(isOwnerAccessFailure(401, "SESSION_EXPIRED")).toBe(true);
    expect(isOwnerAccessFailure(409, "EBAY_DISCONNECTED")).toBe(false);
    expect(isOwnerAccessFailure(409, "RELINK_IN_PROGRESS")).toBe(false);
    expect(ownerAccessMessage(401, "SESSION_EXPIRED")).toContain("venció");
    expect(ownerAccessMessage(401, "ACCESS_CODE_REJECTED")).toContain("no corresponde");
  });

  it("envía el acceso guardado y no abre un aviso si eBay responde 401", async () => {
    const prompt = vi.fn();
    stubBrowser(prompt, "guardado");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: "eBay no está conectado." }), { status: 401 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await apiPost("/api/ebay/relink", {});
    expect(prompt).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("x-app-secret")).toBe("guardado");
  });

  it("varias respuestas 401 no abren avisos ni se reintentan", async () => {
    const prompt = vi.fn();
    stubBrowser(prompt, null);
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: false, code: "ACCESS_CODE_REQUIRED" }), { status: 401 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const [first, second] = await Promise.all([apiPost("/api/a", {}), apiPost("/api/b", {})]);
    expect(prompt).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
  });

  it("no envía ni guarda el valor de prueba", () => {
    const prompt = vi.fn();
    const store = stubBrowser(prompt, "prueba-sesion");
    expect(readAccessCode()).toBeNull();
    rememberAccessCode("  prueba-sesion  ");
    expect(store.get("listing-writer:access-code")).toBe("prueba-sesion");
    rememberAccessCode("codigo-real");
    expect(store.get("listing-writer:access-code")).toBe("codigo-real");
    expect(readAccessCode()).toBe("codigo-real");
    expect(prompt).not.toHaveBeenCalled();
  });
});

function stubBrowser(prompt: ReturnType<typeof vi.fn>, stored: string | null): Map<string, string> {
  const store = new Map<string, string>();
  if (stored) store.set("listing-writer:access-code", stored);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
    prompt,
  });
  return store;
}
