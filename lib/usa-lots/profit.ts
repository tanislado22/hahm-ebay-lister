import { centsToUsd } from "@/lib/usa-lots/money";

export const SHARED_COST_RULE =
  "Los gastos compartidos del pedido se reparten según el precio de cada artículo. El resto de los centavos va al artículo de mayor precio.";

export interface SaleMoney {
  itemCents: number | null;
  buyerShippingCents: number | null;
  taxRemittedCents: number | null;
  feeCents: number | null;
  sellerShippingCents: number | null;
  refundCents: number | null;
  otherCents: number | null;
  unitCostCents: number | null;
  quantity: number | null;
  costEstimated: boolean;
  cancelled: boolean;
}

export interface ProfitResult {
  incomeCents: number | null;
  costCents: number | null;
  expenseCents: number | null;
  profitCents: number | null;
  recoveredCents: number | null;
  provisional: boolean;
  label: "Ganancia" | "Ganancia provisional" | "Sin ingreso";
  missing: string[];
}

function missingAmount(value: number | null, label: string, missing: string[]): number | null {
  if (value == null) {
    missing.push(label);
    return null;
  }
  return value;
}

export function saleProfit(sale: SaleMoney): ProfitResult {
  const missing: string[] = [];
  const item = missingAmount(sale.itemCents, "precio final", missing);
  const shippingIn = missingAmount(sale.buyerShippingCents, "envío cobrado al comprador", missing);
  const refund = missingAmount(sale.refundCents, sale.cancelled ? "reembolso de la cancelación" : "reembolsos", missing);
  const fee = missingAmount(sale.feeCents, "comisión de eBay", missing);
  const shippingOut = missingAmount(sale.sellerShippingCents, "envío pagado por ti", missing);
  const other = sale.otherCents == null ? 0 : sale.otherCents;
  const quantity = sale.quantity;
  if (quantity == null || quantity < 1) missing.push("cantidad vendida");
  const unit = sale.unitCostCents;
  if (unit == null) missing.push("costo del artículo");
  if (sale.costEstimated) missing.push("el costo sigue estimado");
  const cost = unit != null && quantity != null && quantity >= 1 ? unit * quantity : null;
  const income = item != null && shippingIn != null && refund != null ? item + shippingIn - refund : null;
  const expenses = fee != null && shippingOut != null ? fee + shippingOut + other : null;
  const recovered = income != null && expenses != null ? income - expenses : null;
  const profit = recovered != null && cost != null && !sale.costEstimated ? recovered - cost : null;
  const provisional = missing.length > 0 || sale.cancelled || sale.costEstimated;
  return {
    incomeCents: income,
    costCents: cost,
    expenseCents: expenses,
    profitCents: profit,
    recoveredCents: recovered,
    provisional,
    label: income == null ? "Sin ingreso" : provisional ? "Ganancia provisional" : "Ganancia",
    missing,
  };
}

export function allocateSharedCents(total: number | null, weights: (number | null)[]): (number | null)[] {
  if (total == null || weights.some((weight) => weight == null || weight < 0)) return weights.map(() => null);
  const known = weights as number[];
  if (known.length === 0) return [];
  const sum = known.reduce((totalWeight, weight) => totalWeight + weight, 0);
  const shares = sum === 0
    ? known.map(() => Math.floor(total / known.length))
    : known.map((weight) => Math.floor((total * weight) / sum));
  let assigned = shares.reduce((totalShare, share) => totalShare + share, 0);
  const order = known
    .map((weight, index) => ({ weight, index }))
    .sort((left, right) => right.weight - left.weight || left.index - right.index);
  let cursor = 0;
  while (assigned < total && order.length > 0) {
    shares[order[cursor % order.length].index] += 1;
    assigned += 1;
    cursor += 1;
  }
  return shares;
}

export interface LotItemSnapshot {
  id: string;
  ebayItemId: string;
  disposition: "" | "guatemala-transfer";
  unitCostCents: number | null;
  costEstimated: boolean;
  manual?: boolean;
}

export interface LotSaleSnapshot {
  itemId: string | null;
  cancelled: boolean;
  linkStatus: "lotted" | "unassigned" | "unmatched" | "transfer";
  profit: ProfitResult;
  quantity?: number | null;
  recordedCostCents?: number | null;
}

export interface LotReport {
  investedCents: number;
  registered: number;
  published: number;
  sold: number;
  transferred: number;
  remaining: number | null;
  remainingEstimated: boolean;
  soldProfitCents: number | null;
  soldProfitProvisional: boolean;
  recoveredCents: number | null;
  recoveredProvisional: boolean;
  investmentLeftCents: number | null;
  surplusCents: number | null;
  unsoldCostCents: number | null;
  pending: string[];
  averageUnitCents: number | null;
  averageDisplayCents: number | null;
  pendingAssignCents: number | null;
  usPieces: number | null;
  linkedTransfers: number;
  guatemalaPieces: number;
  guatemalaShippingCents: number;
  guatemalaShippingUnitCents: number | null;
  guatemalaShippingPendingCents: number | null;
}

