import { getSql } from "@/lib/db";
import {
  GUATEMALA_CLIENT_NAME,
  GUATEMALA_MARKET,
  isGuatemalaMarket,
  requestTargetsGuatemala,
} from "@/lib/markets/guatemala";

export interface StoredClient {
  id: string;
  name: string;
  active: boolean;
  market: string | null;
}

async function ensureMarketTables(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS client_markets (
      client_id TEXT PRIMARY KEY,
      market_code TEXT NOT NULL,
      locale TEXT NOT NULL,
      currency TEXT NOT NULL,
      currency_symbol TEXT NOT NULL,
      timezone TEXT NOT NULL,
      configured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

// Bind the market to the existing client's id once. Later lookups use that id,
// so renaming the client does not move the market to another record.
async function bindGuatemalaClient(): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM client_markets AS market
    WHERE market.market_code = ${GUATEMALA_MARKET.code}
      AND NOT EXISTS (
        SELECT 1 FROM clients AS client WHERE client.id = market.client_id
      )
  `;

  const bound = await sql`
    SELECT market.client_id
    FROM client_markets AS market
    INNER JOIN clients AS client ON client.id = market.client_id
    WHERE market.market_code = ${GUATEMALA_MARKET.code}
    LIMIT 1
  `;
  if (bound.length > 0) return;

  const matches = await sql`
    SELECT id
    FROM clients
    WHERE lower(trim(name)) = ${GUATEMALA_CLIENT_NAME}
    ORDER BY created_at ASC
  `;
  if (matches.length !== 1) return;

  const clientId = String(matches[0].id);
  await sql`
    INSERT INTO client_markets (
      client_id, market_code, locale, currency, currency_symbol, timezone
    )
    VALUES (
      ${clientId},
      ${GUATEMALA_MARKET.code},
      ${GUATEMALA_MARKET.locale},
      ${GUATEMALA_MARKET.currency},
      ${GUATEMALA_MARKET.symbol},
      ${GUATEMALA_MARKET.timezone}
    )
    ON CONFLICT (client_id) DO UPDATE SET
      market_code = EXCLUDED.market_code,
      locale = EXCLUDED.locale,
      currency = EXCLUDED.currency,
      currency_symbol = EXCLUDED.currency_symbol,
      timezone = EXCLUDED.timezone
  `;
}

export async function listClientsWithMarkets(): Promise<StoredClient[]> {
  await ensureMarketTables();
  await bindGuatemalaClient();
  const sql = getSql();
  const rows = await sql`
    SELECT client.id, client.name, client.active, market.market_code
    FROM clients AS client
    LEFT JOIN client_markets AS market ON market.client_id = client.id
    ORDER BY client.created_at ASC
  `;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    active: row.active === true || row.active === "t" || row.active === "true",
    market: row.market_code ? String(row.market_code) : null,
  }));
}

export async function clientMarketCode(clientId: string | null | undefined): Promise<string | null> {
  const id = clientId?.trim();
  if (!id) return null;
  await ensureMarketTables();
  const sql = getSql();
  const rows = await sql`
    SELECT market_code
    FROM client_markets
    WHERE client_id = ${id}
    LIMIT 1
  `;
  return rows[0]?.market_code ? String(rows[0].market_code) : null;
}

export async function clientIsGuatemala(clientId: string | null | undefined): Promise<boolean> {
  return isGuatemalaMarket(await clientMarketCode(clientId));
}

export async function ebayPublishBlockedForGuatemala(body: {
  market?: unknown;
  clientId?: unknown;
  listing?: { market?: unknown } | null;
}): Promise<boolean> {
  if (requestTargetsGuatemala({ market: body.market, listing: body.listing ?? null })) {
    return true;
  }
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  if (!clientId) return false;
  return clientIsGuatemala(clientId);
}
