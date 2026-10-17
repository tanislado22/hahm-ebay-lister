import { quetzalPriceText, type RecordedSale, type SaleActor, type SaleGarment } from "@/lib/markets/guatemala-inventory";

export const GUATEMALA_CORRECTION_MESSAGES = {
  reasonRequired: "Escribe el motivo.",
  priceUnchanged: "El precio cobrado no cambió.",
  stale: "Esta venta ya cambió. Revisa el historial antes de continuar.",
  voided: "Esta venta ya fue anulada.",
  notFound: "No se encontró la venta.",
  conflict: "No se pudo anular porque la prenda ya no está vendida.",
  forbidden: "No puedes corregir ni anular ventas.",
} as const;

export type SaleCorrectionAction = "corregir" | "anular";

export interface SaleCorrection {
  id: string;
  saleId: string;
  action: SaleCorrectionAction;
  previousChargedPriceGtq: string;
  newChargedPriceGtq: string | null;
  reason: string;
  createdAt: string;
  actorRole: "propietario";
  actorUsername: string | null;
}

export interface CorrectableSale extends RecordedSale {
  isTest: boolean;
  currentChargedPriceGtq: string | null;
  voidedAt: string | null;
  corrections: SaleCorrection[];
}

export interface CorrectionBook {
  items: SaleGarment[];
  sales: CorrectableSale[];
}

export function saleReasonText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 500) return null;
  return reason;
}

export function effectiveChargedPrice(sale: {
  chargedPriceGtq: string;
  currentChargedPriceGtq?: string | null;
}): string {
  return sale.currentChargedPriceGtq || sale.chargedPriceGtq;
}

export type CorrectionResult =
  | { ok: true; sale: CorrectableSale; available: number; replayed: boolean }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

export function applySaleCorrection(
  book: CorrectionBook,
  input: {
    owner: boolean;
    clientId: string;
    itemId: string;
    action: SaleCorrectionAction;
    correctionId: string;
    reason: unknown;
    chargedPrice?: unknown;
    expectedChargedPrice: string;
    now?: Date;
    actor?: SaleActor | null;
  }
): { book: CorrectionBook; result: CorrectionResult } {
  if (!input.owner || input.actor?.role === "encargado") {
    return { book, result: { ok: false, status: 403, error: GUATEMALA_CORRECTION_MESSAGES.forbidden } };
  }
  const existing = book.sales
    .flatMap((sale) => sale.corrections ?? [])
    .find((correction) => correction.id === input.correctionId);
  if (existing) {
    const sale = book.sales.find((entry) => entry.id === existing.saleId);
    if (!sale || sale.clientId !== input.clientId || sale.itemId !== input.itemId || existing.action !== input.action) {
      return { book, result: { ok: false, status: 409, error: GUATEMALA_CORRECTION_MESSAGES.stale } };
    }
    return {
      book,
      result: { ok: true, sale, available: availableCount(book, sale.clientId), replayed: true },
    };
  }
  const reason = saleReasonText(input.reason);
  if (!reason || !input.correctionId.trim()) {
    return { book, result: { ok: false, status: 400, error: GUATEMALA_CORRECTION_MESSAGES.reasonRequired } };
  }
  const sale = book.sales.find(
    (entry) => entry.itemId === input.itemId && entry.clientId === input.clientId && !entry.voidedAt
  );
  if (!sale) {
    const voided = book.sales.find((entry) => entry.itemId === input.itemId && entry.clientId === input.clientId);
    return {
      book,
      result: {
        ok: false,
        status: voided ? 409 : 404,
        error: voided ? GUATEMALA_CORRECTION_MESSAGES.voided : GUATEMALA_CORRECTION_MESSAGES.notFound,
      },
    };
  }
  const current = effectiveChargedPrice(sale);
  if (current !== input.expectedChargedPrice) {
    return { book, result: { ok: false, status: 409, error: GUATEMALA_CORRECTION_MESSAGES.stale } };
  }
  const item = book.items.find((entry) => entry.id === sale.itemId && entry.clientId === sale.clientId);
  if (!item || item.status !== "vendida") {
    return { book, result: { ok: false, status: 409, error: GUATEMALA_CORRECTION_MESSAGES.conflict } };
  }
  const createdAt = (input.now ?? new Date()).toISOString();
  if (input.action === "anular") {
    const correction: SaleCorrection = {
      id: input.correctionId,
      saleId: sale.id,
      action: "anular",
      previousChargedPriceGtq: current,
      newChargedPriceGtq: null,
      reason,
      createdAt,
      actorRole: "propietario",
      actorUsername: null,
    };
    const nextSale: CorrectableSale = {
      ...sale,
      voidedAt: createdAt,
      corrections: [...sale.corrections, correction],
    };
    const next: CorrectionBook = {
      items: book.items.map((entry) => (entry.id === item.id ? { ...entry, status: "disponible" } : entry)),
      sales: book.sales.map((entry) => (entry.id === sale.id ? nextSale : entry)),
    };
    return {
      book: next,
      result: { ok: true, sale: nextSale, available: availableCount(next, sale.clientId), replayed: false },
    };
  }
  const nextPrice = quetzalPriceText(input.chargedPrice);
  if (!nextPrice) {
    return { book, result: { ok: false, status: 400, error: "Escribe un precio cobrado mayor que cero." } };
  }
  if (nextPrice === current) {
    return { book, result: { ok: false, status: 400, error: GUATEMALA_CORRECTION_MESSAGES.priceUnchanged } };
  }
  const correction: SaleCorrection = {
    id: input.correctionId,
    saleId: sale.id,
    action: "corregir",
    previousChargedPriceGtq: current,
    newChargedPriceGtq: nextPrice,
    reason,
    createdAt,
    actorRole: "propietario",
    actorUsername: null,
  };
  const nextSale: CorrectableSale = {
    ...sale,
    currentChargedPriceGtq: nextPrice,
    corrections: [...sale.corrections, correction],
  };
  const next: CorrectionBook = {
    items: book.items,
    sales: book.sales.map((entry) => (entry.id === sale.id ? nextSale : entry)),
  };
  return {
    book: next,
    result: { ok: true, sale: nextSale, available: availableCount(next, sale.clientId), replayed: false },
  };
}

function availableCount(book: CorrectionBook, clientId: string): number {
  return book.items.filter((entry) => entry.clientId === clientId && entry.status === "disponible").length;
}
