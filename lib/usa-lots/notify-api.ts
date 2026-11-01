const NOTIFICATION_API = "https://api.ebay.com/commerce/notification/v1";
const STORE_HOST = /(^|\.)variedadessanandres\.com$/i;

export function notificationCollectionUrl(resource: "topic" | "destination" | "subscription", continuationToken = ""): string {
  const url = new URL(`${NOTIFICATION_API}/${resource}`);
  url.searchParams.set("limit", "100");
  if (continuationToken) url.searchParams.set("continuation_token", continuationToken);
  return url.toString();
}

export function continuationFrom(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const next = String((body as { next?: unknown }).next ?? "");
  if (!next) return "";
  try {
    const url = new URL(next, NOTIFICATION_API);
    if (url.hostname !== "api.ebay.com" || !url.pathname.startsWith("/commerce/notification/v1/")) return "";
    return url.searchParams.get("continuation_token") ?? "";
  } catch {
    return "";
  }
}

export function describeEbayFailure(status: number, body: unknown, secrets: string[]): string {
  const errors = body && typeof body === "object" && Array.isArray((body as { errors?: unknown }).errors)
    ? (body as { errors: unknown[] }).errors
    : [];
  const parts = errors.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const error = entry as { errorId?: unknown; message?: unknown; longMessage?: unknown };
    const id = String(error.errorId ?? "").trim();
    const message = String(error.longMessage || error.message || "").trim();
    const text = `${id} ${message}`.trim();
    return text ? [text] : [];
  });
  let text = parts.length ? parts.join(" ") : `HTTP ${status}`;
  for (const secret of secrets) {
    if (secret.length >= 8) text = text.split(secret).join("[oculto]");
  }
  return text.replace(/\s+/g, " ").slice(0, 280);
}

export function ebayAuthRejected(status: number, body: unknown): boolean {
  if (status === 401 || status === 403) return true;
  return /\b(1001|1002|1100)\b/.test(describeEbayFailure(status, body, []));
}

function hostName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function notificationEndpoint(input: { productionHost?: string | null; requestOrigin?: string | null }): { endpoint: string } | { error: string } {
  const hosts = [input.productionHost, input.requestOrigin];
  for (const candidate of hosts) {
    const host = hostName(candidate ?? "");
    if (!host || STORE_HOST.test(host)) continue;
    return { endpoint: `https://${host}/api/ebay/notificaciones` };
  }
  return {
    error: "Las notificaciones tienen que llegar a la dirección https del listador. variedadessanandres.com no acepta esta llamada.",
  };
}
