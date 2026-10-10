import type { InboundEmail } from "@/lib/vinted/email";
import { classifyVintedEmail } from "@/lib/vinted/email";
import { listPublishedVinted } from "@/lib/inventory/links";
import { claimSaleEvent, finishSaleEvent } from "@/lib/inventory/sale-events";
import { matchSoldTitle } from "@/lib/vinted/match";
import { deliverConfirmedSale } from "@/lib/telegram/notices";
import { sendPlatformSaleAlert } from "@/lib/whatsapp/send";

export async function handleVintedSaleEmail(
  email: InboundEmail
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const classification = classifyVintedEmail(email);
  if (classification.kind === "ignore") {
    return { httpStatus: 200, body: { ok: true, ignored: true, reason: classification.reason } };
  }
  if (!email.messageId) {
    return { httpStatus: 400, body: { ok: false, error: "Missing MessageID" } };
  }

  const published = await listPublishedVinted();
  const match = classification.title
    ? matchSoldTitle(
        classification.title,
        published.map((row) => ({
          sku: row.sku,
          vintedTitle: row.vintedTitle ?? "",
          ebayTitle: row.ebayTitle ?? "",
        }))
      )
    : { kind: "none" as const };

  if (!classification.title || match.kind !== "unique") {
    const detail = !classification.title
      ? "Sale email had no item title"
      : match.kind === "ambiguous"
        ? `Ambiguous SKUs: ${match.skus.join(", ")}`
        : "No published Vinted listing matched this title";
    await claimSaleEvent({
      platform: "vinted",
      externalEventId: email.messageId,
      sku: null,
      title: classification.title || null,
      workspaceKey: null,
      detail,
      initialStatus: "needs_review",
    });
    return {
      httpStatus: 200,
      body: { ok: true, status: "needs_review" },
    };
  }

  const claim = await claimSaleEvent({
    platform: "vinted",
    externalEventId: email.messageId,
    sku: match.sku,
    title: match.title,
    workspaceKey: null,
    detail: null,
    initialStatus: "pending",
  });

  let telegram: "sent" | "duplicate" | "failed" | "missing" = "missing";
  try {
    telegram = await deliverConfirmedSale({
      platform: "vinted",
      externalEventId: email.messageId,
      sku: match.sku,
      title: match.title,
    });
  } catch (error) {
    console.error("[vinted/inbound] Telegram failed", email.messageId, error);
    telegram = "failed";
  }

  if (claim.action === "done") {
    if (telegram === "failed") {
      return { httpStatus: 500, body: { ok: false, error: "Telegram send failed", duplicate: true } };
    }
    return { httpStatus: 200, body: { ok: true, duplicate: true, telegram } };
  }

  try {
    await sendPlatformSaleAlert("vinted", match.sku, match.title);
    await finishSaleEvent(claim.id, {
      status: "sent",
      whatsappSent: true,
      sku: match.sku,
      title: match.title,
    });
  } catch (error) {
    console.error("[vinted/inbound] WhatsApp failed", email.messageId, error);
    await finishSaleEvent(claim.id, {
      status: "failed",
      whatsappSent: false,
      detail: (error as Error).message,
      sku: match.sku,
      title: match.title,
    });
    return { httpStatus: 500, body: { ok: false, error: "WhatsApp send failed" } };
  }

  if (telegram === "failed") {
    return { httpStatus: 500, body: { ok: false, error: "Telegram send failed", sku: match.sku } };
  }
  return { httpStatus: 200, body: { ok: true, status: "sent", sku: match.sku, telegram } };
}
