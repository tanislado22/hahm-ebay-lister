import { GUATEMALA_MARKET } from "@/lib/markets/guatemala";

export type SalesReportPeriod = "hoy" | "semana" | "mes" | "rango";

export interface GuatemalaCivilDate {
  year: number;
  month: number;
  day: number;
}

export interface SalesReportRange {
  period: SalesReportPeriod;
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  start: Date;
  end: Date;
}

export interface ReportSale {
  sku: string;
  title: string;
  publishedPriceGtq: string;
  chargedPriceGtq: string;
  soldAt: string;
  isTest: boolean;
}

const WEEKDAY_FROM_MONDAY: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

export function parseSalesReportPeriod(value: unknown): SalesReportPeriod {
  if (value === "semana" || value === "mes" || value === "rango") return value;
  return "hoy";
}

export function guatemalaCivilDate(date: Date): GuatemalaCivilDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: GUATEMALA_MARKET.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
  };
}

function weekdayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: GUATEMALA_MARKET.timezone,
    weekday: "short",
  }).formatToParts(date);
  return parts.find((part) => part.type === "weekday")?.value ?? "Mon";
}

export function addCivilDays(date: GuatemalaCivilDate, days: number): GuatemalaCivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function civilDateKey(date: GuatemalaCivilDate): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function parseCivilDate(value: string): GuatemalaCivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function compareCivil(left: GuatemalaCivilDate, right: GuatemalaCivilDate): number {
  return civilDateKey(left).localeCompare(civilDateKey(right));
}

export function guatemalaDayStart(date: GuatemalaCivilDate): Date {
  return new Date(`${civilDateKey(date)}T00:00:00-06:00`);
}

export function formatGuatemalaCivilDate(date: GuatemalaCivilDate): string {
  return new Intl.DateTimeFormat(GUATEMALA_MARKET.locale, {
    timeZone: GUATEMALA_MARKET.timezone,
    dateStyle: "long",
  }).format(guatemalaDayStart(date));
}

export function guatemalaSalesRange(input: {
  period: SalesReportPeriod;
  from?: unknown;
  to?: unknown;
  now?: Date;
}): { ok: true; range: SalesReportRange } | { ok: false; error: string } {
  const now = input.now ?? new Date();
  const today = guatemalaCivilDate(now);
  let fromDate = today;
  let toDate = today;
  if (input.period === "semana") {
    const back = WEEKDAY_FROM_MONDAY[weekdayKey(now)] ?? 0;
    fromDate = addCivilDays(today, -back);
    toDate = addCivilDays(fromDate, 6);
  } else if (input.period === "mes") {
    fromDate = { year: today.year, month: today.month, day: 1 };
    toDate = addCivilDays({ year: today.year, month: today.month + 1, day: 1 }, -1);
  } else if (input.period === "rango") {
    const from = parseCivilDate(String(input.from ?? ""));
    const to = parseCivilDate(String(input.to ?? ""));
    if (!from || !to) {
      return { ok: false, error: "Elige un rango de fechas válido." };
    }
    if (compareCivil(from, to) > 0) {
      return { ok: false, error: "La fecha inicial no puede ser posterior a la final." };
    }
    fromDate = from;
    toDate = to;
  }
  const end = guatemalaDayStart(addCivilDays(toDate, 1));
  return {
    ok: true,
    range: {
      period: input.period,
      from: civilDateKey(fromDate),
      to: civilDateKey(toDate),
      fromLabel: formatGuatemalaCivilDate(fromDate),
      toLabel: formatGuatemalaCivilDate(toDate),
      start: guatemalaDayStart(fromDate),
      end,
    },
  };
}

export function saleFallsInRange(soldAt: string, range: SalesReportRange): boolean {
  const time = new Date(soldAt).getTime();
  return time >= range.start.getTime() && time < range.end.getTime();
}

function priceCents(value: string): number {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 100 + Number(match[2]);
}

export function centsToQuetzales(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = String(Math.abs(cents % 100)).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function summarizeChargedSales(
  sales: ReportSale[],
  includeTests: boolean
): { count: number; totalChargedGtq: string; rows: ReportSale[] } {
  const rows = sales.filter((sale) => includeTests || !sale.isTest);
  const cents = rows.reduce((sum, sale) => sum + priceCents(sale.chargedPriceGtq), 0);
  return { count: rows.length, totalChargedGtq: centsToQuetzales(cents), rows };
}

export function soldGarmentLabel(count: number): string {
  return count === 1 ? "1 prenda vendida" : `${count} prendas vendidas`;
}

// A failed or unfinished query has no total. Zero is only valid after a successful query.
export function chargedTotalForDisplay(ready: boolean, totalChargedGtq: string | null): string | null {
  if (!ready || totalChargedGtq == null) return null;
  return totalChargedGtq;
}
