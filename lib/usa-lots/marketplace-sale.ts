import { listingUrlForPlatform } from "@/lib/telegram/sale-links";
import { usdToCents } from "@/lib/usa-lots/money";

export type MarketplacePlatform = "poshmark" | "depop";

export interface MarketplaceArticle {
  id: string;
  sku: string;
  lotId: string;
  listingUrls: readonly string[];
  disposition?: "" | "guatemala-transfer";
}

export interface MarketplaceNotice {
  platform: MarketplacePlatform;
  externalId: string;
  sku: string;
  title: string;
  listingUrl: string;
  itemCents: number | null;
  buyerShippingCents: number | null;
  feeCents: number | null;
  sellerShippingCents: number | null;
  refundCents: number | null;
}

export interface MarketplaceExistingSale {
  id: string;
  orderId: string;
  itemId: string;
  sku: string;
  platform: string;
  listingKey: string;
  cancelled: boolean;
  linkStatus: "lotted" | "unassigned" | "unmatched" | "transfer";
  hasNet: boolean;
}

export type MarketplacePlan =
  | { action: "duplicate"; itemId: string; lotId: string; reason: string }
  | { action: "unmatched"; orderId: string }
  | { action: "record"; orderId: string; itemId: string; lotId: string; hasNet: boolean }
  | { action: "complete"; saleId: string; orderId: string; itemId: string; lotId: string; hasNet: boolean };

export function marketplaceFeeLabel(platform: string): string {
  if (platform === "poshmark") return "comisión de Poshmark";
  if (platform === "depop") return "comisión de Depop";
  return "comisión de eBay";
}

export function marketplaceOrderId(platform: MarketplacePlatform, externalId: string): string {
  return `${platform}:${externalId.trim()}`;
}

export function marketplaceListingKey(platform: MarketplacePlatform, value: string): string {
  const safe = listingUrlForPlatform(platform, value);
  if (!safe) return "";
  const url = new URL(safe);
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  return `${host}${path}`;
}

export function marketplaceHasNet(input: {
  itemCents: number | null;
  buyerShippingCents: number | null;
  feeCents: number | null;
  sellerShippingCents: number | null;
  refundCents: number | null;
}): boolean {
  return [input.itemCents, input.buyerShippingCents, input.feeCents, input.sellerShippingCents, input.refundCents].every(
    (value) => value != null
  );
}

export function matchMarketplaceArticle(
  input: { platform: MarketplacePlatform; sku: string; listingUrl: string },
  articles: readonly MarketplaceArticle[]
): { kind: "one"; article: MarketplaceArticle } | { kind: "none" } | { kind: "ambiguous" } {
  const sellable = articles.filter((article) => article.disposition !== "guatemala-transfer" && article.lotId.trim());
  const sku = input.sku.trim();
  const key = marketplaceListingKey(input.platform, input.listingUrl);
  const bySku = sku ? sellable.filter((article) => article.sku.trim() === sku) : [];
  if (bySku.length > 1) return { kind: "ambiguous" };
  if (bySku.length === 1) return { kind: "one", article: bySku[0] };
  if (!key) return { kind: "none" };
  const byUrl = sellable.filter((article) =>
    article.listingUrls.some((url) => marketplaceListingKey(input.platform, url) === key)
  );
  if (byUrl.length > 1) return { kind: "ambiguous" };
  if (byUrl.length === 1) return { kind: "one", article: byUrl[0] };
  return { kind: "none" };
}

