import { describe, expect, it } from "vitest";
import { prepareGarmentCost } from "@/lib/markets/guatemala-inventory";
import {
  buildExpenseRecord,
  deleteExpenseRecord,
  expensesInRange,
  GUATEMALA_EXPENSE_CATEGORIES,
  prepareExpense,
  profitLabel,
  soldCostLabel,
  summarizeGuatemalaProfit,
  sumExpenseAmounts,
  updateExpenseRecord,
  type ProfitGarment,
  type StoredExpense,
} from "@/lib/markets/guatemala-expenses";
import { guatemalaSalesRange } from "@/lib/markets/guatemala-sales-report";

const now = new Date("2026-10-17T04:50:00.000Z");

function garment(partial: Partial<ProfitGarment> & Pick<ProfitGarment, "itemId" | "chargedPriceGtq">): ProfitGarment {
  return {
    soldInPeriod: true,
    isTest: false,
    voided: false,
    costGtq: null,
    costIncludesPhotography: false,
    ...partial,
  };
}

function expense(partial: Partial<StoredExpense> & Pick<StoredExpense, "id" | "clientId" | "amountGtq">): StoredExpense {
  const prepared = prepareExpense({
    spentOn: partial.spentOn ?? "2026-10-16",
    category: partial.category ?? "transporte",
    description: partial.description ?? "Flete",
    amount: partial.amountGtq,
    payee: partial.payee ?? "",
    includedInGarmentCost: partial.includedInGarmentCost ?? false,
  });
  if (!prepared.ok) throw new Error(prepared.error);
  return buildExpenseRecord(prepared.expense, {
    id: partial.id,
    clientId: partial.clientId,
    recordedByRole: partial.recordedByRole ?? "encargado",
    recordedByUsername: partial.recordedByUsername ?? "ana",
    now,
  });
}

