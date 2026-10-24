import { GUATEMALA_MARKET } from "@/lib/markets/guatemala";
import { lotExpenseCategoryLabel } from "@/lib/markets/guatemala-lots";
import { formatStoredQuetzales, quetzalPriceText } from "@/lib/markets/guatemala-inventory";
import {
  civilDateKey,
  guatemalaCivilDate,
  parseCivilDate,
  type SalesReportPeriod,
} from "@/lib/markets/guatemala-sales-report";

export const GUATEMALA_EXPENSE_CATEGORIES = [
  { id: "bolsas_etiquetas", label: "Bolsas y etiquetas" },
  { id: "sueldo", label: "Sueldo del empleado" },
  { id: "fotografias", label: "Pago de fotografías" },
  { id: "transporte", label: "Transporte" },
  { id: "servicios", label: "Servicios" },
  { id: "otros", label: "Otros" },
] as const;

export type ExpenseCategory = (typeof GUATEMALA_EXPENSE_CATEGORIES)[number]["id"];

export const GUATEMALA_EXPENSE_MESSAGES = {
  dateInvalid: "Elige la fecha del gasto.",
  categoryInvalid: "Elige una categoría.",
  descriptionRequired: "Escribe una descripción.",
  descriptionLong: "La descripción es demasiado larga.",
  amountInvalid: "Escribe un monto mayor que cero.",
  payeeLong: "El nombre de la persona es demasiado largo.",
  notFound: "No se encontró el gasto.",
  saved: "Gasto registrado.",
  updated: "Gasto actualizado.",
  deleted: "Gasto eliminado.",
  linkedToLot: "Este gasto pertenece a un lote. Corrígelo o anúlalo en Lotes de compra para no contarlo dos veces.",
  retry: "No se pudo guardar el gasto. Inténtalo de nuevo.",
  loadFailed: "No se pudieron cargar los gastos.",
} as const;

const DESCRIPTION_MAX = 500;
const PAYEE_MAX = 120;

export interface PreparedExpense {
  spentOn: string;
  category: ExpenseCategory;
  description: string;
  amountGtq: string;
  payee: string;
  includedInGarmentCost: boolean;
}

export interface StoredExpense extends PreparedExpense {
  id: string;
  clientId: string;
  recordedByRole: "propietario" | "encargado" | null;
  recordedByUsername: string | null;
  lotExpenseId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function expenseCategoryLabel(category: string): string {
  return (
    GUATEMALA_EXPENSE_CATEGORIES.find((entry) => entry.id === category)?.label ??
    lotExpenseCategoryLabel(category)
  );
}

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return GUATEMALA_EXPENSE_CATEGORIES.some((entry) => entry.id === value);
}

export function guatemalaTodayKey(now = new Date()): string {
  return civilDateKey(guatemalaCivilDate(now));
}

export function prepareExpense(input: {
  spentOn?: unknown;
  category?: unknown;
  description?: unknown;
  amount?: unknown;
  payee?: unknown;
  includedInGarmentCost?: unknown;
}): { ok: true; expense: PreparedExpense } | { ok: false; status: 400; error: string } {
  const spentOn = parseCivilDate(typeof input.spentOn === "string" ? input.spentOn : "");
  if (!spentOn) {
    return { ok: false, status: 400, error: GUATEMALA_EXPENSE_MESSAGES.dateInvalid };
  }
  if (!isExpenseCategory(input.category)) {
    return { ok: false, status: 400, error: GUATEMALA_EXPENSE_MESSAGES.categoryInvalid };
  }
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description) {
    return { ok: false, status: 400, error: GUATEMALA_EXPENSE_MESSAGES.descriptionRequired };
  }
  if (description.length > DESCRIPTION_MAX) {
    return { ok: false, status: 400, error: GUATEMALA_EXPENSE_MESSAGES.descriptionLong };
  }
  const amountGtq = quetzalPriceText(input.amount);
  if (!amountGtq) {
    return { ok: false, status: 400, error: GUATEMALA_EXPENSE_MESSAGES.amountInvalid };
  }
  const payee = typeof input.payee === "string" ? input.payee.trim() : "";
  if (payee.length > PAYEE_MAX) {
    return { ok: false, status: 400, error: GUATEMALA_EXPENSE_MESSAGES.payeeLong };
  }
  return {
    ok: true,
    expense: {
      spentOn: civilDateKey(spentOn),
      category: input.category,
      description,
      amountGtq,
      payee,
      includedInGarmentCost: input.category === "fotografias" && input.includedInGarmentCost === true,
    },
  };
}

