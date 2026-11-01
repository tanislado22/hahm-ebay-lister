import { readEbayAccountEmail } from "@/lib/archive/ebay-read";
import { basicAuthHeader, EBAY_TOKEN_URL, getEbayCreds, isEbayConfigured } from "@/lib/ebay/config";
import {
  continuationFrom,
  describeEbayFailure,
  ebayAuthRejected,
  needsNotificationConfig,
  notificationCollectionUrl,
  notificationConfigUrl,
  validAlertEmail,
} from "@/lib/usa-lots/notify-api";
import { notificationTokenReady, topicsForSales } from "@/lib/usa-lots/notifications";

const NOTIFICATION_API = "https://api.ebay.com/commerce/notification/v1";

interface TopicChoice {
  id: string;
  schemaVersion: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

async function ebayJson(token: string, method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown; location: string }> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed, location: response.headers.get("location") ?? "" };
}

function destinationIdFrom(response: { body: unknown; location: string }): string {
  const bodyId = String(record(response.body)?.destinationId ?? "").trim();
  if (bodyId) return bodyId;
  const locationId = response.location.split("/").filter(Boolean).pop() ?? "";
  return /^[A-Za-z0-9_-]{4,80}$/.test(locationId) ? locationId : "";
}

async function ensureAlertConfig(userToken: string, verificationToken: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const appToken = await applicationToken();
  const tokens = [appToken, userToken].filter(Boolean);
  const secrets = [verificationToken, userToken, appToken];
  for (const token of tokens) {
    const current = await ebayJson(token, "GET", notificationConfigUrl());
    const existing = validAlertEmail(String(record(current.body)?.alertEmail ?? ""));
    if (current.status === 200 && existing) return { ok: true };
  }
  const email = validAlertEmail(process.env.EBAY_NOTIFICATION_ALERT_EMAIL ?? "") || await readEbayAccountEmail(userToken);
  if (!email) {
    return {
      ok: false,
      error: "eBay no acepta el destino hasta guardar un correo de alertas en /config (error 195003). Agrega EBAY_NOTIFICATION_ALERT_EMAIL en Vercel y vuelve a desplegar. No se creó el destino.",
    };
  }
  secrets.push(email);
  let lastStatus = 0;
  let lastBody: unknown = null;
  for (const token of tokens) {
    const saved = await ebayJson(token, "PUT", notificationConfigUrl(), { alertEmail: email });
    if (saved.status === 204 || saved.status === 200) return { ok: true };
    lastStatus = saved.status;
    lastBody = saved.body;
  }
  return { ok: false, error: `eBay no guardó la configuración de alertas. ${describeEbayFailure(lastStatus, lastBody, secrets)}` };
}

async function createDestination(userToken: string, endpoint: string, verificationToken: string): Promise<{ id: string; error: string }> {
  const appToken = await applicationToken();
  const secrets = [verificationToken, userToken, appToken, validAlertEmail(process.env.EBAY_NOTIFICATION_ALERT_EMAIL ?? "")];
  const body = {
    name: "hahm-lotes-ventas",
    status: "ENABLED",
    deliveryConfig: {
      endpoint,
      verificationToken,
    },
  };
  let lastError = "eBay no devolvió el identificador del destino.";
  for (const token of [userToken, appToken].filter(Boolean)) {
    const created = await ebayJson(token, "POST", `${NOTIFICATION_API}/destination`, body);
    const id = destinationIdFrom(created);
    if (id) return { id, error: "" };
    lastError = describeEbayFailure(created.status, created.body, secrets);
    if (!needsNotificationConfig(created.status, created.body) && !ebayAuthRejected(created.status, created.body)) break;
  }
  return { id: "", error: lastError };
}

function topicsFrom(body: unknown): TopicChoice[] {
  const topics = Array.isArray(record(body)?.topics) ? record(body)?.topics as unknown[] : [];
  return topics.flatMap((entry) => {
    const topic = record(entry);
    const id = String(topic?.topicId ?? "").trim();
    if (!id || String(topic?.status ?? "ENABLED").toUpperCase() === "DISABLED") return [];
    const payloads = Array.isArray(topic?.supportedPayloads) ? topic.supportedPayloads : [];
    const first = record(payloads[0]);
    const schemaVersion = String(first?.schemaVersion ?? "1.0").trim() || "1.0";
    return [{ id, schemaVersion }];
  });
}

function destinationIdFor(body: unknown, endpoint: string): string {
  const destinations = Array.isArray(record(body)?.destinations) ? record(body)?.destinations as unknown[] : [];
  for (const entry of destinations) {
    const destination = record(entry);
    const config = record(destination?.deliveryConfig);
    if (String(config?.endpoint ?? "") === endpoint) return String(destination?.destinationId ?? "");
  }
  return "";
}

function subscribedTopics(body: unknown, destinationId: string): Set<string> {
  const subscriptions = Array.isArray(record(body)?.subscriptions) ? record(body)?.subscriptions as unknown[] : [];
  const ids = new Set<string>();
  for (const entry of subscriptions) {
    const subscription = record(entry);
    if (String(subscription?.destinationId ?? "") !== destinationId) continue;
    if (String(subscription?.status ?? "ENABLED").toUpperCase() === "DISABLED") continue;
    const id = String(subscription?.topicId ?? "").trim();
    if (id) ids.add(id);
  }
  return ids;
}

