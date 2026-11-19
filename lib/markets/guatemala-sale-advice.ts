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
  needOwnerPricing: "Configura el sueldo mensual del encargado y las prendas estimadas al mes en Configurar precios.",
  noReference: "Sin referencia de precio",
  review: "Revisar con el dueño",
  labelUnread: "La etiqueta no se leyó. Escribe la marca y la talla a mano.",
  estimateBelowMinimum: "Sin margen para rebaja",
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
  salaryGtq?: string | null;
  estimatedMonthlySales?: number | null;
  minimumGtq: number | null;
  recommendedGtq: number | null;
  marketEstimateGtq?: number | null;
  reasonableUpToGtq?: number | null;
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

// The configured salary is only for the price. The real payment is recorded once
// in Gastos and is not added again. Lot expenses already sit inside the garment cost.
export function monthlyExpenseShare(settings: PricingSettingsInput): string | null {
  const salary = cents(settings.monthlySalaryGtq);
  if (salary == null || settings.expectedMonthlySales <= 0) return null;
  return formatCents(Math.round(salary / settings.expectedMonthlySales));
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

function priceGuideKeys(itemType: string | undefined, kindKey: string): string[] {
  if (itemType?.trim().toLowerCase() === "playera") return ["playera", "camiseta"];
  return [kindKey];
}

function guideForGarment(
  guides: readonly StorePriceGuide[],
  scope: StorePriceGuide["scope"],
  keys: readonly string[],
  condition: string,
  brand?: string | null
): StorePriceGuide | null {
  for (const key of keys) {
    const found = guides.find((guide) => {
      if (guide.scope !== scope || guide.garment !== key || guide.condition !== condition) return false;
      if (scope === "brand") return brandsMatch(brand ?? null, brandKey(guide.brand));
      return true;
    });
    if (found) return found;
  }
  return null;
}

export function listedPriceRange(
  guides: readonly StorePriceGuide[],
  query: { itemType?: string; brand?: string; condition?: string }
): { low: number; high: number } | null {
  const kind = garmentKind(query.itemType);
  const condition = conditionBucket(query.condition);
  if (!kind || !condition) return null;
  const keys = priceGuideKeys(query.itemType, kind.key);
  const general = guideForGarment(guides, "general", keys, condition);
  if (!general) return null;
  let low = numberOrNull(general.lowGtq);
  let high = numberOrNull(general.highGtq);
  if (low == null || high == null) {
    if (general.priceGtq == null) return null;
    low = general.priceGtq;
    high = general.priceGtq;
  }
  const wanted = brandKey(query.brand);
  const adjustment = wanted ? guideForGarment(guides, "brand", keys, condition, wanted) : null;
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

export const DISCOUNT_ROOM_GTQ = 5;

export interface MarketEstimate {
  priceGtq: number;
  reasonableUpToGtq: number;
}

export function saleEstimateQuote(raw: string): MarketEstimate | null {
  const data = readEstimateJson(raw);
  const price = wholeSaleQuetzales(data?.priceGtq);
  if (price == null) return null;
  const ceiling = wholeSaleQuetzales(data?.reasonableUpToGtq) ?? price;
  return { priceGtq: price, reasonableUpToGtq: Math.max(price, ceiling) };
}

export function saleEstimateQuetzales(raw: string): number | null {
  return saleEstimateQuote(raw)?.priceGtq ?? null;
}

function readEstimateJson(raw: string): { priceGtq?: unknown; reasonableUpToGtq?: unknown } | null {
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text) as { priceGtq?: unknown; reasonableUpToGtq?: unknown };
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as { priceGtq?: unknown; reasonableUpToGtq?: unknown };
    } catch {
      return null;
    }
  }
}

export function wholeSaleQuetzales(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(typeof value === "string" ? value.trim() : Number.NaN);
  if (!Number.isFinite(amount)) return null;
  const quetzales = Math.round(amount);
  if (quetzales < 1 || quetzales > 5000) return null;
  return quetzales;
}

