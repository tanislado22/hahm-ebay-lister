import { allocateSharedCents, SHARED_COST_RULE } from "@/lib/usa-lots/profit";
import { moneyCents } from "@/lib/usa-lots/money";
import { exactSku } from "@/lib/archive/text";

export interface ParsedSaleLine {
  orderId: string;
  lineItemId: string;
  sku: string;
  variantSku: string;
  title: string;
  ebayItemId: string;
  quantity: number | null;
  soldAt: string;
  itemCents: number | null;
  buyerShippingCents: number | null;
  taxRemittedCents: number | null;
  refundCents: number | null;
  cancelled: boolean;
  paymentStatus: string;
  currency: string;
  allocation: string;
}

interface MoneyTag {
  value?: unknown;
  currency?: unknown;
}

function amount(value: unknown): { cents: number | null; currency: string } {
  if (!value || typeof value !== "object") return { cents: moneyCents(value), currency: "" };
  const tag = value as MoneyTag;
  const currency = tag.currency == null ? "" : String(tag.currency).trim().toUpperCase();
  return { cents: moneyCents(tag.value, currency || "USD"), currency };
}

function sumAmounts(values: unknown[]): number | null {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) {
    const parsed = amount(value);
    if (parsed.cents == null) return null;
    total += parsed.cents;
  }
  return total;
}

function lineRefunds(line: Record<string, unknown>, order: Record<string, unknown>): unknown[] {
  const own = Array.isArray(line.refunds) ? line.refunds : [];
  if (own.length > 0) return own.map((refund) => (refund as { amount?: unknown }).amount ?? refund);
  const summary = order.paymentSummary as { refunds?: unknown[] } | undefined;
  return Array.isArray(summary?.refunds) ? summary.refunds.map((refund) => (refund as { amount?: unknown }).amount ?? refund) : [];
}

export function parseFulfillmentOrders(orders: unknown[]): ParsedSaleLine[] {
  const lines: ParsedSaleLine[] = [];
  for (const entry of orders) {
    if (!entry || typeof entry !== "object") continue;
    const order = entry as Record<string, unknown>;
    const orderId = String(order.orderId ?? "").trim();
    if (!orderId) continue;
    const cancel = String((order.cancelStatus as { cancelState?: unknown } | undefined)?.cancelState ?? "");
    const cancelled = cancel === "CANCELED" || cancel === "CANCELLED";
    const paymentStatus = String(order.orderPaymentStatus ?? "").trim().toUpperCase();
    const soldAt = String(order.creationDate ?? "").trim();
    const rawLines = Array.isArray(order.lineItems) ? order.lineItems : [];
    const parsed = rawLines.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const line = item as Record<string, unknown>;
      const lineItemId = String(line.lineItemId ?? "").trim();
      if (!lineItemId) return [];
      const discounted = amount(line.discountedLineItemCost);
      const list = amount(line.lineItemCost);
      const price = discounted.cents != null ? discounted : list;
      const ownShipping = amount((line.deliveryCost as { shippingCost?: unknown } | undefined)?.shippingCost);
      const taxes = Array.isArray(line.ebayCollectAndRemitTaxes) ? line.ebayCollectAndRemitTaxes : [];
      const tax = sumAmounts(taxes.map((taxRow) => (taxRow as { amount?: unknown }).amount ?? taxRow));
      const quantity = Number(line.quantity);
      return [{
        lineItemId,
        sku: exactSku(line.sku),
        title: String(line.title ?? "").trim(),
        ebayItemId: String(line.legacyItemId ?? "").replace(/\D/g, ""),
        quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : null,
        itemCents: price.cents,
        ownShipping: ownShipping.cents,
        tax,
        weight: price.cents,
        refunds: lineRefunds(line, order),
        lineRefundOnly: Array.isArray(line.refunds) && line.refunds.length > 0,
      }];
    });
    const orderShipping = amount((order.pricingSummary as { deliveryCost?: unknown } | undefined)?.deliveryCost);
    const sharedShipping = parsed.some((line) => line.ownShipping != null)
      ? parsed.map((line) => line.ownShipping)
      : allocateSharedCents(orderShipping.cents, parsed.map((line) => line.weight));
    const orderRefunds = lineRefunds({}, order);
    const refundKnown = parsed.some((line) => line.lineRefundOnly) || orderRefunds.length > 0 || !cancelled;
    const refundShares = !refundKnown
      ? parsed.map(() => null)
      : parsed.some((line) => line.lineRefundOnly)
        ? parsed.map((line) => (line.lineRefundOnly ? sumAmounts(line.refunds) : 0))
        : orderRefunds.length === 0
          ? parsed.map(() => 0)
          : allocateSharedCents(sumAmounts(orderRefunds), parsed.map((line) => line.weight));
    parsed.forEach((line, index) => {
      lines.push({
        orderId,
        lineItemId: line.lineItemId,
        sku: line.sku,
        variantSku: line.sku,
        title: line.title,
        ebayItemId: line.ebayItemId,
        quantity: line.quantity,
        soldAt,
        itemCents: line.itemCents,
        buyerShippingCents: sharedShipping[index] ?? null,
        taxRemittedCents: line.tax,
        refundCents: refundShares[index] ?? null,
        cancelled,
        paymentStatus,
        currency: "USD",
        allocation: SHARED_COST_RULE,
      });
    });
  }
  return lines;
}

const PAID_STATUSES = new Set(["PAID", "PARTIALLY_REFUNDED", "FULLY_REFUNDED"]);

export function saleLinesToStore(lines: ParsedSaleLine[]): ParsedSaleLine[] {
  return lines.filter((line) => line.cancelled || PAID_STATUSES.has(line.paymentStatus));
}

export function isReadOnlyOrderRequest(method: string, path: string): boolean {
  return method.toUpperCase() === "GET" && /\/sell\/fulfillment\/v1\/order(?:\/|$|\?)/.test(path);
}
