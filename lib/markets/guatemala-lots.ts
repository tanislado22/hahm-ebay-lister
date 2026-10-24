import { quetzalPriceText, type SaleActor } from "@/lib/markets/guatemala-inventory";
import { civilDateKey, parseCivilDate } from "@/lib/markets/guatemala-sales-report";

export const GUATEMALA_LOT_PENDING_COUNT = "Pendiente de conteo";

export const GUATEMALA_LOT_EXPENSE_CATEGORIES = [
  { id: "compra", label: "Compra" },
  { id: "envio", label: "Envío" },
  { id: "recoger", label: "Recoger mercancía" },
  { id: "seleccion", label: "Selección" },
  { id: "fotografias", label: "Fotografías" },
  { id: "etiquetas", label: "Etiquetas" },
  { id: "otros", label: "Otros" },
] as const;

export type LotExpenseCategory = (typeof GUATEMALA_LOT_EXPENSE_CATEGORIES)[number]["id"];
export type LotRecordStatus = "activo" | "anulado";

export const GUATEMALA_LOT_MESSAGES = {
  numberInvalid: "Escribe un número de lote mayor que cero.",
  numberTaken: "Ese número de lote ya se usó. Elige otro.",
  nameRequired: "Escribe el nombre del lote.",
  nameLong: "El nombre del lote es demasiado largo.",
  dateInvalid: "Elige la fecha del lote.",
  supplierLong: "El nombre del proveedor es demasiado largo.",
  weightInvalid: "El peso debe ser un número mayor que cero, o déjalo en blanco.",
  notesLong: "Las notas son demasiado largas.",
  countInvalid: "La cantidad vendible debe ser un número entero mayor que cero.",
  notFound: "No se encontró el lote.",
  voided: "Ese lote está anulado.",
  expenseNotFound: "No se encontró el gasto.",
  expenseVoided: "Ese gasto ya está anulado.",
  requestRequired: "No se pudo identificar este guardado. Inténtalo de nuevo.",
  categoryInvalid: "Elige una categoría.",
  descriptionRequired: "Escribe una descripción.",
  descriptionLong: "La descripción es demasiado larga.",
  amountInvalid: "Escribe un monto mayor que cero.",
  payeeLong: "El nombre de la persona es demasiado largo.",
  saved: "Lote guardado.",
  expenseSaved: "Gasto registrado.",
  expenseUpdated: "Gasto actualizado.",
  expenseVoidedNotice: "Gasto anulado.",
  lotUpdated: "Lote actualizado.",
  lotVoided: "Lote anulado.",
  assigned: "La prenda quedó en el lote. El SKU no cambió.",
  skuSuggested: "Revisa el SKU antes de guardar.",
  notProfit: "El costo promedio no es la ganancia. El precio de venta no cambia al agregar gastos.",
} as const;

const NAME_MAX = 120;
const SUPPLIER_MAX = 120;
const NOTES_MAX = 1000;
const DESCRIPTION_MAX = 500;
const PAYEE_MAX = 120;

export interface PreparedLot {
  lotNumber: number | null;
  name: string;
  receivedOn: string;
  supplier: string;
  weightText: string;
  notes: string;
  sellableCount: number | null;
}

export interface LotExpenseDraft {
  requestId: string;
  spentOn: string;
  category: LotExpenseCategory;
  description: string;
  amountGtq: string;
  payee: string;
}

export interface LotExpenseRecord extends LotExpenseDraft {
  id: string;
  lotId: string;
  status: LotRecordStatus;
  createdBy: SaleActor | null;
}

export interface LotExpenseRevision {
  expenseId: string;
  previousAmountGtq: string;
  previousDescription: string;
  previousCategory: LotExpenseCategory;
  previousStatus: LotRecordStatus;
  changedBy: SaleActor | null;
}

export function lotExpenseCategoryLabel(category: string): string {
  return GUATEMALA_LOT_EXPENSE_CATEGORIES.find((entry) => entry.id === category)?.label ?? category;
}

