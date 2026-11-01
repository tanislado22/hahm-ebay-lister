import { notificationTokenReady, topicsForSales } from "@/lib/usa-lots/notifications";

const NOTIFICATION_API = "https://api.ebay.com/commerce/notification/v1";

interface TopicChoice {
  id: string;
  schemaVersion: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function safeText(text: string, token: string): string {
  const hidden = token ? text.split(token).join("[token]") : text;
  return hidden.replace(/\s+/g, " ").slice(0, 240);
}

async function ebayJson(token: string, method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown; text: string }> {
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
  return { status: response.status, body: parsed, text };
}

function topicsFrom(body: unknown): TopicChoice[] {
  const topics = Array.isArray(record(body)?.topics) ? record(body)?.topics as unknown[] : [];
  return topics.flatMap((entry) => {
    const topic = record(entry);
    const id = String(topic?.topicId ?? "").trim();
    if (!id) return [];
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

  const listed = await ebayJson(input.token, "GET", `${NOTIFICATION_API}/topic?limit=200`);
  if (listed.status === 401 || listed.status === 403) {
    return {
      ok: false,
      lines: [],
      error: "eBay rechazó la consulta de eventos. Activa commerce.notification.subscription en la aplicación y vuelve a autorizar la cuenta. No se creó la suscripción.",
    };
  }
  if (listed.status < 200 || listed.status >= 300) {
    return { ok: false, lines: [], error: `eBay no entregó la lista oficial de eventos (${listed.status}).` };
  }

  const available = topicsFrom(listed.body);
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

  const currentDestinations = await ebayJson(input.token, "GET", `${NOTIFICATION_API}/destination?limit=100`);
  let destinationId = destinationIdFor(currentDestinations.body, input.endpoint);
  if (!destinationId) {
    const created = await ebayJson(input.token, "POST", `${NOTIFICATION_API}/destination`, {
      name: "hahm-lotes-ventas",
      status: "ENABLED",
      deliveryConfig: {
        endpoint: input.endpoint,
        verificationToken: input.verificationToken,
      },
    });
    destinationId = String(record(created.body)?.destinationId ?? "");
    if (!destinationId) {
      const again = await ebayJson(input.token, "GET", `${NOTIFICATION_API}/destination?limit=100`);
      destinationId = destinationIdFor(again.body, input.endpoint);
    }
    if (!destinationId) {
      return {
        ok: false,
        lines,
        error: `No se pudo registrar el destino de notificaciones. ${safeText(created.text, input.verificationToken)}`,
      };
    }
  }

  const currentSubscriptions = await ebayJson(input.token, "GET", `${NOTIFICATION_API}/subscription?limit=200`);
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
        error: `No se pudo suscribir ${topic.id}. ${safeText(created.text, input.verificationToken)}`,
      };
    }
    createdTopics.push(topic.id);
  }
  lines.push(createdTopics.length ? `Suscripciones creadas: ${createdTopics.join(", ")}.` : "Esas suscripciones ya existían. No se duplicaron.");
  lines.push("eBay validará el destino con el reto SHA-256. La firma de cada aviso se comprueba antes de registrar una venta.");
  return { ok: true, lines };
}
