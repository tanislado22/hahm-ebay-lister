import crypto from "crypto";

export const OWNER_COOKIE = "owner_access";
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function ownerSessionToken(now = Date.now()): string | null {
  const secret = process.env.APP_SECRET;
  if (!secret) return null;
  const payload = `v1.${now + MAX_AGE_MS}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function ownerSessionValid(token: string | undefined, now = Date.now()): boolean {
  const secret = process.env.APP_SECRET;
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp <= now) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  const received = Buffer.from(parts[2]);
  const wanted = Buffer.from(expected);
  if (received.length !== wanted.length) return false;
  return crypto.timingSafeEqual(received, wanted);
}

export function ownerCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(MAX_AGE_MS / 1000),
  };
}
