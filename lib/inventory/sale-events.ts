import crypto from "crypto";
import { ensureInventoryTables, getSql } from "@/lib/db";

export type SalePlatform = "ebay" | "vinted";
export type SaleEventStatus = "pending" | "sent" | "skipped" | "needs_review" | "failed";

export interface SaleEvent {
  id: string;
  platform: string;
  externalEventId: string;
  sku: string | null;
  title: string | null;
  detectedAt: string;
  whatsappSentAt: string | null;
  status: string;
  detail: string | null;
}

export async function claimSaleEvent(input: {
  platform: SalePlatform;
  externalEventId: string;
  sku: string | null;
  title: string | null;
  workspaceKey: string | null;
  detail: string | null;
  initialStatus: "pending" | "skipped" | "needs_review";
}): Promise<{ action: "owned" | "done"; id: string }> {
  const sql = getSql();
  await ensureInventoryTables();
  const id = crypto.randomUUID();
  const inserted = await sql`
    INSERT INTO sale_events (
      id, platform, external_event_id, sku, title, status, detail, workspace_key, detected_at, updated_at
    )
    VALUES (
      ${id},
      ${input.platform},
      ${input.externalEventId},
      ${input.sku},
      ${input.title},
      ${input.initialStatus},
      ${input.detail},
      ${input.workspaceKey},
      NOW(),
      NOW()
    )
    ON CONFLICT (platform, external_event_id) DO NOTHING
    RETURNING id
  `;
  if (inserted.length > 0) {
    return { action: "owned", id: String(inserted[0].id) };
  }
  if (input.initialStatus !== "pending") {
    return { action: "done", id: "" };
  }

  const claimed = await sql`
    UPDATE sale_events
    SET
      status = 'pending',
      updated_at = NOW(),
      sku = COALESCE(${input.sku}, sku),
      title = COALESCE(${input.title}, title),
      detail = ${input.detail}
    WHERE platform = ${input.platform}
      AND external_event_id = ${input.externalEventId}
      AND whatsapp_sent_at IS NULL
      AND (
        status = 'failed'
        OR (status = 'pending' AND updated_at < NOW() - INTERVAL '3 minutes')
      )
    RETURNING id
  `;
  if (claimed.length > 0) {
    return { action: "owned", id: String(claimed[0].id) };
  }
  return { action: "done", id: "" };
}

export async function finishSaleEvent(
  id: string,
  input: {
    status: SaleEventStatus;
    detail?: string | null;
    whatsappSent: boolean;
    sku?: string | null;
    title?: string | null;
  }
): Promise<void> {
  const sql = getSql();
  await ensureInventoryTables();
  await sql`
    UPDATE sale_events
    SET
      status = ${input.status},
      detail = COALESCE(${input.detail ?? null}, detail),
      sku = COALESCE(${input.sku ?? null}, sku),
      title = COALESCE(${input.title ?? null}, title),
      whatsapp_sent_at = CASE
        WHEN ${input.whatsappSent} THEN NOW()
        ELSE whatsapp_sent_at
      END,
      updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function listSaleEvents(status: SaleEventStatus): Promise<SaleEvent[]> {
  const sql = getSql();
  await ensureInventoryTables();
  const rows = await sql`
    SELECT id, platform, external_event_id, sku, title, detected_at, whatsapp_sent_at, status, detail
    FROM sale_events
    WHERE status = ${status}
    ORDER BY detected_at DESC
    LIMIT 50
  `;
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id ?? ""),
      platform: String(record.platform ?? ""),
      externalEventId: String(record.external_event_id ?? ""),
      sku: record.sku ? String(record.sku) : null,
      title: record.title ? String(record.title) : null,
      detectedAt: String(record.detected_at ?? ""),
      whatsappSentAt: record.whatsapp_sent_at ? String(record.whatsapp_sent_at) : null,
      status: String(record.status ?? ""),
      detail: record.detail ? String(record.detail) : null,
    };
  });
}
