import {
  brandKey,
  brandsMatch,
  conditionBucket,
  garmentKind,
  type StorePriceGuide,
} from "@/lib/markets/guatemala-price-match";
import { GUATEMALA_CONDITION_CHOICES, unpublishedItemType } from "@/lib/markets/guatemala-inventory";

export const SALE_ADVICE_MESSAGES = {
  needCost: "Escribe el costo de la prenda para calcular el precio.",
  needSettings: "El dueño todavía no configuró el sueldo, los gastos mensuales, las ventas estimadas y la ganancia mínima.",
  needDetails: "Elige el tipo y confirma el estado para calcular el precio.",
  staffNeedCost: "Todavía no se puede calcular el mínimo.",
  needType: "Elige el tipo de artículo.",
  needCondition: "Confirma el estado de la prenda.",
  staffNeedSettings: "El dueño todavía no configuró los precios.",
  noReference: "Sin referencia de precio",
  review: "Revisar con el dueño",
  labelUnread: "La etiqueta no se leyó. Escribe la marca y la talla a mano.",
  belowMinimum: "Este precio está por debajo del mínimo.",
  salaryInvalid: "Escribe el sueldo mensual en quetzales, o cero si no aplica.",
  expensesInvalid: "Escribe los demás gastos mensuales en quetzales, o cero si no hay.",
  salesInvalid: "Escribe cuántas prendas esperas vender al mes, un número mayor que cero.",
  profitInvalid: "Escribe la ganancia mínima por prenda en quetzales, o cero.",
} as const;

export interface PricingSettingsInput {
  monthlySalaryGtq: string;
  otherMonthlyExpensesGtq: string;
  expectedMonthlySales: number;
  minimumProfitGtq: string;
}

export type GarmentCostSource = "individual" | "lot" | "missing";

export interface SaleAdvice {
  status: "waiting" | "need-cost" | "need-settings" | "no-reference" | "review" | "ready";
  costSource: GarmentCostSource;
  costGtq: string | null;
  expenseShareGtq: string | null;
  minimumGtq: number | null;
  recommendedGtq: number | null;
  profitGtq: string | null;
  notice: string;
}

export function moneyText(value: unknown, allowZero = false): string | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 2_000_000) return null;
  if (!allowZero && cents === 0) return null;
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function quetzalLabel(value: number | string): string {
  const text = typeof value === "number" ? value.toFixed(2) : value;
  return text.endsWith(".00") ? `Q${text.slice(0, -3)}` : `Q${text}`;
}

export function preparePricingSettings(input: {
  monthlySalaryGtq?: unknown;
  otherMonthlyExpensesGtq?: unknown;
  expectedMonthlySales?: unknown;
  minimumProfitGtq?: unknown;
}): { ok: true; settings: PricingSettingsInput } | { ok: false; error: string } {
  const monthlySalaryGtq = moneyText(input.monthlySalaryGtq, true);
  if (!monthlySalaryGtq) return { ok: false, error: SALE_ADVICE_MESSAGES.salaryInvalid };
  const otherMonthlyExpensesGtq = moneyText(input.otherMonthlyExpensesGtq, true);
  if (!otherMonthlyExpensesGtq) return { ok: false, error: SALE_ADVICE_MESSAGES.expensesInvalid };
  const salesText =
    typeof input.expectedMonthlySales === "number"
      ? String(input.expectedMonthlySales)
      : typeof input.expectedMonthlySales === "string"
        ? input.expectedMonthlySales.trim()
        : "";
  if (!/^[1-9]\d*$/.test(salesText)) return { ok: false, error: SALE_ADVICE_MESSAGES.salesInvalid };
  const expectedMonthlySales = Number(salesText);
  if (!Number.isSafeInteger(expectedMonthlySales) || expectedMonthlySales > 100_000) {
    return { ok: false, error: SALE_ADVICE_MESSAGES.salesInvalid };
  }
  const minimumProfitGtq = moneyText(input.minimumProfitGtq, true);
  if (!minimumProfitGtq) return { ok: false, error: SALE_ADVICE_MESSAGES.profitInvalid };
  return {
    ok: true,
    settings: { monthlySalaryGtq, otherMonthlyExpensesGtq, expectedMonthlySales, minimumProfitGtq },
  };
}

