import { EBAY_MARKETPLACE_ID } from "@/lib/ebay/config";
import { listEbayConnections } from "@/lib/ebay/client-connections";
import { accessTokenFromCookie } from "@/lib/ebay/session";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import { feeFromTransactions } from "@/lib/usa-lots/finances";
import { isReadOnlyOrderRequest, parseFulfillmentOrders, saleLinesToStore } from "@/lib/usa-lots/parse-order";
import { feeGapFromStatus, nextOrderWindow } from "@/lib/usa-lots/sync-plan";
import {
  finishSaleNotice,
  postponeSaleNotice,
  readSyncState,
  saveParsedSales,
  saveSyncState,
  takeSaleNotices,
} from "@/lib/usa-lots/store";

const FULFILLMENT = "https://api.ebay.com/sell/fulfillment/v1";
const FINANCES = "https://apiz.ebay.com/sell/finances/v1/transaction";

type SyncSource = "cron" | "manual" | "notification";

interface Connection {
  connectionKey: string;
  sealedConnection: string;
}

async function ebayGet(token: string, url: string): Promise<{ status: number; body: Record<string, unknown> | null; error: string }> {
  if (!isReadOnlyOrderRequest("GET", url) && !url.startsWith(FINANCES)) {
    return { status: 0, body: null, error: "La sincronización solo lee pedidos." };
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
    },
  });
  const text = await response.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? JSON.parse(text) as Record<string, unknown> : null;
  } catch {
    body = null;
  }
  if (!response.ok) return { status: response.status, body, error: `eBay respondió ${response.status}.` };
  return { status: response.status, body, error: "" };
}

async function usableConnections(accountKey?: string): Promise<Connection[]> {
  const connections = await listEbayConnections();
  const usable: Connection[] = [];
  for (const connection of connections) {
    if (connection.connectionKey.startsWith("client:")) {
      const clientId = connection.connectionKey.slice("client:".length);
      if (await clientIsGuatemala(clientId)) continue;
    }
    if (accountKey && connection.connectionKey !== accountKey) continue;
    usable.push(connection);
  }
  return usable;
}

async function tokenFor(connection: Connection): Promise<string> {
  const token = await accessTokenFromCookie(connection.sealedConnection);
  if (!token) throw new Error("No se pudo renovar el acceso a eBay.");
  return token;
}

