"use client";

import { formatStoredQuetzales } from "@/lib/markets/guatemala-inventory";
import {
  SALE_PAYMENT_MESSAGES,
  cashTender,
  changeDueLabel,
  type SalePaymentMethod,
} from "@/lib/markets/guatemala-sale-payment";

export function SaleTender({
  chargedPrice,
  method,
  cashDraft,
  onCashDraft,
  onMethod,
}: {
  chargedPrice: string | null;
  method: SalePaymentMethod;
  cashDraft: string;
  onCashDraft: (value: string) => void;
  onMethod: (method: SalePaymentMethod) => void;
}) {
  const tender = chargedPrice && method === "efectivo" ? cashTender(chargedPrice, cashDraft) : null;
  return (
    <div className="gt-sale-tender">
      <div className="gt-sale-methods" role="group" aria-label="Método de pago">
        <button type="button" className="gt-filter" aria-pressed={method === "efectivo"} onClick={() => onMethod("efectivo")}>
          Efectivo
        </button>
        <button type="button" className="gt-filter" aria-pressed={method === "transferencia"} onClick={() => onMethod("transferencia")}>
          Transferencia
        </button>
      </div>
      {chargedPrice ? <p>Total de la compra {formatStoredQuetzales(chargedPrice)}</p> : null}
      {method === "efectivo" ? (
        <>
          <label htmlFor="cash-received">Efectivo recibido</label>
          <div className="gt-sale-price">
            <span aria-hidden="true">Q</span>
            <input
              id="cash-received"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="0.00"
              value={cashDraft}
              onChange={(event) => onCashDraft(event.target.value)}
            />
          </div>
          {tender?.state === "covered" ? (
            <p className="gt-change-due" aria-live="polite">{changeDueLabel(tender.changeGtq)}</p>
          ) : null}
          {tender?.state === "short" ? (
            <p className="gt-change-short" role="alert">{SALE_PAYMENT_MESSAGES.short(tender.missingGtq)}</p>
          ) : null}
          {tender?.state === "invalid" ? (
            <p className="note note-error" role="alert">{SALE_PAYMENT_MESSAGES.cashInvalid}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
