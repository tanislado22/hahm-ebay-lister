import { neon } from "@neondatabase/serverless";

export function getSql() {
  const connectionString =
    process.env.STORAGE_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Database connection is not configured");
  }
  return neon(connectionString);
}

let ensuring: Promise<void> | null = null;

// Same Neon database the app already uses. Tables are created on first use,
// matching jobs / clients / ebay_connections.
export function ensureInventoryTables(): Promise<void> {
  if (!ensuring) {
    ensuring = migrate().catch((err) => {
      ensuring = null;
      throw err;
    });
  }
  return ensuring;
}

async function migrate(): Promise<void> {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS platform_listings (
      id TEXT PRIMARY KEY,
      workspace_key TEXT NOT NULL,
      sku TEXT NOT NULL,
      ebay_item_id TEXT,
      ebay_title TEXT,
      vinted_title TEXT,
      vinted_listing_url TEXT,
      vinted_listing_id TEXT,
      published_on_ebay BOOLEAN NOT NULL DEFAULT FALSE,
      published_on_vinted BOOLEAN NOT NULL DEFAULT FALSE,
      vinted_status TEXT NOT NULL DEFAULT 'not_prepared',
      status TEXT NOT NULL DEFAULT 'active',
      prepared JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_key, sku)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sale_events (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      external_event_id TEXT NOT NULL,
      sku TEXT,
      title TEXT,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      whatsapp_sent_at TIMESTAMPTZ,
      status TEXT NOT NULL,
      detail TEXT,
      workspace_key TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (platform, external_event_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS vinted_category_maps (
      id TEXT PRIMARY KEY,
      item_type TEXT NOT NULL UNIQUE,
      vinted_path TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}
