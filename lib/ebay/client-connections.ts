import { neon } from "@neondatabase/serverless";

export type EbayWorkMode = "store" | "client";

function getSql() {

  const connectionString =

    process.env.STORAGE_DATABASE_URL || process.env.DATABASE_URL;

  if (!connectionString) {

    throw new Error("Database connection is not configured");

  }

  return neon(connectionString);

}

async function ensureEbayConnectionsTable() {

  const sql = getSql();

  await sql`

    CREATE TABLE IF NOT EXISTS ebay_connections (

      connection_key TEXT PRIMARY KEY,

      sealed_connection TEXT NOT NULL,

      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

    )

  `;

  return sql;

}

export function ebayConnectionKey(

  workMode: EbayWorkMode,

  clientId?: string | null

): string | null {

  if (workMode === "store") {

    return "store";

  }

  const id = clientId?.trim();

  if (!id) {

    return null;

  }

  return `client:${id}`;

}

export async function saveEbayConnection(

  connectionKey: string,

  sealedConnection: string

): Promise<void> {

  const sql = await ensureEbayConnectionsTable();

  await sql`

    INSERT INTO ebay_connections (

      connection_key,

      sealed_connection,

      updated_at

    )

    VALUES (

      ${connectionKey},

      ${sealedConnection},

      NOW()

    )

    ON CONFLICT (connection_key)

    DO UPDATE SET

      sealed_connection = EXCLUDED.sealed_connection,

      updated_at = NOW()

  `;

}

export async function getEbayConnection(

  connectionKey: string

): Promise<string | null> {

  const sql = await ensureEbayConnectionsTable();

  const rows = await sql`

    SELECT sealed_connection

    FROM ebay_connections

    WHERE connection_key = ${connectionKey}

    LIMIT 1

  `;

  if (rows.length === 0) {

    return null;

  }

  return String(rows[0].sealed_connection || "") || null;

}

export async function deleteEbayConnection(

  connectionKey: string

): Promise<void> {

  const sql = await ensureEbayConnectionsTable();

  await sql`

    DELETE FROM ebay_connections

    WHERE connection_key = ${connectionKey}

  `;

}