export function isLotExpenseCategory(value: unknown): value is LotExpenseCategory {
  return GUATEMALA_LOT_EXPENSE_CATEGORIES.some((entry) => entry.id === value);
}

export function preparePurchaseLot(input: {
  lotNumber?: unknown;
  name?: unknown;
  receivedOn?: unknown;
  supplier?: unknown;
  weight?: unknown;
  notes?: unknown;
  sellableCount?: unknown;
}): { ok: true; lot: PreparedLot } | { ok: false; status: 400; error: string } {
  let lotNumber: number | null = null;
  if (input.lotNumber !== undefined && input.lotNumber !== null && input.lotNumber !== "") {
    const parsed = parsePositiveInteger(input.lotNumber);
    if (parsed == null) return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.numberInvalid };
    lotNumber = parsed;
  }
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.nameRequired };
  if (name.length > NAME_MAX) return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.nameLong };
  const received = parseCivilDate(typeof input.receivedOn === "string" ? input.receivedOn : "");
  if (!received) return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.dateInvalid };
  const supplier = typeof input.supplier === "string" ? input.supplier.trim() : "";
  if (supplier.length > SUPPLIER_MAX) return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.supplierLong };
  const weightText = typeof input.weight === "string" ? input.weight.trim() : "";
  if (weightText && !/^\d+(\.\d{1,3})?$/.test(weightText)) {
    return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.weightInvalid };
  }
  if (weightText && Number(weightText) <= 0) {
    return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.weightInvalid };
  }
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (notes.length > NOTES_MAX) return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.notesLong };
  let sellableCount: number | null = null;
  if (input.sellableCount !== undefined && input.sellableCount !== null && input.sellableCount !== "") {
    const parsed = parsePositiveInteger(input.sellableCount);
    if (parsed == null) return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.countInvalid };
    sellableCount = parsed;
  }
  return {
    ok: true,
    lot: {
      lotNumber,
      name,
      receivedOn: civilDateKey(received),
      supplier,
      weightText,
      notes,
      sellableCount,
    },
  };
}

export function prepareLotExpense(input: {
  requestId?: unknown;
  spentOn?: unknown;
  category?: unknown;
  description?: unknown;
  amount?: unknown;
  payee?: unknown;
}): { ok: true; expense: LotExpenseDraft } | { ok: false; status: 400; error: string } {
  const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.requestRequired };
  }
  const spent = parseCivilDate(typeof input.spentOn === "string" ? input.spentOn : "");
  if (!spent) return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.dateInvalid };
  if (!isLotExpenseCategory(input.category)) {
    return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.categoryInvalid };
  }
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description) return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.descriptionRequired };
  if (description.length > DESCRIPTION_MAX) return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.descriptionLong };
  const amountGtq = quetzalPriceText(input.amount);
  if (!amountGtq) return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.amountInvalid };
  const payee = typeof input.payee === "string" ? input.payee.trim() : "";
  if (payee.length > PAYEE_MAX) return { ok: false, status: 400, error: GUATEMALA_LOT_MESSAGES.payeeLong };
  return {
    ok: true,
    expense: {
      requestId,
      spentOn: civilDateKey(spent),
      category: input.category,
      description,
      amountGtq,
      payee,
    },
  };
}

export function lotNumberIsAvailable(usedNumbers: readonly number[], requested: number): boolean {
  return !usedNumbers.includes(requested);
}

export function nextLotNumber(usedNumbers: readonly number[]): number {
  return usedNumbers.reduce((max, value) => (value > max ? value : max), 0) + 1;
}