// Keep Q5 of room to discount when the AI price sits close to the minimum.
// A price that already clears that room is published as recommended. Otherwise
// publish the minimum plus Q5 only when the AI still calls that price reasonable.
export function applyMarketEstimate(advice: SaleAdvice, estimate: number | MarketEstimate | null): SaleAdvice {
  if (advice.status !== "ready" || advice.minimumGtq == null) return advice;
  const quote =
    typeof estimate === "number"
      ? { priceGtq: estimate, reasonableUpToGtq: estimate }
      : estimate;
  const price = wholeSaleQuetzales(quote?.priceGtq);
  if (price == null) return advice;
  const ceiling = wholeSaleQuetzales(quote?.reasonableUpToGtq) ?? price;
  const withRoom = advice.minimumGtq + DISCOUNT_ROOM_GTQ;
  const high = Math.max(price, ceiling);
  const recommended = price >= withRoom ? price : high >= withRoom ? withRoom : high > advice.minimumGtq ? high : advice.minimumGtq;
  const profit =
    advice.costGtq && advice.expenseShareGtq
      ? estimatedProfitGtq(recommended, advice.costGtq, advice.expenseShareGtq)
      : advice.profitGtq;
  return {
    ...advice,
    recommendedGtq: recommended,
    marketEstimateGtq: price,
    reasonableUpToGtq: Math.max(price, ceiling),
    profitGtq: profit,
    notice: price < advice.minimumGtq && recommended === advice.minimumGtq ? SALE_ADVICE_MESSAGES.estimateBelowMinimum : "",
  };
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
  if (!input.settings || !share) return { ...base, status: "need-settings", notice: SALE_ADVICE_MESSAGES.needOwnerPricing };
  const minimum = minimumSaleQuetzales(chosen.costGtq, share, input.settings.minimumProfitGtq);
  if (minimum == null) return { ...base, status: "need-settings", notice: SALE_ADVICE_MESSAGES.needOwnerPricing };
  const range = listedPriceRange(input.guides ?? [], input);
  const fromTable = range ? recommendListedPrice({ ...range, minimum }) : null;
  const recommended = fromTable ?? minimum;
  return {
    ...base,
    status: "ready",
    minimumGtq: minimum,
    recommendedGtq: recommended,
    profitGtq: estimatedProfitGtq(recommended, chosen.costGtq, share),
    salaryGtq: input.settings.monthlySalaryGtq,
    estimatedMonthlySales: input.settings.expectedMonthlySales,
    notice: "",
  };
}

export interface QuotedSalePrice {
  status: SaleAdvice["status"];
  minimumGtq: number | null;
  recommendedGtq: number | null;
  marketEstimateGtq?: number | null;
  reasonableUpToGtq?: number | null;
  notice: string;
  costGtq?: string | null;
  costSource?: GarmentCostSource;
  expenseShareGtq?: string | null;
  salaryGtq?: string | null;
  estimatedMonthlySales?: number | null;
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
    marketEstimateGtq: advice.marketEstimateGtq,
    reasonableUpToGtq: advice.reasonableUpToGtq,
    salaryGtq: advice.salaryGtq,
    estimatedMonthlySales: advice.estimatedMonthlySales,
    profitGtq: advice.profitGtq,
  };
}

function staffSaleNotice(advice: SaleAdvice): string {
  if (advice.status === "need-settings") return SALE_ADVICE_MESSAGES.staffNeedSettings;
  if (advice.status === "need-cost") return SALE_ADVICE_MESSAGES.staffNeedCost;
  if (advice.status === "waiting") return advice.notice || SALE_ADVICE_MESSAGES.needDetails;
  if (advice.status === "no-reference") return SALE_ADVICE_MESSAGES.noReference;
  if (advice.status === "review") return SALE_ADVICE_MESSAGES.review;
  if (advice.notice === SALE_ADVICE_MESSAGES.estimateBelowMinimum) return advice.notice;
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
