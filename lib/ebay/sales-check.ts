import { listEbayConnections } from "@/lib/ebay/client-connections";
import { fetchRecentOrderLines } from "@/lib/ebay/orders";
import { decideEbaySale } from "@/lib/ebay/sale-decision";
import { accessTokenFromCookie } from "@/lib/ebay/session";
import { findListingForEbaySale } from "@/lib/inventory/links";
import { claimSaleEvent, finishSaleEvent } from "@/lib/inventory/sale-events";
import { ebaySaleNotice, isNewTelegramSale } from "@/lib/telegram/ebay-sale";
import { deliverConfirmedSale, suppressTelegramSale } from "@/lib/telegram/notices";
import { sendPlatformSaleAlert } from "@/lib/whatsapp/send";

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface EbaySalesCheckResult {
  connections: number;
  lines: number;
  sent: number;
  skipped: number;
  needsReview: number;
  telegramSent: number;
  telegramDuplicate: number;
  telegramFailed: number;
  errors: string[];
}

export async function runEbaySalesCheck(): Promise<EbaySalesCheckResult> {
  const result: EbaySalesCheckResult = {
    connections: 0,
    lines: 0,
    sent: 0,
    skipped: 0,
    needsReview: 0,
    telegramSent: 0,
    telegramDuplicate: 0,
    telegramFailed: 0,
    errors: [],
  };
  const connections = await listEbayConnections();
  result.connections = connections.length;
  const since = new Date(Date.now() - LOOKBACK_MS);

  for (const connection of connections) {
    let accessToken: string | null = null;
    try {
      accessToken = await accessTokenFromCookie(connection.sealedConnection);
    } catch (error) {
      result.errors.push(`${connection.connectionKey}: ${(error as Error).message}`);
      continue;
    }
    if (!accessToken) {
      result.errors.push(`${connection.connectionKey}: stored eBay connection could not be opened`);
      continue;
    }

    let lines;
    try {
      lines = await fetchRecentOrderLines(accessToken, since);
    } catch (error) {
      result.errors.push(`${connection.connectionKey}: ${(error as Error).message}`);
      continue;
    }

    for (const line of lines) {
      result.lines += 1;
      const externalEventId = `${line.orderId}:${line.lineItemId}`;
      try {
        const lookup = await findListingForEbaySale(
          connection.connectionKey,
          line.sku,
          line.legacyItemId
        );
        try {
          const notice = ebaySaleNotice(line, lookup);
          if (notice && !isNewTelegramSale(line.createdAt)) {
            await suppressTelegramSale({
              platform: "ebay",
              externalEventId,
              sku: notice.sku,
              title: notice.title,
            });
          } else if (notice) {
            const delivery = await deliverConfirmedSale({
              platform: "ebay",
              externalEventId,
              sku: notice.sku,
              title: notice.title,
            });
            if (delivery === "sent") result.telegramSent += 1;
            else if (delivery === "duplicate") result.telegramDuplicate += 1;
            else if (delivery === "failed") {
              result.telegramFailed += 1;
              result.errors.push(`${externalEventId}: Telegram failed`);
            }
          }
        } catch (error) {
          result.telegramFailed += 1;
          result.errors.push(`${externalEventId}: Telegram failed`);
          console.error("[ebay-sales] telegram", externalEventId, error);
        }
        const row = lookup.kind === "one" ? lookup.row : null;
        const decision = decideEbaySale({
          cancelled: line.cancelled,
          lookup: lookup.kind,
          publishedOnVinted: Boolean(row?.publishedOnVinted),
          sku: row?.sku || line.sku,
          title: row?.vintedTitle || row?.ebayTitle || line.title,
        });
        if (decision.action === "ignore") continue;

        if (decision.action === "record") {
          const claim = await claimSaleEvent({
            platform: "ebay",
            externalEventId,
            sku: decision.sku || null,
            title: decision.title || null,
            workspaceKey: connection.connectionKey,
            detail: decision.detail,
            initialStatus: decision.status,
          });
          if (claim.action === "owned") {
            if (decision.status === "needs_review") result.needsReview += 1;
            else result.skipped += 1;
          }
          continue;
        }

        if (!decision.sku || !decision.title) {
          const claim = await claimSaleEvent({
            platform: "ebay",
            externalEventId,
            sku: decision.sku || null,
            title: decision.title || null,
            workspaceKey: connection.connectionKey,
            detail: "Matched a Vinted listing, but the SKU or title was empty",
            initialStatus: "needs_review",
          });
          if (claim.action === "owned") result.needsReview += 1;
          continue;
        }

        const claim = await claimSaleEvent({
          platform: "ebay",
          externalEventId,
          sku: decision.sku,
          title: decision.title,
          workspaceKey: connection.connectionKey,
          detail: null,
          initialStatus: "pending",
        });
        if (claim.action === "done") continue;

        try {
          await sendPlatformSaleAlert("ebay", decision.sku, decision.title);
          await finishSaleEvent(claim.id, {
            status: "sent",
            whatsappSent: true,
            sku: decision.sku,
            title: decision.title,
          });
          result.sent += 1;
        } catch (error) {
          await finishSaleEvent(claim.id, {
            status: "failed",
            whatsappSent: false,
            detail: (error as Error).message,
            sku: decision.sku,
            title: decision.title,
          });
          result.errors.push(`${externalEventId}: WhatsApp failed`);
        }
      } catch (error) {
        result.errors.push(`${externalEventId}: ${(error as Error).message}`);
      }
    }
  }

  return result;
}