function parsePositiveInteger(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^[1-9]\d*$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function quetzalCents(value: string): number {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 100 + Number(match[2]);
}

function formatCents(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

export function activeLotTotalGtq(expenses: readonly { amountGtq: string; status: LotRecordStatus }[]): string {
  const cents = expenses.reduce((sum, expense) => {
    if (expense.status !== "activo") return sum;
    return sum + quetzalCents(expense.amountGtq);
  }, 0);
  return formatCents(cents);
}

export function lotAverageCost(totalGtq: string, sellableCount: number | null): {
  pending: boolean;
  label: string;
  averageGtq: string | null;
} {
  if (sellableCount == null || sellableCount <= 0) {
    return { pending: true, label: GUATEMALA_LOT_PENDING_COUNT, averageGtq: null };
  }
  const averageCents = Math.round(quetzalCents(totalGtq) / sellableCount);
  const averageGtq = formatCents(averageCents);
  return { pending: false, label: `Q${averageGtq}`, averageGtq };
}

export function sellableCountAfterSale(sellableCount: number | null): number | null {
  return sellableCount;
}

export function nextLotSku(lotNumber: number, skus: readonly string[]): string {
  const pattern = new RegExp(`^L${lotNumber}-(\\d+)$`);
  let max = 0;
  for (const sku of skus) {
    const match = pattern.exec(sku);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > max) max = value;
  }
  return `L${lotNumber}-${max + 1}`;
}

export function assignItemToLot<T extends { sku: string }>(item: T, lotId: string): T & { lotId: string } {
  return { ...item, sku: item.sku, lotId };
}

export function addLotExpenseOnce(
  expenses: readonly LotExpenseRecord[],
  incoming: LotExpenseRecord
): { expenses: LotExpenseRecord[]; expense: LotExpenseRecord; created: boolean } {
  const existing = expenses.find((expense) => expense.requestId === incoming.requestId);
  if (existing) return { expenses: [...expenses], expense: existing, created: false };
  return { expenses: [...expenses, incoming], expense: incoming, created: true };
}

export function correctLotExpense(
  expenses: readonly LotExpenseRecord[],
  expenseId: string,
  next: Pick<LotExpenseDraft, "spentOn" | "category" | "description" | "amountGtq" | "payee">,
  actor: SaleActor | null
): { ok: true; expenses: LotExpenseRecord[]; revision: LotExpenseRevision } | { ok: false; error: string } {
  const current = expenses.find((expense) => expense.id === expenseId);
  if (!current) return { ok: false, error: GUATEMALA_LOT_MESSAGES.expenseNotFound };
  if (current.status !== "activo") return { ok: false, error: GUATEMALA_LOT_MESSAGES.expenseVoided };
  const revision: LotExpenseRevision = {
    expenseId,
    previousAmountGtq: current.amountGtq,
    previousDescription: current.description,
    previousCategory: current.category,
    previousStatus: current.status,
    changedBy: actor,
  };
  return {
    ok: true,
    revision,
    expenses: expenses.map((expense) => (expense.id === expenseId ? { ...expense, ...next, status: "activo" as const } : expense)),
  };
}

export function voidLotExpense(
  expenses: readonly LotExpenseRecord[],
  expenseId: string,
  actor: SaleActor | null
): { ok: true; expenses: LotExpenseRecord[]; revision: LotExpenseRevision } | { ok: false; error: string } {
  const current = expenses.find((expense) => expense.id === expenseId);
  if (!current) return { ok: false, error: GUATEMALA_LOT_MESSAGES.expenseNotFound };
  if (current.status !== "activo") return { ok: false, error: GUATEMALA_LOT_MESSAGES.expenseVoided };
  const revision: LotExpenseRevision = {
    expenseId,
    previousAmountGtq: current.amountGtq,
    previousDescription: current.description,
    previousCategory: current.category,
    previousStatus: current.status,
    changedBy: actor,
  };
  return {
    ok: true,
    revision,
    expenses: expenses.map((expense) => (expense.id === expenseId ? { ...expense, status: "anulado" as const } : expense)),
  };
}

export function lotArticleCounts(items: readonly { lotId: string; status: string }[], lotId: string): {
  registered: number;
  available: number;
  sold: number;
} {
  const own = items.filter((item) => item.lotId === lotId);
  return {
    registered: own.length,
    available: own.filter((item) => item.status === "disponible").length,
    sold: own.filter((item) => item.status === "vendida").length,
  };
}
