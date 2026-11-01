// Encrypted eBay connection stored in an httpOnly cookie.
//
// We keep only the long-lived refresh token (encrypted with SESSION_SECRET).
// Short-lived access tokens are minted on demand from it, so nothing sensitive
// is exposed to the browser and there's no database to manage.

import { grantedScopesFrom, refreshAccessToken } from "./oauth";

export const EBAY_COOKIE = "ebay_conn";
export const EBAY_STATE_COOKIE = "ebay_oauth_state";
// Browsers cap persistent cookies at ~400 days; eBay refresh tokens last ~18mo.
export const EBAY_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

interface Connection {
  refreshToken: string;
  refreshExpiresAt: number; // epoch ms
  grantedScopes?: string[];
}

async function aesKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Add it in Vercel env vars.");
  }
  if (secret.length < 32) {
    // A short human-chosen passphrase would make the cookie encryption
    // brute-forceable. Require real entropy.
    throw new Error(
      'SESSION_SECRET must be at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealConnection(conn: Connection): Promise<string> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(conn));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data)
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return Buffer.from(out).toString("base64url");
}

export async function openConnection(
  sealed: string | undefined
): Promise<Connection | null> {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    const iv = raw.subarray(0, 12);
    const ct = raw.subarray(12);
    const key = await aesKey();
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    const conn = JSON.parse(new TextDecoder().decode(pt)) as Connection;
    if (!conn.refreshToken) return null;
    if (conn.refreshExpiresAt && conn.refreshExpiresAt < Date.now()) return null;
    const grantedScopes = grantedScopesFrom(conn.grantedScopes);
    return grantedScopes.length ? { ...conn, grantedScopes } : { refreshToken: conn.refreshToken, refreshExpiresAt: conn.refreshExpiresAt };
  } catch {
    return null;
  }
}

// Build a Connection from a fresh token-exchange response.
export function connectionFromToken(refreshToken: string, refreshExpiresIn?: number, scope?: unknown): Connection {
  const ttl = (refreshExpiresIn ?? 47304000) * 1000; // default ~18 months
  const grantedScopes = grantedScopesFrom(scope);
  return {
    refreshToken,
    refreshExpiresAt: Date.now() + ttl,
    ...(grantedScopes.length ? { grantedScopes } : {}),
  };
}

// Access tokens live ~2h. Minting one per publish means an extra eBay
// round-trip on every item of a batch (and risks eBay throttling the refresh
// grant), so cache them in the warm lambda keyed by refresh token.
const tokenCache = new Map<string, { token: string; grantedScopes: string[]; expiresAt: number }>();

function grantCacheKey(refreshToken: string, grantedScopes: string[]): string {
  return `${refreshToken}\n${grantedScopes.join(" ")}`;
}

// Mint a short-lived access token and return the scopes eBay actually granted.
// The application scope list is not a substitute for that response.
export async function accessGrantFromCookie(
  sealed: string | undefined
): Promise<{ token: string; grantedScopes: string[] } | null> {
  const conn = await openConnection(sealed);
  if (!conn) return null;
  const storedScopes = conn.grantedScopes ?? [];
  const key = grantCacheKey(conn.refreshToken, storedScopes);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { token: cached.token, grantedScopes: cached.grantedScopes };
  }
  const token = await refreshAccessToken(conn.refreshToken, storedScopes);
  const fromResponse = grantedScopesFrom(token.scope);
  const grantedScopes = fromResponse.length ? fromResponse : storedScopes;
  if (tokenCache.size > 100) tokenCache.clear(); // bound memory
  tokenCache.set(key, {
    token: token.access_token,
    grantedScopes,
    // Refresh 5 minutes before eBay's stated expiry.
    expiresAt: Date.now() + Math.max(60, (token.expires_in ?? 7200) - 300) * 1000,
  });
  return { token: token.access_token, grantedScopes };
}

// Mint a short-lived access token from the stored connection cookie value.
export async function accessTokenFromCookie(
  sealed: string | undefined
): Promise<string | null> {
  const grant = await accessGrantFromCookie(sealed);
  return grant?.token ?? null;
}
