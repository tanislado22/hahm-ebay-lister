import { describe, expect, it } from "vitest";
import { summarizeGuatemalaProfit } from "@/lib/markets/guatemala-expenses";
import {
  activeLotTotalGtq,
  addLotExpenseOnce,
  assignItemToLot,
  correctLotExpense,
  lotAverageCost,
  lotArticleCounts,
  lotFieldEnterSubmits,
  lotMayBeDeleted,
  lotNumberIsAvailable,
  nextLotNumber,
  nextLotSku,
  preparePurchaseLot,
  sellableCountAfterSale,
  voidLotExpense,
  type LotExpenseRecord,
} from "@/lib/markets/guatemala-lots";
import { decideGuatemalaAccess, type AccessAccount, type AccessSession } from "@/lib/markets/guatemala-staff";

const actor = { role: "encargado" as const, accountId: "cuenta-1", username: "hermana" };

function expense(partial: Partial<LotExpenseRecord> & Pick<LotExpenseRecord, "id" | "requestId" | "amountGtq">): LotExpenseRecord {
  return {
    lotId: "lote-1",
    spentOn: "2026-10-24",
    category: "compra",
    description: "Gasto",
    payee: "",
    status: "activo",
    createdBy: actor,
    ...partial,
  };
}

describe("lotes de compra de Tienda Guatemala", () => {
  it("suma el ejemplo y redondea el costo promedio sin usar 1200 como valor inicial", () => {
    const blank = preparePurchaseLot({ name: "Pacas", receivedOn: "2026-10-24" });
    expect(blank.ok && blank.lot.sellableCount).toBe(null);
    const counted = preparePurchaseLot({ name: "Pacas", receivedOn: "2026-10-24", sellableCount: 1200 });
    expect(counted.ok && counted.lot.sellableCount).toBe(1200);

    let rows = [
      expense({ id: "1", requestId: "11111111-1111-4111-8111-111111111111", amountGtq: "6666.00", category: "compra" }),
      expense({ id: "2", requestId: "22222222-2222-4222-8222-222222222222", amountGtq: "300.00", category: "envio" }),
      expense({ id: "3", requestId: "33333333-3333-4333-8333-333333333333", amountGtq: "300.00", category: "recoger" }),
    ];
    expect(activeLotTotalGtq(rows)).toBe("7266.00");
    rows = addLotExpenseOnce(rows, expense({
      id: "4",
      requestId: "44444444-4444-4444-8444-444444444444",
      amountGtq: "600.00",
      category: "seleccion",
    })).expenses;
    expect(activeLotTotalGtq(rows)).toBe("7866.00");
    expect(lotAverageCost("7866.00", 1200)).toMatchObject({ pending: false, averageGtq: "6.56" });
    rows = addLotExpenseOnce(rows, expense({
      id: "5",
      requestId: "55555555-5555-4555-8555-555555555555",
      amountGtq: "200.00",
      category: "otros",
    })).expenses;
    expect(activeLotTotalGtq(rows)).toBe("8066.00");
    expect(lotAverageCost("8066.00", 1200)).toMatchObject({ pending: false, averageGtq: "6.72" });
    expect(lotAverageCost("8066.00", null).label).toBe("Pendiente de conteo");
    expect(sellableCountAfterSale(1200)).toBe(1200);
  });

  it("no duplica un guardado repetido y conserva el historial al corregir o anular", () => {
    const first = expense({ id: "1", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", amountGtq: "300.00" });
    const repeated = addLotExpenseOnce([first], { ...first, id: "otro", amountGtq: "999.00" });
    expect(repeated.created).toBe(false);
    expect(repeated.expenses).toHaveLength(1);
    expect(activeLotTotalGtq(repeated.expenses)).toBe("300.00");

    const corrected = correctLotExpense(repeated.expenses, "1", {
      spentOn: "2026-10-24",
      category: "envio",
      description: "Envío corregido",
      amountGtq: "350.00",
      payee: "",
    }, actor);
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    expect(corrected.revision.previousAmountGtq).toBe("300.00");
    expect(activeLotTotalGtq(corrected.expenses)).toBe("350.00");

    const voided = voidLotExpense(corrected.expenses, "1", actor);
    expect(voided.ok).toBe(true);
    if (!voided.ok) return;
    expect(activeLotTotalGtq(voided.expenses)).toBe("0.00");
    expect(voidLotExpense(voided.expenses, "1", actor).ok).toBe(false);
  });

  it("ofrece el siguiente SKU del lote y no cambia el SKU al asignar", () => {
    const used = ["L1-1", "L1-2", "3001", "L2-1"];
    expect(nextLotSku(1, used)).toBe("L1-3");
    expect(nextLotSku(2, [...used, "L2-2"])).toBe("L2-3");
    expect(nextLotSku(3, used)).toBe("L3-1");
    const sold = ["L1-1", "L1-2"];
    expect(nextLotSku(1, sold)).toBe("L1-3");
    const item = { id: "prenda-1", sku: "3001", priceGtq: "40.00" };
    const assigned = assignItemToLot(item, "lote-1");
    expect(assigned.sku).toBe("3001");
    expect(assigned.priceGtq).toBe("40.00");
    expect(item.sku).toBe("3001");
    expect(lotNumberIsAvailable([1, 2], 1)).toBe(false);
    expect(nextLotNumber([1, 2, 4])).toBe(3);
    expect(nextLotNumber([2, 4])).toBe(1);
  });

  it("separa el conteo vendible de las prendas registradas y no resta el gasto dos veces", () => {
    const counts = lotArticleCounts(
      [
        { lotId: "lote-1", status: "disponible" },
        { lotId: "lote-1", status: "vendida" },
        { lotId: "lote-2", status: "disponible" },
      ],
      "lote-1"
    );
    expect(counts).toEqual({ registered: 2, available: 1, sold: 1 });
    const profit = summarizeGuatemalaProfit({
      includeTests: false,
      garments: [
        {
          itemId: "vendida",
          soldInPeriod: true,
          isTest: false,
          voided: false,
          chargedPriceGtq: "40.00",
          costGtq: null,
          costIncludesPhotography: false,
        },
      ],
      expenses: [{ category: "otros", amountGtq: "600.00", includedInGarmentCost: false, lotExpenseId: "gasto-lote" }],
    });
    expect(profit.salesTotalGtq).toBe("40.00");
    expect(profit.businessExpensesGtq).toBe("600.00");
    expect(profit.soldCostGtq).toBe("0.00");
    expect(profit.profitGtq).toBe("-560.00");
  });

  it("deja consultar y crear lotes al encargado, y separa corregir de anular", () => {
    const account: AccessAccount = {
      id: "cuenta-1",
      clientId: "tienda",
      username: "hermana",
      active: true,
      sessionGeneration: 1,
      deactivatedAt: null,
    };
    const session: AccessSession = {
      accountId: "cuenta-1",
      sessionGeneration: 1,
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const base = { owner: false, staffPanel: true, account, session, requestedClientId: "tienda" };
    expect(decideGuatemalaAccess({ ...base, action: "read" }).ok).toBe(true);
    expect(decideGuatemalaAccess({ ...base, action: "lotWrite" }).ok).toBe(true);
    expect(decideGuatemalaAccess({ ...base, action: "lotCorrect" }).ok).toBe(false);
    expect(decideGuatemalaAccess({ ...base, action: "lotVoid" }).ok).toBe(false);
    expect(decideGuatemalaAccess({ ...base, account: { ...account, canCorrectLots: true }, action: "lotCorrect" }).ok).toBe(true);
    expect(decideGuatemalaAccess({ ...base, account: { ...account, canVoidLots: true }, action: "lotVoid" }).ok).toBe(true);
    expect(decideGuatemalaAccess({ ...base, owner: true, staffPanel: false, action: "lotVoid" }).ok).toBe(true);
    expect(decideGuatemalaAccess({ ...base, action: "lotDelete" }).ok).toBe(false);
    expect(decideGuatemalaAccess({ ...base, account: { ...account, canVoidLots: true }, action: "lotDelete" }).ok).toBe(false);
    expect(decideGuatemalaAccess({ ...base, owner: true, staffPanel: false, action: "lotDelete" }).ok).toBe(true);
  });

  it("solo libera el número de un lote sin artículos, gastos, ventas ni SKU", () => {
    const empty = {
      associatedItems: 0,
      expenses: 0,
      mirroredExpenses: 0,
      expenseRevisions: 0,
      sales: 0,
      saleCorrections: 0,
      publicationEvents: 0,
      reservedSkus: 0,
    };
    expect(lotMayBeDeleted(empty)).toBe(true);
    expect(lotMayBeDeleted({ ...empty, expenses: 1 })).toBe(false);
    expect(lotMayBeDeleted({ ...empty, associatedItems: 1 })).toBe(false);
    expect(lotMayBeDeleted({ ...empty, sales: 1 })).toBe(false);
    expect(lotMayBeDeleted({ ...empty, reservedSkus: 1 })).toBe(false);
    expect(lotMayBeDeleted({ ...empty, mirroredExpenses: 1 })).toBe(false);
    const kept = [1, 2];
    const freed = kept.filter((number) => number !== 1);
    expect(lotNumberIsAvailable(freed, 1)).toBe(true);
    expect(nextLotNumber(freed)).toBe(1);
    expect(lotNumberIsAvailable(kept, 1)).toBe(false);
    expect(lotFieldEnterSubmits("line")).toBe(false);
    expect(lotFieldEnterSubmits("notes")).toBe(true);
    expect(lotFieldEnterSubmits("save")).toBe(true);
  });
});
