import { quetzalPriceText } from "@/lib/markets/guatemala-inventory";
import { pieceCount } from "@/lib/markets/guatemala-quantity";

export const SKULESS_MESSAGES = {
  piecesRequired: "Escribe las piezas vendidas.",
  priceInvalid: "Escribe el total cobrado en quetzales.",
  saved: "Venta registrada.",
} as const;

export interface PricedPieceLine {
  priceGtq: string;
  pieces: number;
}

export function addPricedPiece(lines: readonly PricedPieceLine[], priceGtq: string): PricedPieceLine[] {
  const index = lines.findIndex((line) => line.priceGtq === priceGtq);
  if (index < 0) return [...lines, { priceGtq, pieces: 1 }];
  return lines.map((line, position) => (position === index ? { ...line, pieces: line.pieces + 1 } : line));
}

export function removePricedPiece(lines: readonly PricedPieceLine[], priceGtq: string): PricedPieceLine[] {
  return lines.flatMap((line) => {
    if (line.priceGtq !== priceGtq) return [line];
    if (line.pieces <= 1) return [];
    return [{ ...line, pieces: line.pieces - 1 }];
  });
}

export function pricedTicket(lines: readonly PricedPieceLine[]): { pieces: number; totalGtq: string } {
  const pieces = lines.reduce((sum, line) => sum + line.pieces, 0);
  const cents = lines.reduce((sum, line) => sum + priceCents(line.priceGtq) * line.pieces, 0);
  return { pieces, totalGtq: centsToQuetzales(cents) };
}

export function skuLessCharge(input: {
  lines: readonly PricedPieceLine[];
  manualPieces?: unknown;
  manualTotal?: unknown;
}): { ok: true; pieces: number; chargedPriceGtq: string } | { ok: false; error: string } {
  const scanned = pricedTicket(input.lines);
  const manualDraft = typeof input.manualTotal === "string" ? input.manualTotal.trim() : "";
  const manualTotal = quetzalPriceText(input.manualTotal);
  const manualPieces = pieceCount(input.manualPieces);
  if (manualDraft && !manualTotal) return { ok: false, error: SKULESS_MESSAGES.priceInvalid };
  if (!manualTotal) {
    if (scanned.pieces < 1) {
      return { ok: false, error: manualPieces ? SKULESS_MESSAGES.priceInvalid : SKULESS_MESSAGES.piecesRequired };
    }
    return { ok: true, pieces: scanned.pieces, chargedPriceGtq: scanned.totalGtq };
  }
  if (!manualPieces) return { ok: false, error: SKULESS_MESSAGES.piecesRequired };
  return {
    ok: true,
    pieces: scanned.pieces + manualPieces,
    chargedPriceGtq: centsToQuetzales(priceCents(scanned.totalGtq) + priceCents(manualTotal)),
  };
}

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
  return centsToQuetzales(priceCents(left) + priceCents(right));
}

function centsToQuetzales(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function priceCents(value: string): number {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 100 + Number(match[2]);
}
