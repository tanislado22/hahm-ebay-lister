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
}

export interface LotSaleSnapshot {
  itemId: string | null;
  cancelled: boolean;
  linkStatus: "lotted" | "unassigned" | "unmatched" | "transfer";
  profit: ProfitResult;
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
}

export function buildLotReport(input: {
  purchaseCents: number;
  extraCents: number;
  sellableCount: number | null;
  publishedCount: number;
  items: LotItemSnapshot[];
  sales: LotSaleSnapshot[];
}): LotReport {
  const sales = input.sales.filter((sale) => sale.linkStatus === "lotted");
  const investedCents = input.purchaseCents + input.extraCents;
  const registered = input.items.length;
  const transferred = input.items.filter((item) => item.disposition === "guatemala-transfer").length;
  const soldIds = new Set(
    sales
      .filter((sale) => !sale.cancelled && sale.itemId)
      .map((sale) => sale.itemId as string)
  );
  const sold = input.items.filter((item) => soldIds.has(item.id) && item.disposition !== "guatemala-transfer").length;
  const countIncomplete = input.sellableCount == null || registered < input.sellableCount;
  const remaining = countIncomplete ? null : Math.max(0, registered - sold - transferred);
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
  const unsold = input.items.filter((item) => item.disposition !== "guatemala-transfer" && !soldIds.has(item.id));
  const unsoldKnown = unsold.every((item) => item.unitCostCents != null && !item.costEstimated);
  const unsoldCostCents = unsoldKnown ? unsold.reduce((total, item) => total + (item.unitCostCents ?? 0), 0) : null;
  if (!unsoldKnown) pending.push("Falta el costo de parte del inventario restante.");
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
  };
}

export function applyAverageCosts<T extends { id: string; locked: boolean; sold: boolean; source: string }>(
  items: T[],
  unitCents: number | null,
  sellableCount: number | null
): { items: (T & { unitCostCents: number | null; costEstimated: boolean })[]; estimated: boolean; error: string } {
  if (sellableCount == null || sellableCount < 1 || unitCents == null) {
    return {
      items: items.map((item) => ({ ...item, unitCostCents: null, costEstimated: true })),
      estimated: true,
      error: "Indica cuántas piezas vendibles tiene el lote antes de repartir el promedio. No se inventó una cantidad.",
    };
  }
  const estimated = items.length < sellableCount;
  return {
    estimated,
    error: "",
    items: items.map((item) => {
      if (item.locked || item.sold || item.source === "manual") {
        return { ...item, unitCostCents: null, costEstimated: false };
      }
      return { ...item, unitCostCents: unitCents, costEstimated: estimated };
    }),
  };
}

export function averageUnitCents(purchaseCents: number, extraCents: number, sellableCount: number | null): number | null {
  if (sellableCount == null || sellableCount < 1) return null;
  return Math.floor((purchaseCents + extraCents) / sellableCount);
}
