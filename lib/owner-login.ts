import crypto from "crypto";
import { REJECTED_OWNER_CODE } from "@/lib/owner-code";
import { ownerSessionValid } from "@/lib/owner-session";

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 8;
const MAX_CODE_LENGTH = 200;

const loginAttempts = new Map<string, number[]>();

export type OwnerLoginResult =
  | { ok: true; remember: boolean }
  | { ok: false; code: "ACCESS_CODE_REQUIRED" | "ACCESS_CODE_REJECTED" };

export type OwnerSessionProbe =
  | { ok: true }
  | { ok: false; code: "ACCESS_CODE_REQUIRED" | "SESSION_EXPIRED" };

export function resetOwnerLoginAttempts(): void {
  loginAttempts.clear();
}

/** Cuenta intentos de entrada por dirección. No registra el código. */
export function ownerLoginBlocked(ip: string, now = Date.now()): boolean {
  const recent = (loginAttempts.get(ip) ?? []).filter((at) => at > now - LOGIN_WINDOW_MS);
  if (recent.length >= LOGIN_MAX_ATTEMPTS) {
    loginAttempts.set(ip, recent);
    return true;
  }
  recent.push(now);
  loginAttempts.set(ip, recent);
  if (loginAttempts.size > 5000) loginAttempts.clear();
  return false;
}

function sameSecret(provided: string, expected: string): boolean {
  const received = crypto.createHash("sha256").update(provided).digest();
  const wanted = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(received, wanted);
}

/**
 * El código de acceso es APP_SECRET. OWNER_RECOVERY_CODE, si existe, abre la
 * misma sesión sin sustituir ese secreto y sin quedar guardado en el navegador.
 */
export function ownerLoginResult(
  provided: string | null | undefined,
  env: { appSecret?: string | null; recoveryCode?: string | null }
): OwnerLoginResult {
  const secret = env.appSecret ?? "";
  if (!secret) return { ok: false, code: "ACCESS_CODE_REQUIRED" };
  const code = provided?.trim() ?? "";
  if (!code) return { ok: false, code: "ACCESS_CODE_REQUIRED" };
  if (code === REJECTED_OWNER_CODE || code.length > MAX_CODE_LENGTH) {
    return { ok: false, code: "ACCESS_CODE_REJECTED" };
  }
  if (sameSecret(code, secret)) return { ok: true, remember: true };
  const recovery = env.recoveryCode?.trim() ?? "";
  if (recovery && recovery !== REJECTED_OWNER_CODE && sameSecret(code, recovery)) {
    return { ok: true, remember: false };
  }
  return { ok: false, code: "ACCESS_CODE_REJECTED" };
}

export function ownerSessionProbe(cookie: string | undefined, now = Date.now()): OwnerSessionProbe {
  if (!cookie) return { ok: false, code: "ACCESS_CODE_REQUIRED" };
  if (!ownerSessionValid(cookie, now)) return { ok: false, code: "SESSION_EXPIRED" };
  return { ok: true };
}