export async function subscribeSaleNotifications(input: {
  token: string;
  endpoint: string;
  verificationToken: string;
}): Promise<{ ok: true; lines: string[] } | { ok: false; error: string; lines: string[] }> {
  if (!input.endpoint.startsWith("https://")) {
    return {
      ok: false,
      lines: [],
      error: "Abre Lotes en el sitio publicado en https y pulsa Preparar notificaciones. eBay no puede llamar a una dirección local.",
    };
  }
  if (!notificationTokenReady(input.verificationToken)) {
    return {
      ok: false,
      lines: [],
      error: "EBAY_NOTIFICATION_VERIFICATION_TOKEN tiene que tener entre 32 y 80 letras, números, guiones o guiones bajos. No se envió ninguna suscripción.",
    };
  }

  const listed = await readTopics(input.token, input.verificationToken);
  if (!listed.ok) return { ok: false, lines: [], error: listed.error };

  const available = listed.topics;
  const wanted = new Set(topicsForSales(available.map((topic) => topic.id)));
  const chosen = available.filter((topic) => wanted.has(topic.id));
  const lines = [
    chosen.length
      ? `Eventos disponibles para esta integración: ${chosen.map((topic) => topic.id).join(", ")}.`
      : "La lista oficial no incluye ORDER_CONFIRMATION ni un evento de cancelación, reembolso o devolución. Las ventas se leerán por la consulta periódica de pedidos.",
  ];
  if (!chosen.some((topic) => topic.id.toUpperCase() === "ORDER_CONFIRMATION")) {
    lines.push("ORDER_CONFIRMATION no apareció en getTopics. No se inventó ese evento.");
  }
  lines.push("Cancelaciones y reembolsos se actualizan en la misma venta cuando el pedido los trae. Si eBay no publica un evento para ellos, la consulta periódica es la que los recoge.");
  if (!chosen.length) return { ok: true, lines };

  const currentDestinations = await ebayJson(input.token, "GET", notificationCollectionUrl("destination"));
  let destinationId = destinationIdFor(currentDestinations.body, input.endpoint);
  if (!destinationId) {
    const prepared = await ensureAlertConfig(input.token, input.verificationToken);
    if (!prepared.ok) return { ok: false, lines, error: prepared.error };
    const created = await createDestination(input.token, input.endpoint, input.verificationToken);
    destinationId = created.id;
    if (!destinationId) {
      const again = await ebayJson(input.token, "GET", notificationCollectionUrl("destination"));
      destinationId = destinationIdFor(again.body, input.endpoint);
    }
    if (!destinationId) {
      return {
        ok: false,
        lines,
        error: `No se pudo registrar el destino de notificaciones. ${created.error}`,
      };
    }
    lines.push("eBay ya tiene la configuración de alertas que exige antes de aceptar un destino.");
  }

  const currentSubscriptions = await ebayJson(input.token, "GET", notificationCollectionUrl("subscription"));
  const already = subscribedTopics(currentSubscriptions.body, destinationId);
  const createdTopics: string[] = [];
  for (const topic of chosen) {
    if (already.has(topic.id)) continue;
    const created = await ebayJson(input.token, "POST", `${NOTIFICATION_API}/subscription`, {
      topicId: topic.id,
      status: "ENABLED",
      destinationId,
      payload: {
        format: "JSON",
        schemaVersion: topic.schemaVersion,
        deliveryProtocol: "HTTPS",
      },
    });
    if (created.status < 200 || created.status >= 300) {
      return {
        ok: false,
        lines,
        error: `No se pudo suscribir ${topic.id}. ${describeEbayFailure(created.status, created.body, [input.verificationToken, input.token])}`,
      };
    }
    createdTopics.push(topic.id);
  }
  lines.push(createdTopics.length ? `Suscripciones creadas: ${createdTopics.join(", ")}.` : "Esas suscripciones ya existían. No se duplicaron.");
  lines.push(`Destino registrado: ${input.endpoint}. eBay lo valida con el reto SHA-256 contra esa misma dirección.`);
  return { ok: true, lines };
}

async function applicationToken(): Promise<string> {
  if (!isEbayConfigured()) return "";
  const creds = getEbayCreds();
  const response = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(creds),
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });
  if (!response.ok) return "";
  const body = await response.json().catch(() => null) as { access_token?: string } | null;
  return body?.access_token ?? "";
}

async function readTopics(userToken: string, verificationToken: string): Promise<{ ok: true; topics: TopicChoice[] } | { ok: false; error: string }> {
  const first = await readTopicPages(userToken);
  if (first.ok) return first;
  if (!ebayAuthRejected(first.status, first.body)) {
    return { ok: false, error: `eBay no entregó la lista oficial de eventos. ${describeEbayFailure(first.status, first.body, [verificationToken, userToken])}` };
  }
  const appToken = await applicationToken();
  if (!appToken) {
    return { ok: false, error: `eBay rechazó la consulta de eventos. ${describeEbayFailure(first.status, first.body, [verificationToken, userToken])}` };
  }
  const second = await readTopicPages(appToken);
  if (second.ok) return second;
  return { ok: false, error: `eBay no entregó la lista oficial de eventos. ${describeEbayFailure(second.status, second.body, [verificationToken, userToken, appToken])}` };
}

async function readTopicPages(token: string): Promise<{ ok: true; topics: TopicChoice[] } | { ok: false; status: number; body: unknown }> {
  const topics: TopicChoice[] = [];
  let continuation = "";
  for (let page = 0; page < 5; page += 1) {
    const listed = await ebayJson(token, "GET", notificationCollectionUrl("topic", continuation));
    if (listed.status < 200 || listed.status >= 300) return { ok: false, status: listed.status, body: listed.body };
    topics.push(...topicsFrom(listed.body));
    continuation = continuationFrom(listed.body);
    if (!continuation) return { ok: true, topics };
  }
  return { ok: true, topics };
}
