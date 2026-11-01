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
    CREATE TABLE IF NOT EXISTS telegram_sale_notices (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      external_event_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (platform, external_event_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ebay_ended_notices (
      id TEXT PRIMARY KEY,
      ebay_item_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      status TEXT NOT NULL,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (ebay_item_id, event_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ebay_listing_watches (
      ebay_item_id TEXT PRIMARY KEY,
      sku TEXT,
      title TEXT,
      listing_status TEXT NOT NULL,
      quantity_sold INTEGER NOT NULL DEFAULT 0,
      end_time TEXT,
      notified_event_id TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

  await sql`
    CREATE TABLE IF NOT EXISTS vinted_current_item (
      workspace_key TEXT PRIMARY KEY,
      sku TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS vinted_inventory_links (
      id TEXT PRIMARY KEY,
      vinted_item_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      photo_url TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      suggested_sku TEXT NOT NULL DEFAULT '',
      match_status TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS listed_sku TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS duplicate_status TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS duplicate_with TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS sold_status TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS sold_platform TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS sold_detail TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS ebay_item_id TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS identify_checked_at TIMESTAMPTZ`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS ebay_candidates TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS rejected_candidates TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS vinted_presence TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS vinted_presence_at TIMESTAMPTZ`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS vinted_presence_detail TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS manual_photo_at TIMESTAMPTZ`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS vinted_unlinked_at TIMESTAMPTZ`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS discarded_vinted_url TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE vinted_inventory_links ADD COLUMN IF NOT EXISTS manual_vinted_url_at TIMESTAMPTZ`;
  await sql`
    CREATE TABLE IF NOT EXISTS vinted_inventory_events (
      id TEXT PRIMARY KEY,
      vinted_item_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS vinted_duplicate_dismissals (
      item_a TEXT NOT NULL,
      item_b TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (item_a, item_b)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS vinted_ready_snapshot (
      workspace_key TEXT PRIMARY KEY,
      sku TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      item_type TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '',
      condition TEXT NOT NULL DEFAULT '',
      photos JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Permanent article file. Separate from jobs: Delete All only removes workspace
  // rows, and these tables have no foreign key back to jobs.
  await sql`
    CREATE TABLE IF NOT EXISTS article_archive (
      id TEXT PRIMARY KEY,
      account_key TEXT NOT NULL,
      ebay_user_id TEXT NOT NULL DEFAULT '',
      ebay_item_id TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT '',
      ebay_url TEXT NOT NULL DEFAULT '',
      listing_status TEXT NOT NULL DEFAULT '',
      quantity_sold INTEGER,
      variants JSONB NOT NULL DEFAULT '[]',
      vinted_listing_url TEXT NOT NULL DEFAULT '',
      vinted_listing_id TEXT NOT NULL DEFAULT '',
      vinted_title TEXT NOT NULL DEFAULT '',
      vinted_status TEXT NOT NULL DEFAULT '',
      vinted_review TEXT NOT NULL DEFAULT 'unverified',
      source_job_id TEXT NOT NULL DEFAULT '',
      workspace_group JSONB,
      workspace_hidden BOOLEAN NOT NULL DEFAULT FALSE,
      origin TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE article_archive
    ADD COLUMN IF NOT EXISTS vinted_review TEXT NOT NULL DEFAULT 'unverified'
  `;
  await sql`
    ALTER TABLE article_archive
    ADD COLUMN IF NOT EXISTS usa_lot_id TEXT NOT NULL DEFAULT ''
  `;
  await sql`
    ALTER TABLE article_archive
    ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER
  `;
  await sql`
    ALTER TABLE article_archive
    ADD COLUMN IF NOT EXISTS cost_estimated BOOLEAN NOT NULL DEFAULT FALSE
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS article_archive_account_item_idx
    ON article_archive (account_key, ebay_item_id)
    WHERE ebay_item_id <> ''
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS article_archive_user_item_idx
    ON article_archive (ebay_user_id, ebay_item_id)
    WHERE ebay_user_id <> '' AND ebay_item_id <> ''
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS article_archive_account_updated_idx
    ON article_archive (account_key, updated_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS article_archive_source_job_idx
    ON article_archive (account_key, source_job_id)
    WHERE source_job_id <> ''
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS article_archive_photos (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      source TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT '',
      bytes TEXT NOT NULL DEFAULT '',
      thumb_bytes TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      thumb_url TEXT NOT NULL DEFAULT ''
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS article_archive_photos_article_idx
    ON article_archive_photos (article_id, position)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS article_import_runs (
      id TEXT PRIMARY KEY,
      account_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      ebay_user_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      list_page INTEGER NOT NULL DEFAULT 0,
      total_pages INTEGER,
      total_entries INTEGER,
      list_complete BOOLEAN NOT NULL DEFAULT FALSE,
      found INTEGER NOT NULL DEFAULT 0,
      imported INTEGER NOT NULL DEFAULT 0,
      existing_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      errors JSONB NOT NULL DEFAULT '[]',
      notices JSONB NOT NULL DEFAULT '[]',
      pending_ids JSONB NOT NULL DEFAULT '[]',
      failed_ids JSONB NOT NULL DEFAULT '[]',
      attempts JSONB NOT NULL DEFAULT '{}',
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (account_key, mode)
    )
  `;
}
