import { describe, expect, it } from "vitest";
import { applyGuatemalaSale, type SaleBook } from "@/lib/markets/guatemala-inventory";
import {
  acceptStaffPassword,
  assignedStaffClientId,
  deactivateStaffRecord,
  decideGuatemalaAccess,
  hashInviteCode,
  hashPassword,
  normalizeStaffUsername,
  reactivateStaffRecord,
  sessionStillValid,
  verifyPassword,
  type AccessAccount,
  type AccessSession,
  type StaffAccountRecord,
} from "@/lib/markets/guatemala-staff";

const NOW = new Date("2026-10-17T18:00:00.000Z");
const GUATEMALA_ID = "0d605a78-f474-49d8-a235-cca831d694be";
const OTHER_ID = "e5e689b6-563d-4c99-8a39-e82686f6c9b8";

function account(overrides: Partial<AccessAccount> = {}): AccessAccount {
  return {
    id: "cuenta-1",
    clientId: GUATEMALA_ID,
    username: "ana",
    active: true,
    sessionGeneration: 2,
    deactivatedAt: null,
    ...overrides,
  };
}

function session(overrides: Partial<AccessSession> = {}): AccessSession {
  return {
    accountId: "cuenta-1",
    sessionGeneration: 2,
    expiresAt: "2026-10-31T18:00:00.000Z",
    ...overrides,
  };
}