// The lot average already contains the lot's own expenses. This share is only the
// store overhead, so those expenses are not added a second time.
export function monthlyExpenseShare(settings: PricingSettingsInput): string | null {
  const salary = cents(settings.monthlySalaryGtq);
  const other = cents(settings.otherMonthlyExpensesGtq);
  if (salary == null || other == null || settings.expectedMonthlySales <= 0) return null;
  const share = Math.round((salary + other) / settings.expectedMonthlySales);
  return formatCents(share);
}

export function garmentCostInputForActor(role: "propietario" | "encargado", cost: unknown): unknown {
  return role === "propietario" ? cost : undefined;
}

export function saleAdviceGaps(input: { itemType?: string; condition?: string }): string[] {
  const gaps: string[] = [];
  if (!unpublishedItemType(input.itemType)) gaps.push(SALE_ADVICE_MESSAGES.needType);
  if (!conditionBucket(input.condition)) gaps.push(SALE_ADVICE_MESSAGES.needCondition);
  return gaps;
}

export function chooseGarmentCost(input: { individual?: unknown; lotAverage?: unknown }): {
  source: GarmentCostSource;
  costGtq: string | null;
} {
  const individual = moneyText(input.individual);
  if (individual) return { source: "individual", costGtq: individual };
  const lotAverage = moneyText(input.lotAverage);
  if (lotAverage) return { source: "lot", costGtq: lotAverage };
  return { source: "missing", costGtq: null };
}

