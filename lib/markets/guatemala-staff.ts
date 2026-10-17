import { createHash, randomBytes, scrypt, timingSafeEqual } from "crypto";
import type { SaleActor } from "@/lib/markets/guatemala-inventory";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;

function scryptKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

export const STAFF_COOKIE = "gt_encargado";
export const STAFF_SESSION_DAYS = 14;

export const GUATEMALA_STAFF_MESSAGES = {
  loginFailed: "Usuario o contraseña incorrectos.",
  sessionEnded: "Tu sesión ya no es válida. Entra de nuevo.",
  otherClient: "No puedes consultar otra tienda.",
  cannotWrite: "No puedes crear, borrar ni modificar prendas.",
  cannotManage: "No puedes administrar usuarios ni clientes.",
  signInRequired: "Se requiere iniciar sesión.",
  usernameInvalid:
    "El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.",
  passwordInvalid: "La contraseña debe tener al menos 10 caracteres y ser distinta del usuario.",
  inviteInvalid: "La invitación no es válida o ya se usó.",
  accountExists: "Ese usuario ya existe.",
  notIdentified: "Tienda Guatemala todavía no está identificada en el servidor.",
  notFound: "No se encontró esa cuenta.",
} as const;

export type GuatemalaAction = "read" | "sell" | "write" | "manage";

export interface AccessAccount {
  id: string;
  clientId: string;
  username: string;
  active: boolean;
  sessionGeneration: number;
  deactivatedAt: string | null;
}

export interface AccessSession {
  accountId: string;
  sessionGeneration: number;
  expiresAt: string;
}

export type AccessDecision =
  | { ok: true; actor: SaleActor; clientId: string }
  | { ok: false; status: 401 | 403; error: string; code: "ACCESS_CODE_REQUIRED" | "STAFF_SESSION_ENDED" | "FORBIDDEN" };

// The account is always tied to the client id already stored for the market.
// A client id sent by the browser is ignored.
export function assignedStaffClientId(boundClientId: string | null): string | null {
  const id = boundClientId?.trim() ?? "";
  return id || null;
}

export function normalizeStaffUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) return null;
  return username;
}

export function acceptStaffPassword(password: unknown, username: string): string | null {
  if (typeof password !== "string") return null;
  if (password.length < 10 || password.length > 200) return null;
  if (password.toLowerCase() === username) return null;
  return password;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptKey(password, salt, SCRYPT_KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const expected = Buffer.from(parts[5], "hex");
  if (expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = await scryptKey(password, Buffer.from(parts[4], "hex"), expected.length, {
      N: Number(parts[1]),
      r: Number(parts[2]),
      p: Number(parts[3]),
    });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function inviteCodeMatches(code: string, storedHex: string): boolean {
  const actual = Buffer.from(hashInviteCode(code), "hex");
  const expected = Buffer.from(storedHex, "hex");
  if (actual.length === 0 || actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function sessionStillValid(account: AccessAccount, session: AccessSession, now = new Date()): boolean {
  if (!account.active || account.deactivatedAt) return false;
  if (account.id !== session.accountId) return false;
  if (account.sessionGeneration !== session.sessionGeneration) return false;
  const expires = new Date(session.expiresAt).getTime();
  return Number.isFinite(expires) && expires > now.getTime();
}

export function decideGuatemalaAccess(input: {
  owner: boolean;
  account: AccessAccount | null;
  session: AccessSession | null;
  requestedClientId: string;
  action: GuatemalaAction;
  now?: Date;
}): AccessDecision {
  const ownerActor: SaleActor = { role: "propietario", accountId: null, username: null };
  const staffValid =
    input.account && input.session
      ? sessionStillValid(input.account, input.session, input.now)
      : false;

  if (input.action === "write" || input.action === "manage") {
    if (input.owner) {
      return { ok: true, actor: ownerActor, clientId: input.requestedClientId };
    }
    if (staffValid) {
      return {
        ok: false,
        status: 403,
        code: "FORBIDDEN",
        error:
          input.action === "write"
            ? GUATEMALA_STAFF_MESSAGES.cannotWrite
            : GUATEMALA_STAFF_MESSAGES.cannotManage,
      };
    }
    return {
      ok: false,
      status: 401,
      code: input.account || input.session ? "STAFF_SESSION_ENDED" : "ACCESS_CODE_REQUIRED",
      error: input.account || input.session
        ? GUATEMALA_STAFF_MESSAGES.sessionEnded
        : GUATEMALA_STAFF_MESSAGES.signInRequired,
    };
  }

  if (input.owner) {
    return { ok: true, actor: ownerActor, clientId: input.requestedClientId };
  }
  if (!staffValid || !input.account) {
    return {
      ok: false,
      status: 401,
      code: input.account || input.session ? "STAFF_SESSION_ENDED" : "ACCESS_CODE_REQUIRED",
      error: input.account || input.session
        ? GUATEMALA_STAFF_MESSAGES.sessionEnded
        : GUATEMALA_STAFF_MESSAGES.signInRequired,
    };
  }
  if (input.account.clientId !== input.requestedClientId) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: GUATEMALA_STAFF_MESSAGES.otherClient };
  }
  return {
    ok: true,
    actor: { role: "encargado", accountId: input.account.id, username: input.account.username },
    clientId: input.account.clientId,
  };
}
