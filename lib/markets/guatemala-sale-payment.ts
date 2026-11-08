import { quetzalPriceText } from "@/lib/markets/guatemala-inventory";

export type SalePaymentMethod = "efectivo" | "transferencia";

export const SALE_PAYMENT_MESSAGES = {
  methodRequired: "Elige si el pago es en efectivo o por transferencia.",
  cashRequired: "Escribe el efectivo recibido.",
  cashInvalid: "Escribe un efectivo recibido mayor que cero.",
  short: (missingGtq: string) => `Falta Q${missingGtq}. No se puede confirmar la venta.`,
} as const;

export interface PreparedSalePayment {
  method: SalePaymentMethod;
  chargedPriceGtq: string;
  cashReceivedGtq: string | null;
  changeGtq: string | null;
  incomeGtq: string;
}

export type CashTender =
  | { state: "empty" }
  | { state: "invalid" }
  | { state: "short"; receivedGtq: string; missingGtq: string }
  | { state: "covered"; receivedGtq: string; changeGtq: string };

export function salePaymentMethod(value: unknown): SalePaymentMethod | null {
  if (value === "efectivo" || value === "transferencia") return value;
  return null;
}

export function cashTender(chargedPriceGtq: string, receivedRaw: unknown): CashTender {
  if (typeof receivedRaw !== "string" || receivedRaw.trim() === "") return { state: "empty" };
  const receivedGtq = quetzalPriceText(receivedRaw);
  if (!receivedGtq) return { state: "invalid" };
  const difference = quetzalCents(receivedGtq) - quetzalCents(chargedPriceGtq);
  if (difference < 0) {
    return { state: "short", receivedGtq, missingGtq: centsToQuetzales(-difference) };
  }
  return { state: "covered", receivedGtq, changeGtq: centsToQuetzales(difference) };
}

export function changeDueLabel(changeGtq: string): string {
  return `Cambio a entregar: Q${changeGtq}`;
}

// The shop's income is the price charged, never the bill the buyer handed over.
export function saleIncomeGtq(sale: { chargedPriceGtq: string; cashReceivedGtq?: string | null }): string {
  return sale.chargedPriceGtq;
}

export function prepareSalePayment(input: {
  method?: unknown;
  chargedPrice: unknown;
  cashReceived?: unknown;
}): { ok: true; payment: PreparedSalePayment } | { ok: false; status: 400; error: string } {
  const chargedPriceGtq = quetzalPriceText(input.chargedPrice);
  if (!chargedPriceGtq) return { ok: false, status: 400, error: "Escribe un precio cobrado mayor que cero." };
  const method = salePaymentMethod(input.method);
  if (!method) return { ok: false, status: 400, error: SALE_PAYMENT_MESSAGES.methodRequired };
  if (method === "transferencia") {
    return {
      ok: true,
      payment: {
        method,
        chargedPriceGtq,
        cashReceivedGtq: null,
        changeGtq: null,
        incomeGtq: chargedPriceGtq,
      },
    };
  }
  const tender = cashTender(chargedPriceGtq, typeof input.cashReceived === "string" ? input.cashReceived : "");
  if (tender.state === "empty") return { ok: false, status: 400, error: SALE_PAYMENT_MESSAGES.cashRequired };
  if (tender.state === "invalid") return { ok: false, status: 400, error: SALE_PAYMENT_MESSAGES.cashInvalid };
  if (tender.state === "short") return { ok: false, status: 400, error: SALE_PAYMENT_MESSAGES.short(tender.missingGtq) };
  return {
    ok: true,
    payment: {
      method,
      chargedPriceGtq,
      cashReceivedGtq: tender.receivedGtq,
      changeGtq: tender.changeGtq,
      incomeGtq: chargedPriceGtq,
    },
  };
}

export function saleMayBeConfirmed(payment: { ok: boolean }): boolean {
  return payment.ok;
}

function quetzalCents(value: string): number {
  const [whole, fraction = "00"] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

function centsToQuetzales(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