describe("acceso del encargado", () => {
  it("no guarda la contraseña en texto plano", async () => {
    const password = "clave-segura-15";
    const stored = await hashPassword(password);
    expect(stored).not.toContain(password);
    expect(await verifyPassword(password, stored)).toBe(true);
    expect(await verifyPassword("otra-clave-distinta", stored)).toBe(false);
    expect(normalizeStaffUsername(" Ana ")).toBe("ana");
    expect(acceptStaffPassword("corta", "ana")).toBeNull();
    expect(acceptStaffPassword("ana.tienda", "ana.tienda")).toBeNull();
    expect(acceptStaffPassword("clave-segura", "ana")).toBe("clave-segura");
  });

  it("guarda solo el hash de la invitación", () => {
    const code = "invitacion-unica-de-un-solo-uso";
    const stored = hashInviteCode(code);
    expect(stored).not.toContain(code);
    expect(stored).toHaveLength(64);
  });

  it("ata la cuenta al identificador de Tienda Guatemala y no al nombre", () => {
    expect(assignedStaffClientId(GUATEMALA_ID)).toBe(GUATEMALA_ID);
    expect(assignedStaffClientId("  ")).toBeNull();
    expect(assignedStaffClientId(null)).toBeNull();
  });

  it("atribuye la venta del panel al encargado aunque también exista el acceso del propietario", () => {
    const both = {
      owner: true,
      account: account(),
      session: session(),
      requestedClientId: GUATEMALA_ID,
      now: NOW,
    };
    const fromPanel = decideGuatemalaAccess({ ...both, staffPanel: true, action: "sell" });
    expect(fromPanel.ok && fromPanel.actor).toMatchObject({
      role: "encargado",
      accountId: "cuenta-1",
      username: "ana",
    });
    const fromOwner = decideGuatemalaAccess({ ...both, staffPanel: false, action: "sell" });
    expect(fromOwner.ok && fromOwner.actor.role).toBe("propietario");
    expect(
      decideGuatemalaAccess({ ...both, staffPanel: true, action: "write" })
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      decideGuatemalaAccess({
        owner: true,
        staffPanel: true,
        account: null,
        session: null,
        requestedClientId: GUATEMALA_ID,
        action: "sell",
        now: NOW,
      })
    ).toMatchObject({ ok: false, status: 401 });
  });

  it("deja ver y vender solo el cliente de la sesión", () => {
    const allowed = decideGuatemalaAccess({
      owner: false,
      account: account(),
      session: session(),
      requestedClientId: GUATEMALA_ID,
      action: "sell",
      now: NOW,
    });
    expect(allowed.ok && allowed.actor).toMatchObject({ role: "encargado", username: "ana" });

    const other = decideGuatemalaAccess({
      owner: false,
      account: account(),
      session: session(),
      requestedClientId: OTHER_ID,
      action: "read",
      now: NOW,
    });
    expect(other).toMatchObject({ ok: false, status: 403 });
  });

  it("niega crear prendas, administrar cuentas y el acceso del propietario", () => {
    expect(
      decideGuatemalaAccess({
        owner: false,
        account: account(),
        session: session(),
        requestedClientId: GUATEMALA_ID,
        action: "write",
        now: NOW,
      }).ok
    ).toBe(false);
    expect(
      decideGuatemalaAccess({
        owner: false,
        account: account(),
        session: session(),
        requestedClientId: GUATEMALA_ID,
        action: "manage",
        now: NOW,
      })
    ).toMatchObject({ status: 403 });
    const owner = decideGuatemalaAccess({
      owner: true,
      account: null,
      session: null,
      requestedClientId: GUATEMALA_ID,
      action: "manage",
      now: NOW,
    });
    expect(owner.ok && owner.actor.role).toBe("propietario");
  });

  it("reactiva la misma cuenta y mantiene rechazada la sesión anterior", () => {
    const original: StaffAccountRecord = {
      id: "cuenta-oseas",
      clientId: GUATEMALA_ID,
      username: "oseaspacheco",
      passwordHash: "scrypt$guardado",
      active: true,
      sessionGeneration: 2,
      deactivatedAt: null,
    };
    const oldSession = {
      accountId: original.id,
      sessionGeneration: original.sessionGeneration,
      expiresAt: "2026-10-31T18:00:00.000Z",
    };
    const deactivated = deactivateStaffRecord(original, NOW);
    expect(deactivated.id).toBe(original.id);
    expect(deactivated.username).toBe(original.username);
    expect(deactivated.passwordHash).toBe(original.passwordHash);
    expect(deactivated.sessionGeneration).toBe(3);
    expect(sessionStillValid(deactivated, oldSession, NOW)).toBe(false);

    const restored = reactivateStaffRecord(deactivated, GUATEMALA_ID);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.account.id).toBe(original.id);
    expect(restored.account.username).toBe("oseaspacheco");
    expect(restored.account.passwordHash).toBe(original.passwordHash);
    expect(restored.account.active).toBe(true);
    expect(restored.account.deactivatedAt).toBeNull();
    expect(restored.account.sessionGeneration).toBe(3);
    expect(sessionStillValid(restored.account, oldSession, NOW)).toBe(false);
    expect(
      sessionStillValid(
        restored.account,
        { ...oldSession, sessionGeneration: restored.account.sessionGeneration },
        NOW
      )
    ).toBe(true);
    expect(reactivateStaffRecord(restored.account, GUATEMALA_ID)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(reactivateStaffRecord(deactivated, OTHER_ID)).toMatchObject({ ok: false, status: 404 });
    expect(
      decideGuatemalaAccess({
        owner: false,
        account: restored.account,
        session: oldSession,
        requestedClientId: GUATEMALA_ID,
        action: "read",
        now: NOW,
      })
    ).toMatchObject({ ok: false, status: 401 });
    expect(
      decideGuatemalaAccess({
        owner: false,
        account: restored.account,
        session: oldSession,
        requestedClientId: GUATEMALA_ID,
        action: "manage",
        now: NOW,
      })
    ).toMatchObject({ ok: false, status: 401 });
    const renewed = {
      accountId: restored.account.id,
      sessionGeneration: restored.account.sessionGeneration,
      expiresAt: oldSession.expiresAt,
    };
    expect(
      decideGuatemalaAccess({
        owner: false,
        account: restored.account,
        session: renewed,
        requestedClientId: GUATEMALA_ID,
        action: "read",
        now: NOW,
      }).ok
    ).toBe(true);
    expect(
      decideGuatemalaAccess({
        owner: false,
        account: restored.account,
        session: renewed,
        requestedClientId: OTHER_ID,
        action: "read",
        now: NOW,
      })
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      decideGuatemalaAccess({
        owner: false,
        account: restored.account,
        session: renewed,
        requestedClientId: GUATEMALA_ID,
        action: "manage",
        now: NOW,
      })
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("invalida la sesión al desactivar o cambiar la generación", () => {
    const current = account();
    const open = session();
    expect(sessionStillValid(current, open, NOW)).toBe(true);
    expect(sessionStillValid({ ...current, active: false, deactivatedAt: NOW.toISOString() }, open, NOW)).toBe(false);
    expect(sessionStillValid({ ...current, sessionGeneration: 3 }, open, NOW)).toBe(false);
    const denied = decideGuatemalaAccess({
      owner: false,
      account: { ...current, sessionGeneration: 3 },
      session: open,
      requestedClientId: GUATEMALA_ID,
      action: "read",
      now: NOW,
    });
    expect(denied).toMatchObject({ ok: false, status: 401, code: "STAFF_SESSION_ENDED" });
  });

  it("registra quién vende y conserva intactas las ventas anteriores", () => {
    const previous = {
      id: "sale-3002",
      itemId: "prenda-3002",
      clientId: GUATEMALA_ID,
      sku: "3002",
      publishedPriceGtq: "30.00",
      chargedPriceGtq: "15.00",
      soldAt: "2026-10-16T18:00:00.000Z",
    };
    const book: SaleBook = {
      items: [
        {
          id: "prenda-3001",
          clientId: GUATEMALA_ID,
          sku: "3001",
          priceGtq: "40.00",
          status: "disponible",
          photos: [],
        },
        {
          id: "prenda-3002",
          clientId: GUATEMALA_ID,
          sku: "3002",
          priceGtq: "30.00",
          status: "vendida",
          photos: [],
        },
        {
          id: "prenda-nueva",
          clientId: GUATEMALA_ID,
          sku: "4100",
          priceGtq: "25.00",
          status: "disponible",
          photos: [],
        },
      ],
      sales: [previous],
    };
    const sold = applyGuatemalaSale(book, {
      clientId: GUATEMALA_ID,
      itemId: "prenda-nueva",
      chargedPrice: "18",
      clientAllowed: true,
      now: NOW,
      soldBy: { role: "encargado", accountId: "cuenta-1", username: "ana" },
    });
    expect(sold.result.ok).toBe(true);
    expect(sold.book.sales[0]).toBe(previous);
    expect(sold.book.sales[0]).not.toHaveProperty("soldByRole");
    expect(sold.book.sales[1]).toMatchObject({ sku: "4100", soldByUsername: "ana", chargedPriceGtq: "18.00" });
    expect(sold.book.items.find((item) => item.sku === "3001")?.status).toBe("disponible");
    expect(sold.book.sales.some((sale) => sale.sku === "3001" || sale.sku === "3002" && sale !== previous)).toBe(false);

    const duplicate = applyGuatemalaSale(sold.book, {
      clientId: GUATEMALA_ID,
      itemId: "prenda-nueva",
      chargedPrice: "9",
      clientAllowed: true,
      now: NOW,
      soldBy: { role: "encargado", accountId: "cuenta-1", username: "ana" },
    });
    expect(duplicate.result).toMatchObject({ ok: false, status: 409 });
    expect(duplicate.book).toBe(sold.book);
    expect(duplicate.book.sales).toHaveLength(2);
  });
});