describe("gastos de Tienda Guatemala", () => {
  it("acepta el formulario y rechaza monto, fecha, categoría y descripción inválidos", () => {
    const saved = prepareExpense({
      spentOn: "2026-10-16",
      category: "sueldo",
      description: "  Semana de caja  ",
      amount: "150.5",
      payee: "  Luis  ",
    });
    expect(saved.ok && saved.expense).toMatchObject({
      spentOn: "2026-10-16",
      category: "sueldo",
      description: "Semana de caja",
      amountGtq: "150.50",
      payee: "Luis",
      includedInGarmentCost: false,
    });
    expect(prepareExpense({ spentOn: "2026-10-16", category: "transporte", description: "Bus", amount: "0" }).ok).toBe(false);
    expect(prepareExpense({ spentOn: "2026-10-16", category: "transporte", description: "Bus", amount: "-5" }).ok).toBe(false);
    expect(prepareExpense({ spentOn: "2026-02-31", category: "transporte", description: "Bus", amount: "5" }).ok).toBe(false);
    expect(prepareExpense({ spentOn: "2026-10-16", category: "compra", description: "Bus", amount: "5" }).ok).toBe(false);
    expect(prepareExpense({ spentOn: "2026-10-16", category: "transporte", description: "   ", amount: "5" }).ok).toBe(false);
    expect(GUATEMALA_EXPENSE_CATEGORIES.map((category) => category.label)).toEqual([
      "Bolsas y etiquetas",
      "Sueldo del empleado",
      "Pago de fotografías",
      "Transporte",
      "Servicios",
      "Otros",
    ]);
  });

  it("solo marca fotografías como parte del costo de una prenda", () => {
    const photo = prepareExpense({
      spentOn: "2026-10-16",
      category: "fotografias",
      description: "Sesión",
      amount: "20",
      includedInGarmentCost: true,
    });
    expect(photo.ok && photo.expense.includedInGarmentCost).toBe(true);
    const ride = prepareExpense({
      spentOn: "2026-10-16",
      category: "transporte",
      description: "Bus",
      amount: "20",
      includedInGarmentCost: true,
    });
    expect(ride.ok && ride.expense.includedInGarmentCost).toBe(false);
  });

  it("guarda, consulta, edita y elimina sin mezclar clientes", () => {
    const first = expense({ id: "gasto-1", clientId: "tienda", amountGtq: "12.00", description: "Bolsas" });
    const other = expense({
      id: "gasto-2",
      clientId: "my-store",
      amountGtq: "80.00",
      description: "Otra tienda",
      spentOn: "2026-10-16",
    });
    let book = [first, other];
    const today = guatemalaSalesRange({ period: "hoy", now });
    expect(today.ok).toBe(true);
    if (!today.ok) return;
    expect(expensesInRange(book, "tienda", today.range.from, today.range.to).map((item) => item.id)).toEqual(["gasto-1"]);
    expect(expensesInRange(book, "my-store", today.range.from, today.range.to)).toHaveLength(1);
    expect(sumExpenseAmounts(expensesInRange(book, "tienda", today.range.from, today.range.to))).toBe("12.00");

    const edited = prepareExpense({
      spentOn: "2026-10-16",
      category: "servicios",
      description: "Internet",
      amount: "25",
      payee: "Claro",
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const updated = updateExpenseRecord(book, "tienda", "gasto-1", edited.expense, now);
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    book = updated.expenses;
    expect(updated.expense.clientId).toBe("tienda");
    expect(updated.expense.amountGtq).toBe("25.00");
    expect(updated.expense.payee).toBe("Claro");
    expect(book.find((item) => item.id === "gasto-2")?.amountGtq).toBe("80.00");
    expect(updateExpenseRecord(book, "my-store", "gasto-1", edited.expense, now).ok).toBe(false);

    const removed = deleteExpenseRecord(book, "tienda", "gasto-1");
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.expenses.map((item) => item.id)).toEqual(["gasto-2"]);
    expect(deleteExpenseRecord(removed.expenses, "tienda", "gasto-2").ok).toBe(false);
    expect(removed.expenses).toHaveLength(1);
  });

  it("filtra hoy, esta semana, este mes y un rango en el calendario de Guatemala", () => {
    const book = [
      expense({ id: "hoy", clientId: "tienda", amountGtq: "1.00", spentOn: "2026-10-16" }),
      expense({ id: "lunes", clientId: "tienda", amountGtq: "2.00", spentOn: "2026-10-12" }),
      expense({ id: "mes", clientId: "tienda", amountGtq: "4.00", spentOn: "2026-10-01" }),
      expense({ id: "fuera", clientId: "tienda", amountGtq: "8.00", spentOn: "2026-09-30" }),
    ];
    const today = guatemalaSalesRange({ period: "hoy", now });
    const week = guatemalaSalesRange({ period: "semana", now });
    const month = guatemalaSalesRange({ period: "mes", now });
    const range = guatemalaSalesRange({ period: "rango", from: "2026-10-01", to: "2026-10-12", now });
    expect(today.ok && week.ok && month.ok && range.ok).toBe(true);
    if (!today.ok || !week.ok || !month.ok || !range.ok) return;
    expect(expensesInRange(book, "tienda", today.range.from, today.range.to).map((item) => item.id)).toEqual(["hoy"]);
    expect(sumExpenseAmounts(expensesInRange(book, "tienda", week.range.from, week.range.to))).toBe("3.00");
    expect(sumExpenseAmounts(expensesInRange(book, "tienda", month.range.from, month.range.to))).toBe("7.00");
    expect(expensesInRange(book, "tienda", range.range.from, range.range.to).map((item) => item.id)).toEqual([
      "lunes",
      "mes",
    ]);
  });
});

describe("ganancia de Tienda Guatemala", () => {
  it("resta solo el costo de las prendas vendidas y los gastos del período", () => {
    const summary = summarizeGuatemalaProfit({
      includeTests: false,
      garments: [
        garment({ itemId: "vendida", chargedPriceGtq: "180.00", costGtq: "100.00" }),
        garment({
          itemId: "en-bodega",
          chargedPriceGtq: "0.00",
          soldInPeriod: false,
          costGtq: "100.00",
        }),
        garment({
          itemId: "otra-bodega",
          chargedPriceGtq: "0.00",
          soldInPeriod: false,
          costGtq: "100.00",
        }),
      ],
      expenses: [{ category: "bolsas_etiquetas", amountGtq: "15.00", includedInGarmentCost: false }],
    });
    expect(summary.salesTotalGtq).toBe("180.00");
    expect(summary.soldCostGtq).toBe("100.00");
    expect(summary.businessExpensesGtq).toBe("15.00");
    expect(summary.profitGtq).toBe("65.00");
    expect(summary.partial).toBe(false);
    expect(profitLabel(summary.partial)).toBe("Ganancia");
    expect(soldCostLabel(summary)).toBe("Q100.00");
  });

  it("no usa el precio publicado cuando falta el costo y marca la ganancia como parcial", () => {
    const summary = summarizeGuatemalaProfit({
      includeTests: false,
      garments: [
        garment({ itemId: "con-costo", chargedPriceGtq: "30.00", costGtq: "10.00" }),
        garment({ itemId: "sin-costo", chargedPriceGtq: "40.00", costGtq: null }),
      ],
      expenses: [{ category: "transporte", amountGtq: "5.00", includedInGarmentCost: false }],
    });
    expect(summary.salesTotalGtq).toBe("70.00");
    expect(summary.soldCostGtq).toBe("10.00");
    expect(summary.missingCostCount).toBe(1);
    expect(summary.profitGtq).toBe("55.00");
    expect(summary.partial).toBe(true);
    expect(profitLabel(summary.partial)).toBe("Ganancia parcial");
    expect(soldCostLabel(summary)).toBe("Q10.00, incompleto");
    expect(summary.warnings[0]).toMatch(/Falta el costo de 1 prenda vendida/);
  });

  it("deja fuera ventas anuladas y de prueba, y permite una ganancia negativa", () => {
    const hidden = summarizeGuatemalaProfit({
      includeTests: false,
      garments: [
        garment({ itemId: "real", chargedPriceGtq: "10.00", costGtq: "8.00" }),
        garment({ itemId: "prueba", chargedPriceGtq: "50.00", costGtq: "1.00", isTest: true }),
        garment({ itemId: "anulada", chargedPriceGtq: "80.00", costGtq: "70.00", voided: true }),
      ],
      expenses: [{ category: "servicios", amountGtq: "5.00", includedInGarmentCost: false }],
    });
    expect(hidden.salesTotalGtq).toBe("10.00");
    expect(hidden.soldCostGtq).toBe("8.00");
    expect(hidden.profitGtq).toBe("-3.00");
    expect(soldCostLabel({ ...hidden, missingCostCount: 2, knownCostCount: 0 })).toBe("Incompleto");

    const included = summarizeGuatemalaProfit({
      includeTests: true,
      garments: [garment({ itemId: "prueba", chargedPriceGtq: "50.00", costGtq: "1.00", isTest: true })],
      expenses: [],
    });
    expect(included.salesTotalGtq).toBe("50.00");
    expect(included.profitGtq).toBe("49.00");
  });

  it("no resta dos veces un pago de fotografías que ya está en el costo de la prenda vendida", () => {
    const summary = summarizeGuatemalaProfit({
      includeTests: false,
      garments: [
        garment({
          itemId: "vestido",
          chargedPriceGtq: "120.00",
          costGtq: "70.00",
          costIncludesPhotography: true,
        }),
      ],
      expenses: [
        { category: "fotografias", amountGtq: "20.00", includedInGarmentCost: true },
        { category: "transporte", amountGtq: "10.00", includedInGarmentCost: false },
      ],
    });
    expect(summary.soldCostGtq).toBe("70.00");
    expect(summary.businessExpensesGtq).toBe("10.00");
    expect(summary.excludedPhotographyGtq).toBe("20.00");
    expect(summary.profitGtq).toBe("40.00");
    expect(summary.partial).toBe(false);
    expect(summary.photographyNote).toMatch(/no se restan otra vez/);
    expect(sumExpenseAmounts([
      { amountGtq: "20.00" },
      { amountGtq: "10.00" },
    ])).toBe("30.00");
  });

  it("mantiene el pago de fotografías en los gastos si el costo vendido no lo incluye", () => {
    const summary = summarizeGuatemalaProfit({
      includeTests: false,
      garments: [garment({ itemId: "camisa", chargedPriceGtq: "100.00", costGtq: "50.00" })],
      expenses: [{ category: "fotografias", amountGtq: "20.00", includedInGarmentCost: false }],
    });
    expect(summary.businessExpensesGtq).toBe("20.00");
    expect(summary.profitGtq).toBe("30.00");
    expect(summary.partial).toBe(false);
  });

  it("advierte si el pago de fotografías está marcado y la prenda vendida no trae ese costo", () => {
    const summary = summarizeGuatemalaProfit({
      includeTests: false,
      garments: [garment({ itemId: "camisa", chargedPriceGtq: "100.00", costGtq: "50.00" })],
      expenses: [{ category: "fotografias", amountGtq: "20.00", includedInGarmentCost: true }],
    });
    expect(summary.businessExpensesGtq).toBe("0.00");
    expect(summary.profitGtq).toBe("50.00");
    expect(summary.partial).toBe(true);
    expect(summary.warnings.join(" ")).toMatch(/no se restaron otra vez/);
  });

  it("no descuenta fotografías sin marcar cuando el costo vendido ya las incluye, y lo marca parcial", () => {
    const summary = summarizeGuatemalaProfit({
      includeTests: false,
      garments: [
        garment({
          itemId: "vestido",
          chargedPriceGtq: "120.00",
          costGtq: "70.00",
          costIncludesPhotography: true,
        }),
      ],
      expenses: [{ category: "fotografias", amountGtq: "20.00", includedInGarmentCost: false }],
    });
    expect(summary.businessExpensesGtq).toBe("0.00");
    expect(summary.profitGtq).toBe("50.00");
    expect(summary.partial).toBe(true);
  });

  it("guarda un pago de fotografías para más adelante si la prenda todavía no se vende", () => {
    const summary = summarizeGuatemalaProfit({
      includeTests: false,
      garments: [garment({ itemId: "bodega", chargedPriceGtq: "0.00", soldInPeriod: false, costGtq: "70.00", costIncludesPhotography: true })],
      expenses: [
        { category: "fotografias", amountGtq: "20.00", includedInGarmentCost: true },
        { category: "sueldo", amountGtq: "5.00", includedInGarmentCost: false },
      ],
    });
    expect(summary.salesTotalGtq).toBe("0.00");
    expect(summary.soldCostGtq).toBe("0.00");
    expect(summary.businessExpensesGtq).toBe("5.00");
    expect(summary.profitGtq).toBe("-5.00");
    expect(summary.partial).toBe(false);
    expect(summary.photographyNote).toMatch(/cuando la prenda se vende/);
  });
});

describe("costo de la prenda", () => {
  it("permite dejar el costo vacío y rechaza cero", () => {
    expect(prepareGarmentCost({ cost: "  ", includesPhotography: true })).toEqual({
      ok: true,
      costGtq: null,
      includesPhotography: false,
    });
    expect(prepareGarmentCost({ cost: "0" }).ok).toBe(false);
    expect(prepareGarmentCost({ cost: "35.5", includesPhotography: true })).toEqual({
      ok: true,
      costGtq: "35.50",
      includesPhotography: true,
    });
  });
});