async function feesFor(token: string, orderIds: string[]): Promise<{ fees: { orderId: string; feeCents: number | null; sellerShippingCents: number | null }[]; feeNote: string; feeBlocked: boolean }> {
  const fees: { orderId: string; feeCents: number | null; sellerShippingCents: number | null }[] = [];
  for (const orderId of orderIds.slice(0, 5)) {
    const feeUrl = `${FINANCES}?filter=${encodeURIComponent(`orderId:{${orderId}}`)}&limit=20`;
    const response = await fetch(feeUrl, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (response.status === 401 || response.status === 403) {
      return { fees, feeNote: feeGapFromStatus(response.status), feeBlocked: true };
    }
    if (!response.ok) {
      return { fees, feeNote: feeGapFromStatus(response.status) || "No se pudieron leer las comisiones de este pedido. No se anotaron como cero.", feeBlocked: false };
    }
    const body = await response.json() as Record<string, unknown>;
    fees.push({ orderId, ...feeFromTransactions(body, orderId) });
  }
  return { fees, feeNote: "", feeBlocked: false };
}

export async function ingestNotifiedOrder(orderId: string): Promise<"saved" | "unpaid" | "missing" | "retry"> {
  const connections = await usableConnections();
  if (!connections.length) return "retry";
  let tokenFailed = false;
  for (const connection of connections) {
    let token = "";
    try {
      token = await tokenFor(connection);
    } catch {
      tokenFailed = true;
      continue;
    }
    const read = await ebayGet(token, `${FULFILLMENT}/order/${encodeURIComponent(orderId)}`);
    if (read.status === 404) continue;
    if (read.error) return read.status === 429 || read.status >= 500 ? "retry" : "missing";
    const parsed = parseFulfillmentOrders([read.body?.order ?? read.body]);
    const lines = saleLinesToStore(parsed);
    if (!lines.length) return parsed.length ? "unpaid" : "missing";
    const state = await readSyncState(connection.connectionKey);
    const feeState = await feesFor(token, [...new Set(lines.map((line) => line.orderId))]);
    const saved = await saveParsedSales(connection.connectionKey, lines, feeState.fees);
    await saveSyncState({
      accountKey: connection.connectionKey,
      phase: state.phase === "watch" ? "watch" : "backfill",
      cursorEnd: state.cursorEnd,
      nextUrl: state.nextUrl,
      lastError: "",
      feeNote: feeState.feeNote || state.feeNote,
      feeBlocked: feeState.feeBlocked,
      success: true,
      source: "notification",
      saved: saved.saved,
    });
    return "saved";
  }
  return tokenFailed ? "retry" : "missing";
}

async function oldestConnection(connections: Connection[], accountKey?: string): Promise<Connection | undefined> {
  if (accountKey) return connections.find((connection) => connection.connectionKey === accountKey) ?? connections[0];
  let chosen = connections[0];
  let stamp = "9999";
  for (const connection of connections) {
    const state = await readSyncState(connection.connectionKey);
    const attempt = state.lastAttemptAt || "";
    if (attempt < stamp) {
      chosen = connection;
      stamp = attempt;
    }
  }
  return chosen;
}

export async function advanceUsaSaleSync(accountKeyOrOptions?: string | { accountKey?: string; source?: SyncSource }): Promise<{ ok: true; accountKey: string; saved: number; retryable: boolean } | { ok: false; error: string; retryable: boolean }> {
  const accountKey = typeof accountKeyOrOptions === "string" ? accountKeyOrOptions : accountKeyOrOptions?.accountKey;
  const source: SyncSource = typeof accountKeyOrOptions === "string" ? "manual" : accountKeyOrOptions?.source ?? "manual";
  const connections = await usableConnections(accountKey);
  if (!connections.length) return { ok: false, error: "No hay una cuenta de eBay conectada para sincronizar.", retryable: false };

  let savedTotal = 0;
  const notices = await takeSaleNotices(3);
  for (const notice of notices) {
    const result = await ingestNotifiedOrder(notice.orderId);
    if (result === "retry" || result === "unpaid") await postponeSaleNotice(notice.id);
    else await finishSaleNotice(notice.id);
    if (result === "saved") savedTotal += 1;
  }

  const connection = await oldestConnection(connections, accountKey);
  if (!connection) return { ok: false, error: "No hay una cuenta de eBay conectada para sincronizar.", retryable: false };
  const state = await readSyncState(connection.connectionKey);
  let token = "";
  try {
    token = await tokenFor(connection);
  } catch (error) {
    await saveSyncState({
      accountKey: connection.connectionKey,
      phase: state.phase === "watch" ? "watch" : "backfill",
      cursorEnd: state.cursorEnd,
      nextUrl: state.nextUrl,
      lastError: (error as Error).message,
      feeNote: state.feeNote,
      feeBlocked: state.feeBlocked,
      success: false,
      source,
      saved: 0,
    });
    return { ok: false, error: (error as Error).message, retryable: true };
  }

  let phase: "backfill" | "watch" = state.phase === "watch" ? "watch" : "backfill";
  let cursorEnd = state.cursorEnd;
  let nextUrl = state.nextUrl;
  const window = nextOrderWindow({
    now: Date.now(),
    cursorEnd: cursorEnd ? Date.parse(cursorEnd) : null,
    phase,
  });
  const url = nextUrl || `${FULFILLMENT}/order?filter=${encodeURIComponent(`creationdate:[${window.start}..${window.end}]`)}&limit=50`;
  const read = await ebayGet(token, url);
  if (read.error) {
    await saveSyncState({
      accountKey: connection.connectionKey,
      phase,
      cursorEnd,
      nextUrl,
      lastError: read.error,
      feeNote: state.feeNote,
      feeBlocked: state.feeBlocked,
      success: false,
      source,
      saved: 0,
    });
    return { ok: false, error: read.error, retryable: read.status === 429 || read.status >= 500 };
  }
  const orders = Array.isArray(read.body?.orders) ? read.body.orders : [];
  const next = typeof read.body?.next === "string" ? read.body.next : "";
  if (next) {
    nextUrl = next.startsWith("http") ? next : `https://api.ebay.com${next}`;
  } else {
    nextUrl = "";
    phase = window.phase;
    cursorEnd = window.nextCursorEnd ? new Date(window.nextCursorEnd).toISOString() : null;
  }
  const lines = parseFulfillmentOrders(orders);
  const feeState = lines.length
    ? await feesFor(token, [...new Set(lines.map((line) => line.orderId))])
    : { fees: [], feeNote: state.feeNote, feeBlocked: state.feeBlocked };
  const saved = await saveParsedSales(connection.connectionKey, lines, feeState.fees);
  await saveSyncState({
    accountKey: connection.connectionKey,
    phase,
    cursorEnd,
    nextUrl,
    lastError: "",
    feeNote: feeState.feeNote,
    feeBlocked: feeState.feeBlocked,
    success: true,
    source,
    saved: saved.saved + savedTotal,
  });
  return { ok: true, accountKey: connection.connectionKey, saved: saved.saved + savedTotal, retryable: false };
}