export function buildExpenseRecord(
  prepared: PreparedExpense,
  meta: {
    id: string;
    clientId: string;
    recordedByRole: StoredExpense["recordedByRole"];
    recordedByUsername: string | null;
    now: Date;
  }
): StoredExpense {
  const stamp = meta.now.toISOString();
  return {
    ...prepared,
    id: meta.id,
    clientId: meta.clientId,
    lotExpenseId: null,
    recordedByRole: meta.recordedByRole,
    recordedByUsername: meta.recordedByUsername,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export function updateExpenseRecord(
  current: readonly StoredExpense[],
  clientId: string,
  id: string,
  prepared: PreparedExpense,
  now: Date
): { ok: true; expenses: StoredExpense[]; expense: StoredExpense } | { ok: false; status: 404; error: string } {
  const existing = current.find((item) => item.id === id && item.clientId === clientId);
  if (!existing) {
    return { ok: false, status: 404, error: GUATEMALA_EXPENSE_MESSAGES.notFound };
  }
  const expense: StoredExpense = {
    ...existing,
    ...prepared,
    clientId: existing.clientId,
    id: existing.id,
    updatedAt: now.toISOString(),
  };
  return {
    ok: true,
    expense,
    expenses: current.map((item) => (item.id === id && item.clientId === clientId ? expense : item)),
  };
}

export function deleteExpenseRecord(
  current: readonly StoredExpense[],
  clientId: string,
  id: string
): { ok: true; expenses: StoredExpense[]; expense: StoredExpense } | { ok: false; status: 404; error: string } {
  const existing = current.find((item) => item.id === id && item.clientId === clientId);
  if (!existing) {
    return { ok: false, status: 404, error: GUATEMALA_EXPENSE_MESSAGES.notFound };
  }
  return {
    ok: true,
    expense: existing,
    expenses: current.filter((item) => !(item.id === id && item.clientId === clientId)),
  };
}

export function expensesInRange(
  expenses: readonly StoredExpense[],
  clientId: string,
  from: string,
  to: string
): StoredExpense[] {
  return expenses
    .filter((expense) => expense.clientId === clientId && expense.spentOn >= from && expense.spentOn <= to)
    .sort((left, right) => {
      const byDate = right.spentOn.localeCompare(left.spentOn);
      if (byDate !== 0) return byDate;
      return right.createdAt.localeCompare(left.createdAt);
    });
}

function quetzalCents(value: string): number {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 100 + Number(match[2]);
}

export function sumExpenseAmounts(expenses: readonly { amountGtq: string }[]): string {
  const cents = expenses.reduce((sum, expense) => sum + quetzalCents(expense.amountGtq), 0);
  return centsToQuetzales(cents);
}

function centsToQuetzales(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export interface ProfitGarment {
  itemId: string;
  soldInPeriod: boolean;
  isTest: boolean;
  voided: boolean;
  chargedPriceGtq: string;
  costGtq: string | null;
  costIncludesPhotography: boolean;
}

export interface ProfitExpense {
  category: ExpenseCategory;
  amountGtq: string;
  includedInGarmentCost: boolean;
  lotExpenseId?: string | null;
}

export interface ProfitSummary {
  salesTotalGtq: string;
  soldCostGtq: string;
  knownCostCount: number;
  missingCostCount: number;
  businessExpensesGtq: string;
  excludedPhotographyGtq: string;
  profitGtq: string;
  partial: boolean;
  warnings: string[];
  photographyNote: string | null;
}

export function garmentCountsTowardProfit(garment: ProfitGarment, includeTests: boolean): boolean {
  if (!garment.soldInPeriod || garment.voided) return false;
  if (!includeTests && garment.isTest) return false;
  return true;
}

// Photography already inside a sold garment's cost is not subtracted again.
// A payment marked as part of a garment cost waits there until that garment is sold.
export function photographyExpenseHeldOut(
  expense: ProfitExpense,
  state: { absorbedBySoldCost: boolean }
): boolean {
  if (expense.lotExpenseId) return false;
  if (expense.category !== "fotografias") return false;
  if (expense.includedInGarmentCost) return true;
  return state.absorbedBySoldCost;
}

// Profit uses the cost of garments sold in the period, not the whole inventory purchase.
export function summarizeGuatemalaProfit(input: {
  garments: readonly ProfitGarment[];
  expenses: readonly ProfitExpense[];
  includeTests: boolean;
}): ProfitSummary {
  const counted = input.garments.filter((garment) => garmentCountsTowardProfit(garment, input.includeTests));
  const withCost = counted.filter((garment) => garment.costGtq);
  const missing = counted.filter((garment) => !garment.costGtq);
  const photographyAbsorbed = withCost.some((garment) => garment.costIncludesPhotography);
  const heldState = { absorbedBySoldCost: photographyAbsorbed };
  const excluded = input.expenses.filter((expense) => photographyExpenseHeldOut(expense, heldState));
  const business = input.expenses.filter((expense) => !photographyExpenseHeldOut(expense, heldState));
  const salesCents = counted.reduce((sum, garment) => sum + quetzalCents(garment.chargedPriceGtq), 0);
  const costCents = withCost.reduce((sum, garment) => sum + quetzalCents(garment.costGtq ?? ""), 0);
  const expenseCents = business.reduce((sum, expense) => sum + quetzalCents(expense.amountGtq), 0);
  const excludedCents = excluded.reduce((sum, expense) => sum + quetzalCents(expense.amountGtq), 0);
  const warnings: string[] = [];
  if (missing.length > 0) {
    warnings.push(
      missing.length === 1
        ? "Falta el costo de 1 prenda vendida. La ganancia es parcial."
        : `Falta el costo de ${missing.length} prendas vendidas. La ganancia es parcial.`
    );
  }
  const flagged = input.expenses.filter(
    (expense) => expense.category === "fotografias" && expense.includedInGarmentCost
  );
  const unmarkedPhotos = input.expenses.filter(
    (expense) => expense.category === "fotografias" && !expense.includedInGarmentCost
  );
  let photographyNote: string | null = null;
  if (flagged.length > 0 && counted.length > 0 && !photographyAbsorbed) {
    warnings.push(
      "Hay pagos de fotografías marcados como parte del costo de una prenda, pero ninguna prenda vendida en este período tiene ese costo. Esos pagos no se restaron otra vez y la ganancia es parcial."
    );
  } else if (photographyAbsorbed && unmarkedPhotos.length > 0) {
    warnings.push(
      "Hay pagos de fotografías sin marcar y el costo de una prenda vendida ya incluye fotografías. No se restaron otra vez. La ganancia es parcial."
    );
  } else if (photographyAbsorbed && flagged.length > 0) {
    photographyNote =
      "Los pagos de fotografías incluidos en el costo de las prendas vendidas no se restan otra vez.";
  } else if (flagged.length > 0) {
    photographyNote =
      "Los pagos de fotografías incluidos en el costo de una prenda no se restan en los gastos. Ese costo se descuenta cuando la prenda se vende.";
  }
  return {
    salesTotalGtq: centsToQuetzales(salesCents),
    soldCostGtq: centsToQuetzales(costCents),
    knownCostCount: withCost.length,
    missingCostCount: missing.length,
    businessExpensesGtq: centsToQuetzales(expenseCents),
    excludedPhotographyGtq: centsToQuetzales(excludedCents),
    profitGtq: centsToQuetzales(salesCents - costCents - expenseCents),
    partial: warnings.length > 0,
    warnings,
    photographyNote,
  };
}

export function soldCostLabel(summary: Pick<ProfitSummary, "soldCostGtq" | "knownCostCount" | "missingCostCount">): string {
  if (summary.missingCostCount > 0 && summary.knownCostCount === 0) return "Incompleto";
  const amount = formatStoredQuetzales(summary.soldCostGtq);
  return summary.missingCostCount > 0 ? `${amount}, incompleto` : amount;
}

export function profitLabel(partial: boolean): "Ganancia" | "Ganancia parcial" {
  return partial ? "Ganancia parcial" : "Ganancia";
}

export function formatSignedQuetzales(value: string): string {
  if (value.startsWith("-")) return `-Q${value.slice(1)}`;
  return `Q${value}`;
}

export function expensePeriodLabel(period: SalesReportPeriod): string {
  if (period === "semana") return "Esta semana";
  if (period === "mes") return "Este mes";
  if (period === "rango") return "Rango";
  return "Hoy";
}

export const GUATEMALA_EXPENSE_TIMEZONE = GUATEMALA_MARKET.timezone;