export function heldPieceCount(bulkCount: number, linkedCount: number): number {
  const bulk = Number.isInteger(bulkCount) && bulkCount > 0 ? bulkCount : 0;
  const linked = Number.isInteger(linkedCount) && linkedCount > 0 ? linkedCount : 0;
  return Math.max(bulk, linked);
}

export function displayedAverageCents(investedCents: number, sellableCount: number | null): number | null {
  if (sellableCount == null || sellableCount < 1 || !Number.isInteger(investedCents)) return null;
  return Math.round(investedCents / sellableCount);
}

export function assignmentBalance(input: {
  investedCents: number;
  sellableCount: number | null;
  respected: { count: number; cents: number }[];
}): { unitCents: number | null; displayCents: number | null; pendingCents: number | null } {
  if (input.sellableCount == null || input.sellableCount < 1 || !Number.isInteger(input.investedCents)) {
    return { unitCents: null, displayCents: null, pendingCents: null };
  }
  const unitCents = Math.floor(input.investedCents / input.sellableCount);
  const displayCents = Math.round(input.investedCents / input.sellableCount);
  let respectedCount = 0;
  let respectedCents = 0;
  for (const piece of input.respected) {
    if (!Number.isInteger(piece.count) || piece.count < 1) continue;
    if (!Number.isInteger(piece.cents) || piece.cents < 0) continue;
    respectedCount += piece.count;
    respectedCents += piece.cents;
  }
  const flexible = input.sellableCount - respectedCount;
  const assigned = flexible >= 0 ? respectedCents + unitCents * flexible : respectedCents;
  return { unitCents, displayCents, pendingCents: input.investedCents - assigned };
}

export function exclusiveShare(totalCents: number, pieces: number): { unitCents: number | null; pendingCents: number } {
  if (!Number.isInteger(totalCents) || totalCents < 0) return { unitCents: null, pendingCents: 0 };
  if (!Number.isInteger(pieces) || pieces < 1) return { unitCents: null, pendingCents: totalCents };
  const unitCents = Math.floor(totalCents / pieces);
  return { unitCents, pendingCents: totalCents - unitCents * pieces };
}

export function buildLotReport(input: {
  purchaseCents: number;
  extraCents: number;
  sellableCount: number | null;
  publishedCount: number;
  guatemalaPieces?: number;
  guatemalaShippingCents?: number;
  items: LotItemSnapshot[];
  sales: LotSaleSnapshot[];
}): LotReport {
  const sales = input.sales.filter((sale) => sale.linkStatus === "lotted");
  const investedCents = input.purchaseCents + input.extraCents;
  const registered = input.items.length;
  const linkedTransfers = input.items.filter((item) => item.disposition === "guatemala-transfer").length;
  const guatemalaPieces = Number.isInteger(input.guatemalaPieces) && (input.guatemalaPieces ?? 0) > 0 ? input.guatemalaPieces ?? 0 : 0;
  const transferred = heldPieceCount(guatemalaPieces, linkedTransfers);
  const soldIds = new Set(
    sales
      .filter((sale) => !sale.cancelled && sale.itemId)
      .map((sale) => sale.itemId as string)
  );
  const sold = input.items.filter((item) => soldIds.has(item.id) && item.disposition !== "guatemala-transfer").length;
  const sellableCount = input.sellableCount != null && input.sellableCount >= 1 ? input.sellableCount : null;
  const countIncomplete = sellableCount == null;
  const remaining = sellableCount == null ? null : Math.max(0, sellableCount - sold - transferred);
  const usPieces = sellableCount == null ? null : Math.max(0, sellableCount - transferred);
  const pending: string[] = [];
  if (countIncomplete) pending.push("El conteo de piezas vendibles está incompleto.");
  const profitKnown = sales.every((sale) => sale.profit.profitCents != null);
  const recoveredKnown = sales.every((sale) => sale.profit.recoveredCents != null);
  const soldProfitCents = profitKnown
    ? sales.reduce((total, sale) => total + (sale.profit.profitCents ?? 0), 0)
    : null;
  const recoveredCents = recoveredKnown
    ? sales.reduce((total, sale) => total + (sale.profit.recoveredCents ?? 0), 0)
    : null;
  for (const sale of sales) pending.push(...sale.profit.missing.map((item) => `Venta: ${item}`));
  const respected = respectedCosts(input.items, sales);
  const balance = assignmentBalance({ investedCents, sellableCount: input.sellableCount, respected });
  if (balance.pendingCents != null && balance.pendingCents !== 0) {
    const amount = centsToUsd(Math.abs(balance.pendingCents));
    pending.push(
      balance.pendingCents > 0
        ? `Diferencia pendiente de asignar: ${amount}. Los costos manuales y los de ventas ya registradas se quedan como están.`
        : `Los costos ya asignados superan lo invertido por ${amount}. No se modificaron los costos manuales ni los de ventas registradas.`
    );
  }
  const shipping = exclusiveShare(input.guatemalaShippingCents ?? 0, transferred);
  if ((input.guatemalaShippingCents ?? 0) > 0 && shipping.pendingCents > 0) {
    pending.push(`Del envío a Guatemala quedan ${centsToUsd(shipping.pendingCents)} sin asignar a esas prendas. No se suman al costo de Estados Unidos.`);
  }
  const unsold = input.items.filter((item) => item.disposition !== "guatemala-transfer" && !soldIds.has(item.id));
  const unregisteredRemaining = remaining == null ? 0 : Math.max(0, remaining - unsold.length);
  const unsoldKnown = unregisteredRemaining === 0 && unsold.every((item) => item.unitCostCents != null && !item.costEstimated);
  const unsoldCostCents = unsoldKnown ? unsold.reduce((total, item) => total + (item.unitCostCents ?? 0), 0) : null;
  if (unsold.some((item) => item.unitCostCents == null || item.costEstimated)) {
    pending.push("Falta el costo de parte del inventario restante.");
  }
  const investmentLeftCents = recoveredCents == null ? null : investedCents - recoveredCents;
  return {
    investedCents,
    registered,
    published: input.publishedCount,
    sold,
    transferred,
    remaining,
    remainingEstimated: countIncomplete,
    soldProfitCents,
    soldProfitProvisional: !profitKnown || sales.some((sale) => sale.profit.provisional),
    recoveredCents,
    recoveredProvisional: !recoveredKnown || sales.some((sale) => sale.profit.provisional),
    investmentLeftCents: investmentLeftCents != null && investmentLeftCents > 0 ? investmentLeftCents : investmentLeftCents === 0 ? 0 : null,
    surplusCents: investmentLeftCents != null && investmentLeftCents < 0 ? -investmentLeftCents : null,
    unsoldCostCents,
    pending: [...new Set(pending)],
    averageUnitCents: balance.unitCents,
    averageDisplayCents: balance.displayCents,
    pendingAssignCents: balance.pendingCents,
    usPieces,
    linkedTransfers,
    guatemalaPieces,
    guatemalaShippingCents: Number.isInteger(input.guatemalaShippingCents) && (input.guatemalaShippingCents ?? 0) > 0 ? input.guatemalaShippingCents ?? 0 : 0,
    guatemalaShippingUnitCents: shipping.unitCents,
    guatemalaShippingPendingCents: (input.guatemalaShippingCents ?? 0) > 0 ? shipping.pendingCents : 0,
  };
}