export function planMarketplaceSale(
  notice: MarketplaceNotice,
  articles: readonly MarketplaceArticle[],
  existing: readonly MarketplaceExistingSale[]
): MarketplacePlan {
  const orderId = marketplaceOrderId(notice.platform, notice.externalId);
  const hasNet = marketplaceHasNet(notice);
  const match = matchMarketplaceArticle(notice, articles);
  const active = existing.filter((sale) => !sale.cancelled);
  const sameEvent = active.find((sale) => sale.orderId === orderId);

  if (match.kind === "one") {
    const itemSales = active.filter((sale) => sale.itemId === match.article.id && sale.linkStatus === "lotted");
    const priced = itemSales.find((sale) => sale.hasNet);
    if (priced && priced.orderId !== orderId) {
      return {
        action: "duplicate",
        itemId: match.article.id,
        lotId: match.article.lotId,
        reason: "Esa prenda ya tiene una venta contabilizada. No se sumó otra vez.",
      };
    }
    if (sameEvent?.hasNet) {
      return {
        action: "duplicate",
        itemId: match.article.id,
        lotId: match.article.lotId,
        reason: "Esa venta ya estaba registrada.",
      };
    }
    if (sameEvent) {
      return { action: "complete", saleId: sameEvent.id, orderId, itemId: match.article.id, lotId: match.article.lotId, hasNet };
    }
    const ownIncomplete = itemSales.find((sale) => !sale.hasNet && sale.platform === notice.platform);
    if (ownIncomplete) {
      return {
        action: "complete",
        saleId: ownIncomplete.id,
        orderId: ownIncomplete.orderId,
        itemId: match.article.id,
        lotId: match.article.lotId,
        hasNet,
      };
    }
    const sku = match.article.sku.trim();
    const openNotices = active.filter((sale) => {
      if (sale.linkStatus !== "unmatched" || sale.hasNet || sale.platform !== notice.platform) return false;
      if (sale.sku.trim() && sku && sale.sku.trim() !== sku) return false;
      return true;
    });
    if (openNotices.length === 1) {
      return {
        action: "complete",
        saleId: openNotices[0].id,
        orderId: openNotices[0].orderId,
        itemId: match.article.id,
        lotId: match.article.lotId,
        hasNet,
      };
    }
    return { action: "record", orderId, itemId: match.article.id, lotId: match.article.lotId, hasNet };
  }

  if (sameEvent?.hasNet) {
    return { action: "duplicate", itemId: "", lotId: "", reason: "Esa venta ya estaba registrada." };
  }
  if (sameEvent) {
    return { action: "complete", saleId: sameEvent.id, orderId, itemId: "", lotId: "", hasNet };
  }
  return { action: "unmatched", orderId };
}

export interface MarketplaceNoticeRow {
  platform: string;
  status: string;
  sku: string;
  title: string;
  externalId: string;
  soldAt: string;
}

export function describeMarketplaceNotices(
  notices: readonly MarketplaceNoticeRow[],
  storedOrderIds: readonly string[]
): string[] {
  const stored = new Set(storedOrderIds);
  const rows = notices.filter((row) => row.platform === "poshmark" || row.platform === "depop");
  if (rows.length === 0) {
    return [
      "No se importó la venta de Poshmark: no hay ningún aviso de Poshmark ni de Depop guardado. El correo no quedó registrado en esta base.",
    ];
  }
  return rows.slice(0, 8).map((row) => {
    const name = row.platform === "depop" ? "Depop" : "Poshmark";
    const title = row.title.trim() || "sin título";
    const when = row.soldAt.trim().slice(0, 10);
    const whenText = when ? ` del ${when}` : "";
    const orderId = `${row.platform}:${row.externalId.trim()}`;
    if (row.externalId.trim() && stored.has(orderId)) {
      const sku = row.sku.trim();
      return sku
        ? `El aviso de ${name}${whenText}, «${title}», ya está guardado con SKU ${sku}. Si no tiene ficha, está en Ventas por vincular, al final de la página.`
        : `El aviso de ${name}${whenText}, «${title}», ya está guardado sin SKU. Está en Ventas por vincular, al final de la página.`;
    }
    const status = row.status.trim() || "desconocido";
    if (status !== "sent" && status !== "suppressed") {
      return `No se importó el aviso de ${name}${whenText}, «${title}»: está en estado ${status}, no en enviado.`;
    }
    const sku = row.sku.trim();
    if (!sku) {
      return `No se vinculó el aviso de ${name}${whenText}, «${title}»: el correo no trajo un SKU ni un enlace de la publicación.`;
    }
    return `No se vinculó el aviso de ${name}${whenText}, «${title}», SKU ${sku}: ninguna prenda del lote tiene ese SKU.`;
  });
}

export function manualMarketplaceMoney(input: {
  price: string;
  fee: string;
  buyerShipping: string;
  sellerShipping: string;
}):
  | {
      ok: true;
      money: {
        itemCents: number;
        buyerShippingCents: number;
        feeCents: number;
        sellerShippingCents: number;
        refundCents: number;
      };
    }
  | { ok: false; error: string } {
  const itemCents = usdToCents(input.price);
  const feeCents = usdToCents(input.fee);
  const buyerShippingCents = usdToCents(input.buyerShipping);
  const sellerShippingCents = usdToCents(input.sellerShipping);
  if (itemCents == null || feeCents == null || buyerShippingCents == null || sellerShippingCents == null) {
    return {
      ok: false,
      error: "Escribe el precio, la comisión y los dos envíos en USD. Usa 0.00 si ese gasto no existió. Un monto vacío no se anota como cero.",
    };
  }
  return { ok: true, money: { itemCents, feeCents, buyerShippingCents, sellerShippingCents, refundCents: 0 } };
}
