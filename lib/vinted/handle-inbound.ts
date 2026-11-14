import { textForSale, type InboundEmail } from "@/lib/vinted/email";
import { listSaleTitleCandidates } from "@/lib/inventory/links";
import { claimSaleEvent, finishSaleEvent } from "@/lib/inventory/sale-events";
import { classifyMailboxEmail, mailboxDiagnosis, mailboxVisibleText } from "@/lib/mailbox/sale-email";
import { resolveMarketplaceIdentity, resolveSaleIdentity } from "@/lib/vinted/sale-identity";
import { isNewTelegramSale } from "@/lib/telegram/ebay-sale";
import { saleTelegramMessage } from "@/lib/telegram/message";
import { extractPlatformListingUrl } from "@/lib/telegram/sale-links";
import { deliverConfirmedSale, type TelegramDelivery } from "@/lib/telegram/notices";
import { readStatedMarketplaceNet } from "@/lib/usa-lots/marketplace-sale";
import { sendPlatformSaleAlert } from "@/lib/whatsapp/send";

export async function handleVintedSaleEmail(
  email: InboundEmail,
  options?: { dryRun?: boolean }
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const dryRun = options?.dryRun === true;
  const text = textForSale(email);
  const visible = mailboxVisibleText(email);
  const classification = classifyMailboxEmail({ ...email, text: visible, html: "" });
  const diagnosis = mailboxDiagnosis(email, classification);
  if (classification.kind === "ignore") {
    return {
      httpStatus: 200,
      body: {
        ok: true,
        ignored: true,
        reason: classification.reason,
        ...diagnosis,
        ...(dryRun ? { dryRun: true } : {}),
      },
    };
  }
  if (!email.messageId.trim()) {
    return { httpStatus: 400, body: { ok: false, error: "Missing MessageID" } };
  }
  const marketplace = classification.platform === "poshmark" || classification.platform === "depop";
  if (!marketplace && !isNewTelegramSale(email.date ?? "")) {
    return {
      httpStatus: 200,
      body: {
        ok: true,
        suppressed: true,
        reason: "before activation",
        ...(dryRun ? { dryRun: true } : {}),
      },
    };
  }

  const published = await listSaleTitleCandidates();
  const candidates = published.map((row) => ({
    sku: row.sku,
    vintedTitle: row.vintedTitle ?? "",
    ebayTitle: row.ebayTitle ?? "",
  }));
  if (marketplace) {
    try {
      const { listMarketplaceTitleCandidates } = await import("@/lib/usa-lots/store");
      const lots = await listMarketplaceTitleCandidates();
      for (const row of lots) {
        candidates.push({ sku: row.sku, vintedTitle: row.title, ebayTitle: "" });
      }
    } catch (error) {
      console.error("[mailbox/inbound] lot titles", error instanceof Error ? error.name : "Error");
    }
  }
  const saleText = marketplace ? visible : text;
  const identity = marketplace
    ? resolveMarketplaceIdentity(email.subject, saleText, candidates)
    : resolveSaleIdentity(classification.title, text, candidates);
  const sku = identity.sku;
  const title = identity.title;
  const listingUrl = extractPlatformListingUrl(classification.platform, `${saleText}\n${email.html || ""}`);
  const statedNet = marketplace ? readStatedMarketplaceNet(saleText) : null;

  if (dryRun) {
    return {
      httpStatus: 200,
      body: {
        ok: true,
        dryRun: true,
        status: "would_send",
        platform: classification.platform,
        sku: sku || null,
        title,
        message: saleTelegramMessage(
          classification.platform,
          sku,
          title,
          listingUrl ? { listingUrl } : undefined
        ),
        telegram: "not_sent",
      },
    };
  }

  let lotAction = "";
  if (!dryRun && marketplace) {
    try {
      const { rememberMarketplaceSale } = await import("@/lib/usa-lots/store");
      const saved = await rememberMarketplaceSale({
        platform: classification.platform as "poshmark" | "depop",
        externalId: email.messageId,
        sku,
        title,
        listingUrl: listingUrl || "",
        soldAt: email.date || null,
        itemCents: statedNet?.itemCents ?? null,
        buyerShippingCents: statedNet?.buyerShippingCents ?? null,
        feeCents: statedNet?.feeCents ?? null,
        sellerShippingCents: statedNet?.sellerShippingCents ?? null,
        refundCents: statedNet?.refundCents ?? null,
      });
      lotAction = saved.action;
    } catch (error) {
      lotAction = "not_recorded";
      console.error("[mailbox/inbound] lot", error instanceof Error ? error.name : "Error");
    }
    if (!isNewTelegramSale(email.date ?? "")) {
      return {
        httpStatus: 200,
        body: {
          ok: true,
          suppressed: true,
          reason: "before activation",
          recorded: true,
          lot: lotAction || "not_recorded",
          platform: classification.platform,
          sku: sku || null,
          title,
        },
      };
    }
  }

  if (classification.platform !== "vinted" || !sku) {
    const telegram = await notifySale(email.messageId, classification.platform, sku, title, listingUrl);
    if (telegram === "failed") {
      return { httpStatus: 500, body: { ok: false, error: "Telegram send failed", platform: classification.platform } };
    }
    return {
      httpStatus: 200,
      body: {
        ok: true,
        status: telegram === "duplicate" ? undefined : "sent",
        duplicate: telegram === "duplicate" ? true : undefined,
        platform: classification.platform,
        sku: sku || null,
        title,
        telegram,
        ...(marketplace ? { ...diagnosis, lot: lotAction || "not_recorded" } : {}),
      },
    };
  }

  const claim = await claimSaleEvent({
    platform: "vinted",
    externalEventId: email.messageId,
    sku,
    title,
    workspaceKey: null,
    detail: null,
    initialStatus: "pending",
  });

  const telegram = await notifySale(email.messageId, "vinted", sku, title, listingUrl);
  if (claim.action === "done") {
    if (telegram === "failed") {
      return { httpStatus: 500, body: { ok: false, error: "Telegram send failed", duplicate: true } };
    }
    return { httpStatus: 200, body: { ok: true, duplicate: true, telegram } };
  }

  let whatsapp: "sent" | "failed" = "sent";
  try {
    await sendPlatformSaleAlert("vinted", sku, title);
    await finishSaleEvent(claim.id, {
      status: "sent",
      whatsappSent: true,
      sku,
      title,
    });
  } catch (error) {
    whatsapp = "failed";
    console.error("[vinted/inbound] WhatsApp failed", email.messageId, error);
    const telegramOk = telegram === "sent" || telegram === "duplicate";
    await finishSaleEvent(claim.id, {
      status: telegramOk ? "sent" : "failed",
      whatsappSent: false,
      detail: "WhatsApp send failed",
      sku,
      title,
    });
    if (!telegramOk) {
      return { httpStatus: 500, body: { ok: false, error: "WhatsApp send failed" } };
    }
  }

  if (telegram === "failed") {
    return { httpStatus: 500, body: { ok: false, error: "Telegram send failed", sku } };
  }
  return {
    httpStatus: 200,
    body: { ok: true, status: "sent", sku, telegram, ...(whatsapp === "failed" ? { whatsapp: "failed" } : {}) },
  };
}

async function notifySale(
  messageId: string,
  platform: "ebay" | "vinted" | "poshmark" | "depop",
  sku: string,
  title: string,
  listingUrl: string | null
): Promise<TelegramDelivery> {
  try {
    return await deliverConfirmedSale({
      platform,
      externalEventId: messageId,
      sku,
      title,
      listingUrl,
    });
  } catch (error) {
    console.error("[mailbox/inbound] Telegram failed", messageId, error);
    return "failed";
  }
}
