import { afterEach, describe, expect, it } from "vitest";
import { ownerSessionToken, ownerSessionValid } from "@/lib/owner-session";

const ORIGINAL = process.env.APP_SECRET;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_SECRET;
  else process.env.APP_SECRET = ORIGINAL;
});

describe("sesión del propietario", () => {
  it("acepta la sesión emitida y rechaza una firma distinta o vencida", () => {
    process.env.APP_SECRET = "valor-de-prueba";
    const now = Date.parse("2026-10-24T00:00:00.000Z");
    const token = ownerSessionToken(now);
    expect(token).toBeTruthy();
    expect(ownerSessionValid(token ?? undefined, now + 1000)).toBe(true);
    expect(ownerSessionValid(token ?? undefined, now + 15 * 24 * 60 * 60 * 1000)).toBe(false);
    expect(ownerSessionValid("v1.1.firma", now)).toBe(false);
    process.env.APP_SECRET = "otro-valor";
    expect(ownerSessionValid(token ?? undefined, now + 1000)).toBe(false);
  });
});
