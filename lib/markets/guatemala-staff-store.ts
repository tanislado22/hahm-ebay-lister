import { getSql } from "@/lib/db";
import { boundGuatemalaClientId } from "@/lib/markets/client-market";
import {
  acceptStaffPassword,
  assignedStaffClientId,
  GUATEMALA_STAFF_MESSAGES,
  hashInviteCode,
  hashPassword,
  newOpaqueToken,
  normalizeStaffUsername,
  STAFF_SESSION_DAYS,
  tokenHash,
  verifyPassword,
  type AccessAccount,
  type AccessSession,
} from "@/lib/markets/guatemala-staff";

export interface StaffAccountView {
  id: string;
  username: string;
  status: "activo" | "pendiente" | "desactivado";
  createdAt: string;
  deactivatedAt: string | null;
  canCorrectLots: boolean;
  canVoidLots: boolean;
  canManageExpenses: boolean;
}

export interface StaffSessionView {
  accountId: string;
  clientId: string;
  username: string;
  canManageExpenses: boolean;
}

interface LoadedAuth {
  account: AccessAccount;
  session: AccessSession;
}

let ensuring: Promise<void> | null = null;

export function ensureGuatemalaStaffTables(): Promise<void> {
  if (!ensuring) {
    ensuring = createTables().catch((error) => {
      ensuring = null;
      throw error;
    });
  }
  return ensuring;
}

