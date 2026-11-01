import { readEbayAccountEmail } from "@/lib/archive/ebay-read";
import { basicAuthHeader, EBAY_SCOPES, EBAY_TOKEN_URL, getEbayCreds, isEbayConfigured } from "@/lib/ebay/config";
import { grantedScopesFrom } from "@/lib/ebay/oauth";
import {
  continuationFrom,
  describeEbayFailure,
  ebayAuthRejected,
  needsNotificationConfig,
  notificationCollectionUrl,
  notificationConfigUrl,
  validAlertEmail,
} from "@/lib/usa-lots/notify-api";
import { notificationTokenReady, PAID_SALE_TOPIC_IDS, selectPaidSaleTopics, type SaleTopicChoice } from "@/lib/usa-lots/notifications";

const NOTIFICATION_API = "https://api.ebay.com/commerce/notification/v1";

interface StoredSubscription {
  id: string;
  topicId: string;
  destinationId: string;
  status: string;
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

function topicsFrom(body: unknown): SaleTopicChoice[] {
  const topics = Array.isArray(record(body)?.topics) ? record(body)?.topics as unknown[] : [];
  return topics.flatMap((entry) => {
    const topic = record(entry);
    const id = String(topic?.topicId ?? "").trim();
    if (!id) return [];
    const payloads = Array.isArray(topic?.supportedPayloads) ? topic.supportedPayloads : [];
    const first = record(payloads[0]);
    const schemaVersion = String(first?.schemaVersion ?? "1.0").trim() || "1.0";
    const authorizationScopes = Array.isArray(topic?.authorizationScopes)
      ? topic.authorizationScopes.map((scope) => String(scope).trim()).filter(Boolean)
      : [];
    return [{ id, schemaVersion, authorizationScopes, status: String(topic?.status ?? "ENABLED") }];
  });
}

function destinationFor(body: unknown, endpoint: string): { id: string; status: string } {
  const destinations = Array.isArray(record(body)?.destinations) ? record(body)?.destinations as unknown[] : [];
  for (const entry of destinations) {
    const destination = record(entry);
    const config = record(destination?.deliveryConfig);
    if (String(config?.endpoint ?? "") !== endpoint) continue;
    return { id: String(destination?.destinationId ?? ""), status: String(destination?.status ?? "") };
  }
  return { id: "", status: "" };
}

function subscriptionsFrom(body: unknown): StoredSubscription[] {
  const subscriptions = Array.isArray(record(body)?.subscriptions) ? record(body)?.subscriptions as unknown[] : [];
  return subscriptions.flatMap((entry) => {
    const subscription = record(entry);
    const id = String(subscription?.subscriptionId ?? "").trim();
    const topicId = String(subscription?.topicId ?? "").trim();
    if (!id || !topicId) return [];
    return [{
      id,
      topicId,
      destinationId: String(subscription?.destinationId ?? ""),
      status: String(subscription?.status ?? "ENABLED"),
    }];
  });
}

export async function subscribeSaleNotifications(input: {
  token: string;
  endpoint: string;
  verificationToken: string;
  grantedScopes: string[];
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

  const grantedScopes = grantedScopesFrom(input.grantedScopes);
  if (!grantedScopes.length) {
    return {
      ok: false,
      lines: [],
      error: "eBay no informó los permisos concedidos a esta cuenta. No se usó la lista de la aplicación. ORDER_CONFIRMATION no quedó suscrita.",
    };
  }
  const decision = selectPaidSaleTopics(listed.topics, grantedScopes);
  const lines = decisionLines(decision, new Set(EBAY_SCOPES.split(/\s+/)));
  const currentDestinations = await ebayJson(input.token, "GET", notificationCollectionUrl("destination"));
  if (currentDestinations.status < 200 || currentDestinations.status >= 300) {
    return {
      ok: false,
      lines,
      error: `No se pudo leer el destino de notificaciones. ${describeEbayFailure(currentDestinations.status, currentDestinations.body, [input.verificationToken, input.token])}`,
    };
  }
  let destination = destinationFor(currentDestinations.body, input.endpoint);
  const reusedDestination = Boolean(destination.id);
  if (!destination.id && decision.selected.length) {
    const prepared = await ensureAlertConfig(input.token, input.verificationToken);
    if (!prepared.ok) return { ok: false, lines, error: prepared.error };
    const created = await createDestination(input.token, input.endpoint, input.verificationToken);
    destination = { id: created.id, status: "" };
    if (!destination.id) {
      const again = await ebayJson(input.token, "GET", notificationCollectionUrl("destination"));
      destination = destinationFor(again.body, input.endpoint);
    }
    if (!destination.id) {
      return {
        ok: false,
        lines,
        error: `No se pudo registrar el destino de notificaciones. ${created.error}`,
      };
    }
    lines.push("eBay ya tiene la configuración de alertas que exige antes de aceptar un destino.");
  }
  if (!destination.id) return { ok: false, lines, error: notSubscribedError(lines, "") };

  const currentSubscriptions = await readSubscriptions(input.token);
  if (!currentSubscriptions.ok) {
    return {
      ok: false,
      lines,
      error: `No se pudo leer las suscripciones existentes. ${describeEbayFailure(currentSubscriptions.status, currentSubscriptions.body, [input.verificationToken, input.token])}`,
    };
  }
  const onDestination = currentSubscriptions.items.filter((item) => item.destinationId === destination.id);
  const allowed = new Set<string>(PAID_SALE_TOPIC_IDS);
  const removed: string[] = [];
  const removeErrors: string[] = [];
  for (const extra of onDestination) {
    if (allowed.has(extra.topicId)) continue;
    const deleted = await deleteSubscription(input.token, extra.id);
    if (deleted.ok) removed.push(extra.topicId);
    else removeErrors.push(`${extra.topicId}: ${describeEbayFailure(deleted.status, deleted.body, [input.verificationToken, input.token])}`);
  }
  if (removed.length) lines.push(`Se eliminaron suscripciones que no registran ventas pagadas: ${removed.join(", ")}.`);
  if (removeErrors.length) lines.push(`No se pudieron eliminar estas suscripciones ajenas: ${removeErrors.join(" ")}`);

  const payloadFor = (topic: SaleTopicChoice) => ({
    topicId: topic.id,
    status: "ENABLED",
    destinationId: destination.id,
    payload: {
      format: "JSON",
      schemaVersion: topic.schemaVersion,
      deliveryProtocol: "HTTPS",
    },
  });
  const createdTopics: string[] = [];
  for (const topic of decision.selected) {
    const existing = onDestination.find((item) => item.topicId === topic.id);
    if (existing && existing.status.toUpperCase() !== "DISABLED") continue;
    if (existing) {
      const updated = await ebayJson(input.token, "PUT", `${NOTIFICATION_API}/subscription/${encodeURIComponent(existing.id)}`, payloadFor(topic));
      if (updated.status >= 200 && updated.status < 300) {
        createdTopics.push(topic.id);
        continue;
      }
    }
    const created = await ebayJson(input.token, "POST", `${NOTIFICATION_API}/subscription`, payloadFor(topic));
    if (created.status >= 200 && created.status < 300) {
      createdTopics.push(topic.id);
      continue;
    }
    if (!subscriptionAlreadyExists(created.body)) {
      return {
        ok: false,
        lines,
        error: `No se pudo suscribir ${topic.id}. ${describeEbayFailure(created.status, created.body, [input.verificationToken, input.token])} ORDER_CONFIRMATION no quedó suscrita.`,
      };
    }
  }
  if (!decision.selected.length) {
    return { ok: false, lines, error: notSubscribedError(lines, reusedDestination ? destination.status : "") };
  }
  const confirmed = await readSubscriptions(input.token);
  if (!confirmed.ok) {
    return {
      ok: false,
      lines,
      error: `ORDER_CONFIRMATION no quedó confirmada. ${describeEbayFailure(confirmed.status, confirmed.body, [input.verificationToken, input.token])}`,
    };
  }
  const active = confirmed.items.find((item) => (
    item.destinationId === destination.id
    && item.topicId === "ORDER_CONFIRMATION"
    && item.status.toUpperCase() === "ENABLED"
  ));
  if (!active) {
    return { ok: false, lines, error: notSubscribedError(lines, reusedDestination ? destination.status : "") };
  }
  const kept = destinationNote(reusedDestination, destination.status);
  lines.push(createdTopics.length
    ? `ORDER_CONFIRMATION quedó suscrita y activa.${kept}`
    : `ORDER_CONFIRMATION ya estaba suscrita y activa. No se duplicó.${kept}`);
  lines.push(`Destino: ${input.endpoint}.`);
  return { ok: true, lines };
}

function destinationNote(reused: boolean, status: string): string {
  if (!reused) return " Se registró el destino.";
  return status
    ? ` El destino existente sigue ${status} y no se creó otro.`
    : " Se conservó el destino existente y no se creó otro.";
}

function notSubscribedError(lines: string[], destinationStatus: string): string {
  const kept = destinationStatus
    ? ` El destino existente sigue ${destinationStatus} y no se creó otro.`
    : "";
  return `ORDER_CONFIRMATION no quedó suscrita.${kept} ${lines.join(" ")}`.replace(/\s+/g, " ").trim();
}

function subscriptionAlreadyExists(body: unknown): boolean {
  const errors = Array.isArray(record(body)?.errors) ? record(body)?.errors as unknown[] : [];
  return errors.some((entry) => Number(record(entry)?.errorId) === 195012);
}

function decisionLines(decision: ReturnType<typeof selectPaidSaleTopics>, requestedScopes: Set<string>): string[] {
  const lines: string[] = [];
  if (decision.selected.length) {
    lines.push(`Evento de venta pagada concedido a esta cuenta: ${decision.selected.map((topic) => topic.id).join(", ")}.`);
  }
  for (const id of decision.unavailable) {
    lines.push(`${id} no está disponible en la lista oficial de esta aplicación. No se inventó. Las ventas pagadas se siguen leyendo en la consulta diaria de pedidos.`);
  }
  for (const item of decision.unauthorized) {
    const notGranted = item.missingScopes.filter((scope) => requestedScopes.has(scope));
    const notRequested = item.missingScopes.filter((scope) => !requestedScopes.has(scope));
    const parts = [`${item.id} no se suscribió.`];
    if (notGranted.length) {
      parts.push(`Esta cuenta no tiene concedido: ${notGranted.join(", ")}. Estar marcado en la aplicación no concede ese permiso. El enlace de autorización ya lo pide; vuelve a conectar eBay cuando esta corrección esté en producción.`);
    }
    if (notRequested.length) {
      parts.push(`El enlace de autorización no solicita: ${notRequested.join(", ")}.`);
    }
    lines.push(parts.join(" "));
  }
  lines.push("Solo se usa el identificador exacto ORDER_CONFIRMATION. No se elige ningún evento por coincidencia parcial del nombre. Cancelaciones y reembolsos se actualizan cuando la consulta diaria lee el pedido.");
  return lines;
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

async function readSubscriptions(token: string): Promise<{ ok: true; items: StoredSubscription[] } | { ok: false; status: number; body: unknown }> {
  const items: StoredSubscription[] = [];
  let continuation = "";
  for (let page = 0; page < 5; page += 1) {
    const listed = await ebayJson(token, "GET", notificationCollectionUrl("subscription", continuation));
    if (listed.status < 200 || listed.status >= 300) return { ok: false, status: listed.status, body: listed.body };
    items.push(...subscriptionsFrom(listed.body));
    continuation = continuationFrom(listed.body);
    if (!continuation) return { ok: true, items };
  }
  return { ok: true, items };
}

async function deleteSubscription(token: string, id: string): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const response = await ebayJson(token, "DELETE", `${NOTIFICATION_API}/subscription/${encodeURIComponent(id)}`);
  if (response.status === 204 || response.status === 200 || response.status === 404) return { ok: true };
  if (ebayAuthRejected(response.status, response.body)) {
    const appToken = await applicationToken();
    if (appToken) {
      const again = await ebayJson(appToken, "DELETE", `${NOTIFICATION_API}/subscription/${encodeURIComponent(id)}`);
      if (again.status === 204 || again.status === 200 || again.status === 404) return { ok: true };
      return { ok: false, status: again.status, body: again.body };
    }
  }
  return { ok: false, status: response.status, body: response.body };
}

async function readTopics(userToken: string, verificationToken: string): Promise<{ ok: true; topics: SaleTopicChoice[] } | { ok: false; error: string }> {
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

async function readTopicPages(token: string): Promise<{ ok: true; topics: SaleTopicChoice[] } | { ok: false; status: number; body: unknown }> {
  const topics: SaleTopicChoice[] = [];
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