export function minimumSaleQuetzales(costGtq: string, expenseShareGtq: string, minimumProfitGtq: string): number | null {
  const total = [costGtq, expenseShareGtq, minimumProfitGtq].reduce((sum, part) => {
    const partCents = cents(part);
    return partCents == null ? Number.NaN : sum + partCents;
  }, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.ceil(total / 100);
}

export function listedPriceRange(
  guides: readonly StorePriceGuide[],
  query: { itemType?: string; brand?: string; condition?: string }
): { low: number; high: number } | null {
  const kind = garmentKind(query.itemType);
  const condition = conditionBucket(query.condition);
  if (!kind || !condition) return null;
  const general = guides.find(
    (guide) => guide.scope === "general" && guide.garment === kind.key && guide.condition === condition
  );
  if (!general) return null;
  let low = numberOrNull(general.lowGtq);
  let high = numberOrNull(general.highGtq);
  if (low == null || high == null) {
    if (general.priceGtq == null) return null;
    low = general.priceGtq;
    high = general.priceGtq;
  }
  const wanted = brandKey(query.brand);
  const adjustment = wanted
    ? guides.find(
        (guide) =>
          guide.scope === "brand" &&
          guide.garment === kind.key &&
          guide.condition === condition &&
          brandsMatch(wanted, brandKey(guide.brand))
      )
    : null;
  const delta = adjustment?.adjustmentGtq ?? 0;
  low = roundMoney(low + delta);
  high = roundMoney(high + delta);
  if (low <= 0 || high <= 0 || high < low) return null;
  return { low, high };
}

export function recommendListedPrice(input: { low: number; high: number; minimum: number }): number | null {
  if (!(input.high >= input.minimum)) return null;
  let price = Math.round((input.low + input.high) / 2);
  if (price < input.minimum) price = input.minimum;
  if (price < input.low) price = Math.ceil(input.low);
  if (price > input.high || price < input.minimum) return null;
  return price;
}

export function estimatedProfitGtq(priceGtq: number, costGtq: string, expenseShareGtq: string): string | null {
  const price = Math.round(priceGtq * 100);
  const cost = cents(costGtq);
  const share = cents(expenseShareGtq);
  if (cost == null || share == null) return null;
  return formatCents(price - cost - share);
}

export function adviseSalePrice(input: {
  itemType?: string;
  brand?: string;
  condition?: string;
  individualCost?: unknown;
  lotAverage?: unknown;
  settings?: PricingSettingsInput | null;
  guides?: readonly StorePriceGuide[];
}): SaleAdvice {
  const chosen = chooseGarmentCost({ individual: input.individualCost, lotAverage: input.lotAverage });
  const share = input.settings ? monthlyExpenseShare(input.settings) : null;
  const base = {
    costSource: chosen.source,
    costGtq: chosen.costGtq,
    expenseShareGtq: share,
    minimumGtq: null,
    recommendedGtq: null,
    profitGtq: null,
  };
  const gaps = saleAdviceGaps(input);
  if (gaps.length > 0) {
    return { ...base, status: "waiting", notice: gaps.join(" ") };
  }
  if (!chosen.costGtq) return { ...base, status: "need-cost", notice: SALE_ADVICE_MESSAGES.needCost };
  if (!input.settings || !share) return { ...base, status: "need-settings", notice: SALE_ADVICE_MESSAGES.needSettings };
  const minimum = minimumSaleQuetzales(chosen.costGtq, share, input.settings.minimumProfitGtq);
  if (minimum == null) return { ...base, status: "need-settings", notice: SALE_ADVICE_MESSAGES.needSettings };
  const range = listedPriceRange(input.guides ?? [], input);
  if (!range) {
    return { ...base, status: "no-reference", minimumGtq: minimum, notice: SALE_ADVICE_MESSAGES.noReference };
  }
  const recommended = recommendListedPrice({ ...range, minimum });
  if (recommended == null) {
    return { ...base, status: "review", minimumGtq: minimum, notice: SALE_ADVICE_MESSAGES.review };
  }
  return {
    ...base,
    status: "ready",
    minimumGtq: minimum,
    recommendedGtq: recommended,
    profitGtq: estimatedProfitGtq(recommended, chosen.costGtq, share),
    notice: "",
  };
}

export interface QuotedSalePrice {
  status: SaleAdvice["status"];
  minimumGtq: number | null;
  recommendedGtq: number | null;
  notice: string;
  costGtq?: string | null;
  costSource?: GarmentCostSource;
  expenseShareGtq?: string | null;
  profitGtq?: string | null;
}

export function presentSaleAdvice(advice: SaleAdvice, role: "propietario" | "encargado"): QuotedSalePrice {
  const notice = role === "encargado" ? staffSaleNotice(advice) : advice.notice;
  const prices: QuotedSalePrice = {
    status: advice.status,
    minimumGtq: advice.minimumGtq,
    recommendedGtq: advice.recommendedGtq,
    notice,
  };
  if (role !== "propietario") return prices;
  return {
    ...prices,
    costGtq: advice.costGtq,
    costSource: advice.costSource,
    expenseShareGtq: advice.expenseShareGtq,
    profitGtq: advice.profitGtq,
  };
}

function staffSaleNotice(advice: SaleAdvice): string {
  if (advice.status === "need-settings") return SALE_ADVICE_MESSAGES.staffNeedSettings;
  if (advice.status === "need-cost") return SALE_ADVICE_MESSAGES.staffNeedCost;
  if (advice.status === "waiting") return advice.notice || SALE_ADVICE_MESSAGES.needDetails;
  if (advice.status === "no-reference") return SALE_ADVICE_MESSAGES.noReference;
  if (advice.status === "review") return SALE_ADVICE_MESSAGES.review;
  return "";
}

export function priceIsBelowMinimum(price: unknown, minimumGtq: number | null): boolean {
  if (minimumGtq == null) return false;
  const text = moneyText(price);
  const amount = text ? cents(text) : null;
  if (amount == null) return false;
  return amount < minimumGtq * 100;
}

export function supportPhotoSuggestions(listing: {
  itemType?: string;
  title?: string;
  brand?: string;
  size?: string;
  condition?: string;
}): { itemType: string; brand: string; size: string; condition: string; labelReadable: boolean } {
  const kind = garmentKind(listing.itemType, listing.title);
  const brand = brandKey(listing.brand) ? listing.brand!.trim() : "";
  const size = typeof listing.size === "string" ? listing.size.trim() : "";
  const bucket = conditionBucket(listing.condition);
  const condition = bucket === "nuevo" ? "NEW_WITH_TAGS" : bucket === "usado" ? "GOOD" : "";
  const knownCondition = GUATEMALA_CONDITION_CHOICES.some((choice) => choice.value === condition);
  return {
    itemType: kind && unpublishedItemType(kind.key) ? kind.key : "",
    brand,
    size,
    condition: knownCondition ? condition : "",
    labelReadable: Boolean(brand || size),
  };
}

function cents(value: string): number | null {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 100 + Number(match[2]);
}

function formatCents(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