async function createTables(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_staff_accounts (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      session_generation INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deactivated_at TIMESTAMPTZ,
      can_correct_lots BOOLEAN NOT NULL DEFAULT FALSE,
      can_void_lots BOOLEAN NOT NULL DEFAULT FALSE
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_staff_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      session_generation INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_staff_invites (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE guatemala_staff_accounts
    ADD COLUMN IF NOT EXISTS can_correct_lots BOOLEAN NOT NULL DEFAULT FALSE
  `;
  await sql`
    ALTER TABLE guatemala_staff_accounts
    ADD COLUMN IF NOT EXISTS can_void_lots BOOLEAN NOT NULL DEFAULT FALSE
  `;
  await sql`
    ALTER TABLE guatemala_staff_accounts
    ADD COLUMN IF NOT EXISTS can_manage_expenses BOOLEAN NOT NULL DEFAULT FALSE
  `;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? String(value ?? "") : parsed.toISOString();
}

function flag(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

function accountStatus(row: Record<string, unknown>): StaffAccountView["status"] {
  if (row.deactivated_at) return "desactivado";
  if (!flag(row.active) || !row.password_hash) return "pendiente";
  return "activo";
}

async function requireBoundClient(): Promise<{ ok: true; clientId: string } | { ok: false; error: string }> {
  const clientId = assignedStaffClientId(await boundGuatemalaClientId());
  if (!clientId) return { ok: false, error: GUATEMALA_STAFF_MESSAGES.notIdentified };
  return { ok: true, clientId };
}

export async function listGuatemalaStaff(): Promise<
  { ok: true; accounts: StaffAccountView[] } | { ok: false; error: string }
> {
  const bound = await requireBoundClient();
  if (!bound.ok) return bound;
  await ensureGuatemalaStaffTables();
  const sql = getSql();
  const rows = await sql`
    SELECT id, username, active, password_hash, created_at, deactivated_at,
      can_correct_lots, can_void_lots, can_manage_expenses
    FROM guatemala_staff_accounts
    WHERE client_id = ${bound.clientId}
    ORDER BY created_at DESC
  `;
  return {
    ok: true,
    accounts: rows.map((row) => ({
      id: String(row.id),
      username: String(row.username),
      status: accountStatus(row),
      createdAt: iso(row.created_at),
      deactivatedAt: row.deactivated_at ? iso(row.deactivated_at) : null,
      canCorrectLots: flag(row.can_correct_lots),
      canVoidLots: flag(row.can_void_lots),
      canManageExpenses: flag(row.can_manage_expenses),
    })),
  };
}

export async function createGuatemalaStaff(input: {
  username: unknown;
  password: unknown;
}): Promise<{ ok: true; account: StaffAccountView } | { ok: false; status: 400 | 409; error: string }> {
  const username = normalizeStaffUsername(input.username);
  if (!username) return { ok: false, status: 400, error: GUATEMALA_STAFF_MESSAGES.usernameInvalid };
  const password = acceptStaffPassword(input.password, username);
  if (!password) return { ok: false, status: 400, error: GUATEMALA_STAFF_MESSAGES.passwordInvalid };
  const bound = await requireBoundClient();
  if (!bound.ok) return { ok: false, status: 409, error: bound.error };
  await ensureGuatemalaStaffTables();
  const sql = getSql();
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const rows = await sql`
    INSERT INTO guatemala_staff_accounts (
      id, client_id, username, password_hash, active
    )
    VALUES (${id}, ${bound.clientId}, ${username}, ${passwordHash}, TRUE)
    ON CONFLICT (username) DO NOTHING
    RETURNING id, username, active, password_hash, created_at, deactivated_at
  `;
  const row = rows[0];
  if (!row) return { ok: false, status: 409, error: GUATEMALA_STAFF_MESSAGES.accountExists };
  return {
    ok: true,
    account: {
      id: String(row.id),
      username: String(row.username),
      status: "activo",
      createdAt: iso(row.created_at),
      deactivatedAt: null,
      canCorrectLots: false,
      canVoidLots: false,
      canManageExpenses: false,
    },
  };
}

export async function inviteGuatemalaStaff(input: {
  username: unknown;
  now?: Date;
}): Promise<
  | { ok: true; username: string; code: string; expiresAt: string }
  | { ok: false; status: 400 | 409; error: string }
> {
  const username = normalizeStaffUsername(input.username);
  if (!username) return { ok: false, status: 400, error: GUATEMALA_STAFF_MESSAGES.usernameInvalid };
  const bound = await requireBoundClient();
  if (!bound.ok) return { ok: false, status: 409, error: bound.error };
  await ensureGuatemalaStaffTables();
  const sql = getSql();
  const id = crypto.randomUUID();
  const created = await sql`
    INSERT INTO guatemala_staff_accounts (id, client_id, username, active)
    VALUES (${id}, ${bound.clientId}, ${username}, FALSE)
    ON CONFLICT (username) DO NOTHING
    RETURNING id
  `;
  if (!created[0]) return { ok: false, status: 409, error: GUATEMALA_STAFF_MESSAGES.accountExists };
  const code = newOpaqueToken();
  const expires = new Date((input.now ?? new Date()).getTime() + 48 * 60 * 60 * 1000);
  await sql`
    INSERT INTO guatemala_staff_invites (id, account_id, code_hash, expires_at)
    VALUES (${crypto.randomUUID()}, ${id}, ${hashInviteCode(code)}, ${expires.toISOString()})
  `;
  return { ok: true, username, code, expiresAt: expires.toISOString() };
}

export async function acceptGuatemalaInvite(input: {
  username?: unknown;
  code?: unknown;
  password?: unknown;
}): Promise<{ ok: true; token: string; session: StaffSessionView } | { ok: false; status: 400; error: string }> {
  const username = normalizeStaffUsername(input.username);
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!username || code.length < 20) {
    return { ok: false, status: 400, error: GUATEMALA_STAFF_MESSAGES.inviteInvalid };
  }
  const password = acceptStaffPassword(input.password, username);
  if (!password) return { ok: false, status: 400, error: GUATEMALA_STAFF_MESSAGES.passwordInvalid };
  await ensureGuatemalaStaffTables();
  const sql = getSql();
  const accounts = await sql`
    SELECT id, client_id, username, session_generation, deactivated_at
    FROM guatemala_staff_accounts
    WHERE username = ${username}
    LIMIT 1
  `;
  const account = accounts[0];
  if (!account || account.deactivated_at) {
    return { ok: false, status: 400, error: GUATEMALA_STAFF_MESSAGES.inviteInvalid };
  }
  const passwordHash = await hashPassword(password);
  const codeHash = hashInviteCode(code);
  const saved = await sql`
    WITH used AS (
      UPDATE guatemala_staff_invites
      SET used_at = NOW()
      WHERE account_id = ${String(account.id)}
        AND used_at IS NULL
        AND expires_at > NOW()
        AND code_hash = ${codeHash}
      RETURNING account_id
    )
    UPDATE guatemala_staff_accounts AS staff
    SET password_hash = ${passwordHash}, active = TRUE
    FROM used
    WHERE staff.id = used.account_id
      AND staff.deactivated_at IS NULL
    RETURNING staff.id, staff.client_id, staff.username, staff.session_generation
  `;
  const row = saved[0];
  if (!row) return { ok: false, status: 400, error: GUATEMALA_STAFF_MESSAGES.inviteInvalid };
  return openSession(row);
}

export async function deactivateGuatemalaStaff(
  accountId: unknown
): Promise<{ ok: true } | { ok: false; status: 404 | 409; error: string }> {
  const id = typeof accountId === "string" ? accountId.trim() : "";
  if (!id) return { ok: false, status: 404, error: GUATEMALA_STAFF_MESSAGES.notFound };
  const bound = await requireBoundClient();
  if (!bound.ok) return { ok: false, status: 409, error: bound.error };
  await ensureGuatemalaStaffTables();
  const sql = getSql();
  const rows = await sql`
    UPDATE guatemala_staff_accounts
    SET active = FALSE,
      deactivated_at = NOW(),
      session_generation = session_generation + 1
    WHERE id = ${id} AND client_id = ${bound.clientId}
    RETURNING id
  `;
  if (!rows[0]) return { ok: false, status: 404, error: GUATEMALA_STAFF_MESSAGES.notFound };
  await sql`DELETE FROM guatemala_staff_sessions WHERE account_id = ${id}`;
  await sql`
    UPDATE guatemala_staff_invites
    SET used_at = COALESCE(used_at, NOW())
    WHERE account_id = ${id} AND used_at IS NULL
  `;
  return { ok: true };
}

export async function reactivateGuatemalaStaff(
  accountId: unknown
): Promise<{ ok: true; username: string } | { ok: false; status: 404 | 409; error: string }> {
  const id = typeof accountId === "string" ? accountId.trim() : "";
  if (!id) return { ok: false, status: 404, error: GUATEMALA_STAFF_MESSAGES.notFound };
  const bound = await requireBoundClient();
  if (!bound.ok) return { ok: false, status: 409, error: bound.error };
  await ensureGuatemalaStaffTables();
  const sql = getSql();
  const rows = await sql`
    UPDATE guatemala_staff_accounts
    SET active = TRUE,
      deactivated_at = NULL
    WHERE id = ${id}
      AND client_id = ${bound.clientId}
      AND deactivated_at IS NOT NULL
      AND password_hash IS NOT NULL
    RETURNING username
  `;
  const reactivated = rows[0];
  if (reactivated) return { ok: true, username: String(reactivated.username) };
  const existing = await sql`
    SELECT deactivated_at, password_hash
    FROM guatemala_staff_accounts
    WHERE id = ${id} AND client_id = ${bound.clientId}
    LIMIT 1
  `;
  const row = existing[0];
  if (!row) return { ok: false, status: 404, error: GUATEMALA_STAFF_MESSAGES.notFound };
  if (!row.deactivated_at) return { ok: false, status: 409, error: GUATEMALA_STAFF_MESSAGES.alreadyActive };
  return { ok: false, status: 409, error: GUATEMALA_STAFF_MESSAGES.passwordMissing };
}

export async function loginGuatemalaStaff(input: {
  username?: unknown;
  password?: unknown;
}): Promise<{ ok: true; token: string; session: StaffSessionView } | { ok: false; error: string }> {
  const username = normalizeStaffUsername(input.username);
  const password = typeof input.password === "string" ? input.password : "";
  if (!username || !password) return { ok: false, error: GUATEMALA_STAFF_MESSAGES.loginFailed };
  await ensureGuatemalaStaffTables();
  const sql = getSql();
  const rows = await sql`
    SELECT id, client_id, username, password_hash, active, deactivated_at, session_generation,
      can_manage_expenses
    FROM guatemala_staff_accounts
    WHERE username = ${username}
    LIMIT 1
  `;
  const row = rows[0];
  const stored = row?.password_hash ? String(row.password_hash) : "";
  const matches = stored ? await verifyPassword(password, stored) : false;
  if (!row || !matches || !flag(row.active) || row.deactivated_at) {
    return { ok: false, error: GUATEMALA_STAFF_MESSAGES.loginFailed };
  }
  return openSession(row);
}

async function openSession(row: Record<string, unknown>): Promise<{
  ok: true;
  token: string;
  session: StaffSessionView;
}> {
  const sql = getSql();
  const token = newOpaqueToken();
  const expires = new Date(Date.now() + STAFF_SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sql`
    INSERT INTO guatemala_staff_sessions (token_hash, account_id, session_generation, expires_at)
    VALUES (
      ${tokenHash(token)},
      ${String(row.id)},
      ${Number(row.session_generation)},
      ${expires.toISOString()}
    )
  `;
  return {
    ok: true,
    token,
    session: {
      accountId: String(row.id),
      clientId: String(row.client_id),
      username: String(row.username),
      canManageExpenses: flag(row.can_manage_expenses),
    },
  };
}

export async function loadStaffAuth(token: string | null | undefined): Promise<LoadedAuth | null> {
  if (!token) return null;
  await ensureGuatemalaStaffTables();
  const sql = getSql();
  const rows = await sql`
    SELECT staff.id, staff.client_id, staff.username, staff.active, staff.session_generation,
      staff.deactivated_at, staff.can_correct_lots, staff.can_void_lots, staff.can_manage_expenses,
      session.session_generation AS session_generation_at_login, session.expires_at
    FROM guatemala_staff_sessions AS session
    INNER JOIN guatemala_staff_accounts AS staff ON staff.id = session.account_id
    WHERE session.token_hash = ${tokenHash(token)}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    account: {
      id: String(row.id),
      clientId: String(row.client_id),
      username: String(row.username),
      active: flag(row.active),
      sessionGeneration: Number(row.session_generation),
      deactivatedAt: row.deactivated_at ? iso(row.deactivated_at) : null,
      canCorrectLots: flag(row.can_correct_lots),
      canVoidLots: flag(row.can_void_lots),
      canManageExpenses: flag(row.can_manage_expenses),
    },
    session: {
      accountId: String(row.id),
      sessionGeneration: Number(row.session_generation_at_login),
      expiresAt: iso(row.expires_at),
    },
  };
}

export async function staffSessionFromToken(token: string | null | undefined): Promise<StaffSessionView | null> {
  const loaded = await loadStaffAuth(token);
  if (!loaded) return null;
  if (!loaded.account.active || loaded.account.deactivatedAt) return null;
  if (loaded.account.sessionGeneration !== loaded.session.sessionGeneration) return null;
  if (new Date(loaded.session.expiresAt).getTime() <= Date.now()) return null;
  return {
    accountId: loaded.account.id,
    clientId: loaded.account.clientId,
    username: loaded.account.username,
    canManageExpenses: loaded.account.canManageExpenses === true,
  };
}

export async function setGuatemalaStaffLotPermissions(input: {
  accountId: unknown;
  canCorrectLots: unknown;
  canVoidLots: unknown;
  canManageExpenses: unknown;
}): Promise<{ ok: true } | { ok: false; status: 404; error: string }> {
  const accountId = typeof input.accountId === "string" ? input.accountId : "";
  if (!accountId) return { ok: false, status: 404, error: GUATEMALA_STAFF_MESSAGES.notFound };
  const bound = await requireBoundClient();
  if (!bound.ok) return { ok: false, status: 404, error: bound.error };
  await ensureGuatemalaStaffTables();
  const sql = getSql();
  const rows = await sql`
    UPDATE guatemala_staff_accounts
    SET can_correct_lots = ${input.canCorrectLots === true},
        can_void_lots = ${input.canVoidLots === true},
        can_manage_expenses = ${input.canManageExpenses === true}
    WHERE id = ${accountId} AND client_id = ${bound.clientId}
    RETURNING id
  `;
  if (!rows[0]) return { ok: false, status: 404, error: GUATEMALA_STAFF_MESSAGES.notFound };
  return { ok: true };
}

export async function revokeStaffToken(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await ensureGuatemalaStaffTables();
  const sql = getSql();
  await sql`DELETE FROM guatemala_staff_sessions WHERE token_hash = ${tokenHash(token)}`;
}

export function staffCookieMaxAge(): number {
  return STAFF_SESSION_DAYS * 24 * 60 * 60;
}
