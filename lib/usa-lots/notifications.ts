import crypto from "crypto";

export const ORDER_CONFIRMATION_TOPIC = "ORDER_CONFIRMATION";

export const PAID_SALE_TOPIC_IDS = [ORDER_CONFIRMATION_TOPIC] as const;

export interface SaleTopicChoice {
  id: string;
  schemaVersion: string;
  authorizationScopes: string[];
  status: string;
}

export function selectPaidSaleTopics(topics: SaleTopicChoice[], grantedScopes: string[] | null): {
  selected: SaleTopicChoice[];
  unavailable: string[];
  unauthorized: { id: string; missingScopes: string[] }[];
} {
  const granted = grantedScopes === null ? null : new Set(grantedScopes.map((scope) => scope.trim()).filter(Boolean));
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const selected: SaleTopicChoice[] = [];
  const unavailable: string[] = [];
  const unauthorized: { id: string; missingScopes: string[] }[] = [];
  for (const id of PAID_SALE_TOPIC_IDS) {
    const topic = byId.get(id);
    if (!topic || topic.status.toUpperCase() === "DISABLED") {
      unavailable.push(id);
      continue;
    }
    if (granted) {
      const missingScopes = topic.authorizationScopes.filter((scope) => !granted.has(scope));
      if (missingScopes.length) {
        unauthorized.push({ id, missingScopes });
        continue;
      }
    }
    selected.push(topic);
  }
  return { selected, unavailable, unauthorized };
}

export function challengeResponse(challenge: string, token: string, endpoint: string): string {
  return crypto.createHash("sha256").update(`${challenge}${token}${endpoint}`).digest("hex");
}

export function notificationTokenReady(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,80}$/.test(token);
}

export function orderIdFromNotification(body: unknown): { orderId: string; topic: string } {
  if (!body || typeof body !== "object") return { orderId: "", topic: "" };
  const record = body as Record<string, unknown>;
  const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as { topic?: unknown } : null;
  const topic = String(metadata?.topic ?? record.topic ?? "").slice(0, 80);
  const data = record.notification && typeof record.notification === "object" ? record.notification as Record<string, unknown> : record;
  const nested = data.data && typeof data.data === "object" ? data.data as Record<string, unknown> : data;
  const order = nested.order && typeof nested.order === "object" ? nested.order as { orderId?: unknown } : null;
  const raw = String(order?.orderId ?? nested.orderId ?? "");
  const orderId = /^[A-Za-z0-9-]{6,64}$/.test(raw) ? raw : "";
  return { orderId, topic };
}

export function decodeSignatureHeader(header: string): { kid: string; signature: string; digest: "sha1" | "sha256" } | null {
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as { kid?: unknown; signature?: unknown; digest?: unknown };
    const kid = String(parsed.kid ?? "").trim();
    const signature = String(parsed.signature ?? "").trim();
    if (!kid || !signature) return null;
    const digest = String(parsed.digest ?? "SHA1").toUpperCase() === "SHA256" ? "sha256" : "sha1";
    return { kid, signature, digest };
  } catch {
    return null;
  }
}

export function verifyEbayNotification(rawBody: string, signatureHeader: string, publicKeyPem: string): boolean {
  const decoded = decodeSignatureHeader(signatureHeader);
  if (!decoded || !publicKeyPem.trim()) return false;
  try {
    const verifier = crypto.createVerify(decoded.digest);
    verifier.update(rawBody, "utf8");
    verifier.end();
    return verifier.verify(publicKeyPem, decoded.signature, "base64");
  } catch {
    return false;
  }
}
