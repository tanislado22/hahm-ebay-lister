export function usdToCents(value: string): number | null {
  const text = value.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  const abs = Math.abs(Math.trunc(cents));
  return `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function centsToUsd(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "Pendiente";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}$${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function divideRounded(numerator: number, denominator: number): number {
  const negative = numerator < 0 !== denominator < 0;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const whole = Math.floor(n / d);
  const remainder = n % d;
  const rounded = whole + (remainder * 2 >= d ? 1 : 0);
  return negative ? -rounded : rounded;
}

/** Dollars for an exact cent fraction. The stored numerator and denominator stay unchanged. */
export function ratioToUsd(numerator: number, denominator: number): string {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator === 0) return "Pendiente";
  const negative = numerator < 0 !== denominator < 0;
  const micro = divideRounded(Math.abs(numerator) * 1_000_000, Math.abs(denominator) * 100);
  const dollars = Math.floor(micro / 1_000_000);
  const frac = String(micro % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}$${dollars}.${frac.length < 2 ? frac.padEnd(2, "0") : frac}`;
}

export function moneyCents(value: unknown, currency?: unknown): number | null {
  if (currency != null && String(currency).trim() !== "" && String(currency).trim().toUpperCase() !== "USD") return null;
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const cents = Math.round(value * 100);
    return Number.isSafeInteger(cents) ? cents : null;
  }
  return usdToCents(String(value));
}
