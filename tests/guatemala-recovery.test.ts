import { describe, expect, it } from "vitest";
import {
  expensesCountedTowardRecovery,
  recoveryBalance,
  summarizeGuatemalaProfit,
  type ProfitGarment,
} from "@/lib/markets/guatemala-expenses";
import { prepareRecovery } from "@/lib/markets/guatemala-recoveries";

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

describe("recuperación de gastos de Tienda Guatemala", () => {
  it("sigue el ejemplo de gastos y apartados manuales", () => {
    const expenses = [{ amountGtq: "1400.00" }];
    expect(recoveryBalance(expenses, [])).toEqual({
      expensesGtq: "1400.00",
      recoveredGtq: "0.00",
      pendingGtq: "1400.00",
    });
    expect(recoveryBalance(expenses, [{ amountGtq: "20.00" }])).toMatchObject({
      recoveredGtq: "20.00",
      pendingGtq: "1380.00",
    });
    expect(recoveryBalance(expenses, [{ amountGtq: "20.00" }, { amountGtq: "50.00" }])).toMatchObject({
      recoveredGtq: "70.00",
      pendingGtq: "1330.00",
    });
    const withNewExpense = [{ amountGtq: "1400.00" }, { amountGtq: "200.00" }];
    expect(recoveryBalance(withNewExpense, [{ amountGtq: "20.00" }, { amountGtq: "50.00" }])).toEqual({
      expensesGtq: "1600.00",
      recoveredGtq: "70.00",
      pendingGtq: "1530.00",
    });
    expect(
      recoveryBalance(withNewExpense, [{ amountGtq: "20.00" }, { amountGtq: "50.00" }, { amountGtq: "100.00" }])
    ).toEqual({
      expensesGtq: "1600.00",
      recoveredGtq: "170.00",
      pendingGtq: "1430.00",
    });
  });

  it("cuenta una sola vez el gasto de lote y deja fuera el anulado", () => {
    const ledger = expensesCountedTowardRecovery([
      { amountGtq: "800.00", lotExpenseId: null, voidedAt: null },
      { amountGtq: "600.00", lotExpenseId: "gasto-lote", voidedAt: null },
      { amountGtq: "600.00", lotExpenseId: "gasto-anulado", voidedAt: "2026-10-20T00:00:00.000Z" },
    ]);
    expect(recoveryBalance(ledger, [{ amountGtq: "20.00" }])).toEqual({
      expensesGtq: "1400.00",
      recoveredGtq: "20.00",
      pendingGtq: "1380.00",
    });
  });

  it("no resta la recuperación otra vez en la ganancia", () => {
    const expenses = [{ category: "otros" as const, amountGtq: "1600.00", includedInGarmentCost: false }];
    const profit = summarizeGuatemalaProfit({
      includeTests: false,
      garments: [garment({ itemId: "vendida", chargedPriceGtq: "100.00", costGtq: "40.00" })],
      expenses,
    });
    expect(profit.businessExpensesGtq).toBe("1600.00");
    expect(profit.profitGtq).toBe("-1540.00");
    expect(recoveryBalance(expenses, [{ amountGtq: "170.00" }]).pendingGtq).toBe("1430.00");
    expect(profit.profitGtq).toBe("-1540.00");
  });

  it("acepta un apartado con descripción opcional y rechaza un monto vacío", () => {
    const saved = prepareRecovery({ recoveredOn: "2026-10-27", description: "  Apartado de caja  ", amount: "20" });
    expect(saved.ok && saved.recovery).toEqual({
      recoveredOn: "2026-10-27",
      description: "Apartado de caja",
      amountGtq: "20.00",
    });
    expect(prepareRecovery({ recoveredOn: "2026-10-27", description: "", amount: "50" }).ok).toBe(true);
    expect(prepareRecovery({ recoveredOn: "2026-10-27", amount: "0" }).ok).toBe(false);
    expect(prepareRecovery({ recoveredOn: "2026-02-31", amount: "20" }).ok).toBe(false);
  });
});