function respectedCosts(items: LotItemSnapshot[], sales: LotSaleSnapshot[]): { count: number; cents: number }[] {
  const saleByItem = new Map<string, { count: number; cents: number }>();
  const loose: { count: number; cents: number }[] = [];
  for (const sale of sales) {
    if (sale.cancelled || sale.recordedCostCents == null || !Number.isInteger(sale.recordedCostCents)) continue;
    const quantity = sale.quantity == null ? 1 : sale.quantity;
    if (!Number.isInteger(quantity) || quantity < 1) continue;
    if (!sale.itemId) {
      loose.push({ count: quantity, cents: sale.recordedCostCents });
      continue;
    }
    const previous = saleByItem.get(sale.itemId);
    saleByItem.set(sale.itemId, {
      count: (previous?.count ?? 0) + quantity,
      cents: (previous?.cents ?? 0) + sale.recordedCostCents,
    });
  }
  const respected: { count: number; cents: number }[] = [];
  for (const item of items) {
    const recorded = saleByItem.get(item.id);
    if (recorded) {
      respected.push(recorded);
      saleByItem.delete(item.id);
      continue;
    }
    if (item.manual && item.unitCostCents != null) respected.push({ count: 1, cents: item.unitCostCents });
  }
  respected.push(...saleByItem.values(), ...loose);
  return respected;
}

export function applyAverageCosts<T extends { id: string; locked: boolean; sold: boolean; source: string; disposition?: "" | "guatemala-transfer" }>(
  items: T[],
  unitCents: number | null,
  sellableCount: number | null,
  transferUnitCents: number | null = null
): { items: (T & { unitCostCents: number | null; costEstimated: boolean })[]; estimated: boolean; error: string } {
  if (sellableCount == null || sellableCount < 1 || unitCents == null) {
    return {
      items: items.map((item) => ({ ...item, unitCostCents: null, costEstimated: true })),
      estimated: true,
      error: "Indica cuántas piezas vendibles tiene el lote antes de repartir el promedio. No se inventó una cantidad.",
    };
  }
  return {
    estimated: false,
    error: "",
    items: items.map((item) => {
      if (item.locked || item.sold || item.source === "manual") {
        return { ...item, unitCostCents: null, costEstimated: false };
      }
      const share = item.disposition === "guatemala-transfer" && transferUnitCents != null ? transferUnitCents : unitCents;
      return { ...item, unitCostCents: share, costEstimated: false };
    }),
  };
}

export function averageUnitCents(purchaseCents: number, extraCents: number, sellableCount: number | null): number | null {
  if (sellableCount == null || sellableCount < 1) return null;
  return Math.floor((purchaseCents + extraCents) / sellableCount);
}
