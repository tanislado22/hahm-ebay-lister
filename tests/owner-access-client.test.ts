import { afterEach, describe, expect, it, vi } from "vitest";
import { apiPost, isAccessCodeChallenge } from "@/lib/api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("acceso del propietario", () => {
  it("solo el reto del código de acceso pide la credencial guardada", () => {
    expect(isAccessCodeChallenge(401, "ACCESS_CODE_REQUIRED")).toBe(true);
    expect(isAccessCodeChallenge(401, undefined)).toBe(false);
    expect(isAccessCodeChallenge(409, "ACCESS_CODE_REQUIRED")).toBe(false);
    expect(isAccessCodeChallenge(200, "ACCESS_CODE_REQUIRED")).toBe(false);
  });

  it("envía el acceso guardado y no lo vuelve a pedir si eBay responde 401", async () => {
    const prompt = vi.fn();
    stubBrowser(prompt, "guardado");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: "eBay no está conectado." }), { status: 401 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await apiPost("/api/ebay/relink", {});
    expect(prompt).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("x-app-secret")).toBe("guardado");
  });

  it("varias peticiones a la vez abren un solo aviso", async () => {
    const prompt = vi.fn(() => "codigo-del-propietario");
    stubBrowser(prompt, null);
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls <= 2) {
          return new Response(JSON.stringify({ ok: false, code: "ACCESS_CODE_REQUIRED" }), { status: 401 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
    );
    const [first, second] = await Promise.all([apiPost("/api/a", {}), apiPost("/api/b", {})]);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("la página principal pide el código cuando el servidor lo exige", async () => {
    const prompt = vi.fn(() => "codigo-del-propietario");
    stubBrowser(prompt, null);
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ ok: false, code: "ACCESS_CODE_REQUIRED" }), { status: 401 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
    );
    const response = await apiPost("/api/sort", {});
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });
});

function stubBrowser(prompt: ReturnType<typeof vi.fn>, stored: string | null): void {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: () => stored,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
    prompt,
  });
}
