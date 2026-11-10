import { quetzalPriceText } from "@/lib/markets/guatemala-inventory";

export const QUANTITY_MESSAGES = {
  nameRequired: "Escribe el nombre del grupo.",
  lotRequired: "Selecciona el lote.",
  quantityRequired: "Escribe una cantidad de piezas mayor que cero.",
  emptySale: "Agrega piezas de un grupo o una prenda con SKU.",
  alreadySold: "Esta prenda ya fue vendida. No se puede registrar otra venta.",
  withdrawn: "Esta prenda está retirada. No se puede registrar una venta.",
  itemMissing: "No se encontró la prenda.",
  groupMissing: "No se encontró el grupo.",
  priceInvalid: "Escribe el total cobrado en quetzales.",
  saved: "Venta registrada.",
} as const;

export interface QuantityGroupView {
  id: string;
  name: string;
  lotId: string;
  lotNumber: number | null;
  lotName: string | null;
  initialQuantity: number;
  soldQuantity: number;
  available: number;
}

export interface QuantityGroupState {
  id: string;
  lotId: string;
  name: string;
  initialQuantity: number;
  soldQuantity: number;
}

export interface QuantityPieceLine {
  groupId: string;
  quantity: number;
}

export interface TicketItem {
  id: string;
  sku: string;
  status: string;
  lotId: string | null;
}

export interface QuantityCheckout {
  requestId: string;
  chargedPriceGtq: string;
  pieces: QuantityPieceLine[];
  itemIds: string[];
}

export interface QuantityBook {
  groups: QuantityGroupState[];
  items: TicketItem[];
  checkouts: QuantityCheckout[];
  lotSellable: Record<string, number>;
}

export function groupAvailable(group: { initialQuantity: number; soldQuantity: number }): number {
  return Math.max(0, group.initialQuantity - group.soldQuantity);
}

export function quantityStockMessage(name: string, available: number): string {
  return `Quedan ${available} piezas en ${name}.`;
}

export function pieceCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100000) return value;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) return null;
  return parsed;
}

/**
 * The pieces already belong to the lot count. Creating the group assigns them
 * and does not add them to the lot again.
 */
export function prepareQuantityGroup(input: {
  name?: unknown;
  lotId?: unknown;
  quantity?: unknown;
}): { ok: true; name: string; lotId: string; quantity: number; lotPieceDelta: 0 } | { ok: false; error: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const lotId = typeof input.lotId === "string" ? input.lotId.trim() : "";
  const quantity = pieceCount(input.quantity);
  if (!name || name.length > 80) return { ok: false, error: QUANTITY_MESSAGES.nameRequired };
  if (!lotId) return { ok: false, error: QUANTITY_MESSAGES.lotRequired };
  if (!quantity) return { ok: false, error: QUANTITY_MESSAGES.quantityRequired };
  return { ok: true, name, lotId, quantity, lotPieceDelta: 0 };
}

export function prepareQuantityCheckout(input: {
  groups: readonly QuantityGroupState[];
  pieceLines: readonly { groupId?: unknown; quantity?: unknown }[];
  items: readonly TicketItem[];
  itemIds: readonly unknown[];
  chargedPrice: unknown;
  requestId: unknown;
}):
  | { ok: true; requestId: string; chargedPriceGtq: string; pieces: QuantityPieceLine[]; itemIds: string[] }
  | { ok: false; error: string } {
  const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
  if (!requestId) return { ok: false, error: "No se pudo identificar la venta." };
  const chargedPriceGtq = quetzalPriceText(input.chargedPrice);
  if (!chargedPriceGtq) return { ok: false, error: QUANTITY_MESSAGES.priceInvalid };

  const merged = new Map<string, number>();
  for (const line of input.pieceLines) {
    const groupId = typeof line.groupId === "string" ? line.groupId.trim() : "";
    const quantity = pieceCount(line.quantity);
    if (!groupId || !quantity) return { ok: false, error: QUANTITY_MESSAGES.quantityRequired };
    merged.set(groupId, (merged.get(groupId) ?? 0) + quantity);
  }
  const pieces: QuantityPieceLine[] = [];
  for (const [groupId, quantity] of merged) {
    const group = input.groups.find((candidate) => candidate.id === groupId);
    if (!group) return { ok: false, error: QUANTITY_MESSAGES.groupMissing };
    const available = groupAvailable(group);
    if (quantity > available) return { ok: false, error: quantityStockMessage(group.name, available) };
    pieces.push({ groupId, quantity });
  }

  const itemIds: string[] = [];
  for (const value of input.itemIds) {
    const itemId = typeof value === "string" ? value.trim() : "";
    if (!itemId || itemIds.includes(itemId)) continue;
    const item = input.items.find((candidate) => candidate.id === itemId);
    if (!item) return { ok: false, error: QUANTITY_MESSAGES.itemMissing };
    if (item.status === "vendida") return { ok: false, error: QUANTITY_MESSAGES.alreadySold };
    if (item.status === "retirada") return { ok: false, error: QUANTITY_MESSAGES.withdrawn };
    if (item.status !== "disponible") return { ok: false, error: QUANTITY_MESSAGES.alreadySold };
    itemIds.push(itemId);
  }
  if (pieces.length === 0 && itemIds.length === 0) return { ok: false, error: QUANTITY_MESSAGES.emptySale };
  return { ok: true, requestId, chargedPriceGtq, pieces, itemIds };
}

