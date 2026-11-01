export function usdToCents(value: string): number | null {
  const text = value.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function centsToUsd(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "Pendiente";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}$${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
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
