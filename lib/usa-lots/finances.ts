import { moneyCents } from "@/lib/usa-lots/money";

function taggedCents(value: unknown): number | null {
  if (!value || typeof value !== "object") return moneyCents(value);
  const tag = value as { value?: unknown; currency?: unknown };
  return moneyCents(tag.value, tag.currency ?? "USD");
}

export function feeFromTransactions(
  body: Record<string, unknown> | null,
  orderId: string
): { feeCents: number | null; sellerShippingCents: number | null } {
  const transactions = Array.isArray(body?.transactions) ? body.transactions : [];
  let fee = 0;
  let shipping = 0;
  let feeSeen = false;
  let shippingSeen = false;
  let feeUnknown = false;
  let shippingUnknown = false;

  const add = (bucket: "fee" | "shipping", cents: number | null) => {
    if (cents == null) {
      if (bucket === "fee") feeUnknown = true;
      else shippingUnknown = true;
      return;
    }
    if (bucket === "fee") {
      fee += Math.abs(cents);
      feeSeen = true;
    } else {
      shipping += Math.abs(cents);
      shippingSeen = true;
    }
  };

  for (const entry of transactions) {
    if (!entry || typeof entry !== "object") continue;
    const transaction = entry as Record<string, unknown>;
    if (String(transaction.orderId ?? "") !== orderId) continue;
    const type = String(transaction.transactionType ?? "");
    if (type === "SALE") {
      if (transaction.totalFeeAmount == null) continue;
      add("fee", taggedCents(transaction.totalFeeAmount));
    } else if (type === "SHIPPING_LABEL") {
      add("shipping", taggedCents(transaction.amount));
    } else if (type === "NON_SALE_CHARGE") {
      const label = String(transaction.feeType ?? transaction.bookingEntry ?? "").toUpperCase();
      add(label.includes("SHIP") ? "shipping" : "fee", taggedCents(transaction.amount));
    }
  }

  return {
    feeCents: feeUnknown || !feeSeen ? null : fee,
    sellerShippingCents: shippingUnknown || !shippingSeen ? null : shipping,
  };
}
