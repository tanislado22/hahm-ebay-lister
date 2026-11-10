import { quetzalPriceText } from "@/lib/markets/guatemala-inventory";
import { pieceCount } from "@/lib/markets/guatemala-quantity";

export const SKULESS_MESSAGES = {
  piecesRequired: "Escribe las piezas vendidas.",
  priceInvalid: "Escribe el total cobrado en quetzales.",
  saved: "Venta registrada.",
} as const;

export interface SkuLessSale {
  requestId: string;
  pieces: number;
  chargedPriceGtq: string;
  lotId: null;
}

export interface SkuLessBook {
  sales: SkuLessSale[];
  pieces: number;
  recoveredGtq: string;
  inventoryCount: number;
}

export function prepareSkuLessSale(input: {
  pieces?: unknown;
  chargedPrice?: unknown;
  requestId?: unknown;
}): { ok: true; sale: SkuLessSale } | { ok: false; error: string } {
  const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
  if (!requestId) return { ok: false, error: "No se pudo identificar la venta." };
  const pieces = pieceCount(input.pieces);
  if (!pieces) return { ok: false, error: SKULESS_MESSAGES.piecesRequired };
  const chargedPriceGtq = quetzalPriceText(input.chargedPrice);
  if (!chargedPriceGtq) return { ok: false, error: SKULESS_MESSAGES.priceInvalid };
  return { ok: true, sale: { requestId, pieces, chargedPriceGtq, lotId: null } };
}

export function applySkuLessSale(
  book: SkuLessBook,
  input: { pieces?: unknown; chargedPrice?: unknown; requestId?: unknown }
): { book: SkuLessBook; result: { ok: true; chargedPriceGtq: string; pieces: number; already: boolean } | { ok: false; error: string } } {
  const prepared = prepareSkuLessSale(input);
  if (!prepared.ok) return { book, result: prepared };
  const previous = book.sales.find((sale) => sale.requestId === prepared.sale.requestId);
  if (previous) {
    return { book, result: { ok: true, chargedPriceGtq: previous.chargedPriceGtq, pieces: book.pieces, already: true } };
  }
  const recoveredGtq = addQuetzales(book.recoveredGtq, prepared.sale.chargedPriceGtq);
  return {
    book: {
      inventoryCount: book.inventoryCount,
      pieces: book.pieces + prepared.sale.pieces,
      recoveredGtq,
      sales: [...book.sales, prepared.sale],
    },
    result: { ok: true, chargedPriceGtq: prepared.sale.chargedPriceGtq, pieces: book.pieces + prepared.sale.pieces, already: false },
  };
}

function addQuetzales(left: string, right: string): string {
  const cents = priceCents(left) + priceCents(right);
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function priceCents(value: string): number {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 100 + Number(match[2]);
}