export function lotSoldPieces(book: QuantityBook, lotId: string): number {
  const fromItems = book.items.filter((item) => item.lotId === lotId && item.status === "vendida").length;
  const fromGroups = book.checkouts.reduce((sum, checkout) => {
    return (
      sum +
      checkout.pieces.reduce((pieceSum, line) => {
        const group = book.groups.find((candidate) => candidate.id === line.groupId);
        return group?.lotId === lotId ? pieceSum + line.quantity : pieceSum;
      }, 0)
    );
  }, 0);
  return fromItems + fromGroups;
}

export function applyQuantityGroup(book: QuantityBook, input: { name?: unknown; lotId?: unknown; quantity?: unknown; id: string }): {
  book: QuantityBook;
  result: { ok: true; lotPieceDelta: 0 } | { ok: false; error: string };
} {
  const prepared = prepareQuantityGroup(input);
  if (!prepared.ok) return { book, result: prepared };
  return {
    book: {
      ...book,
      lotSellable: { ...book.lotSellable },
      groups: [
        ...book.groups,
        {
          id: input.id,
          lotId: prepared.lotId,
          name: prepared.name,
          initialQuantity: prepared.quantity,
          soldQuantity: 0,
        },
      ],
    },
    result: { ok: true, lotPieceDelta: prepared.lotPieceDelta },
  };
}

export function applyQuantityCheckout(
  book: QuantityBook,
  input: {
    pieceLines: readonly { groupId?: unknown; quantity?: unknown }[];
    itemIds: readonly unknown[];
    chargedPrice: unknown;
    requestId: unknown;
  }
): { book: QuantityBook; result: { ok: true; chargedPriceGtq: string; already: boolean } | { ok: false; error: string } } {
  const prepared = prepareQuantityCheckout({ ...input, groups: book.groups, items: book.items });
  if (!prepared.ok) return { book, result: prepared };
  const previous = book.checkouts.find((checkout) => checkout.requestId === prepared.requestId);
  if (previous) return { book, result: { ok: true, chargedPriceGtq: previous.chargedPriceGtq, already: true } };
  return {
    book: {
      ...book,
      lotSellable: { ...book.lotSellable },
      groups: book.groups.map((group) => {
        const line = prepared.pieces.find((piece) => piece.groupId === group.id);
        return line ? { ...group, soldQuantity: group.soldQuantity + line.quantity } : group;
      }),
      items: book.items.map((item) => (prepared.itemIds.includes(item.id) ? { ...item, status: "vendida" } : item)),
      checkouts: [
        ...book.checkouts,
        {
          requestId: prepared.requestId,
          chargedPriceGtq: prepared.chargedPriceGtq,
          pieces: prepared.pieces,
          itemIds: prepared.itemIds,
        },
      ],
    },
    result: { ok: true, chargedPriceGtq: prepared.chargedPriceGtq, already: false },
  };
}

export function checkoutReportTitle(
  lines: readonly { kind: "cantidad" | "sku"; label: string; quantity: number }[]
): string {
  if (lines.length === 0) return "Venta por cantidad";
  return lines
    .map((line) => (line.kind === "cantidad" ? `${line.label} · ${line.quantity} piezas` : `SKU ${line.label}`))
    .join(" · ");
}
