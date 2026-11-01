import { EBAY_MARKETPLACE_ID } from "@/lib/ebay/config";
import { listEbayConnections } from "@/lib/ebay/client-connections";
import { accessTokenFromCookie } from "@/lib/ebay/session";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import { isReadOnlyOrderRequest, parseFulfillmentOrders } from "@/lib/usa-lots/parse-order";
import { feeGapFromStatus, nextOrderWindow } from "@/lib/usa-lots/sync-plan";
import {
  finishSaleNotice,
  readSyncState,
  saveParsedSales,
  saveSyncState,
  takeSaleNotices,
} from "@/lib/usa-lots/store";

const FULFILLMENT = "https://api.ebay.com/sell/fulfillment/v1";
const FINANCES = "https://apiz.ebay.com/sell/finances/v1/transaction";

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

function feeFromTransactions(body: Record<string, unknown> | null, orderId: string): { feeCents: number | null; sellerShippingCents: number | null } {
  const transactions = Array.isArray(body?.transactions) ? body.transactions : [];
  let fee = 0;
  let shipping = 0;
  let feeSeen = false;
  let shippingSeen = false;
  for (const entry of transactions) {
    if (!entry || typeof entry !== "object") continue;
    const transaction = entry as Record<string, unknown>;
    if (String(transaction.orderId ?? "") !== orderId) continue;
    const type = String(transaction.transactionType ?? "");
    const amount = transaction.amount && typeof transaction.amount === "object" ? transaction.amount as { value?: unknown; currency?: unknown } : null;
    const cents = amount ? Math.round(Number(amount.value) * 100) : null;
    if (cents == null || !Number.isFinite(cents)) continue;
    if (type === "NON_SALE_CHARGE" || type === "SALE") {
      const feeType = String(transaction.feeType ?? transaction.bookingEntry ?? "");
      if (feeType.toUpperCase().includes("FEE") || type === "NON_SALE_CHARGE") {
        fee += Math.abs(cents);
        feeSeen = true;
      }
    }
    if (type === "SHIPPING_LABEL") {
      shipping += Math.abs(cents);
      shippingSeen = true;
    }
  }
  return { feeCents: feeSeen ? fee : null, sellerShippingCents: shippingSeen ? shipping : null };
}

export async function advanceUsaSaleSync(accountKey?: string): Promise<{ ok: true; accountKey: string; saved: number; retryable: boolean } | { ok: false; error: string; retryable: boolean }> {
  const connections = await listEbayConnections();
  const usable = [];
  for (const connection of connections) {
    if (connection.connectionKey.startsWith("client:")) {
      const clientId = connection.connectionKey.slice("client:".length);
      if (await clientIsGuatemala(clientId)) continue;
    }
    if (accountKey && connection.connectionKey !== accountKey) continue;
    usable.push(connection);
  }
  const connection = usable[0];
  if (!connection) return { ok: false, error: "No hay una cuenta de eBay conectada para sincronizar.", retryable: false };
  const state = await readSyncState(connection.connectionKey);
  let token: string | null = null;
  try {
    token = await accessTokenFromCookie(connection.sealedConnection);
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
    });
    return { ok: false, error: (error as Error).message, retryable: true };
  }
  if (!token) return { ok: false, error: "No se pudo renovar el acceso a eBay.", retryable: true };

  const notices = await takeSaleNotices(3);
  const orders: unknown[] = [];
  let nextUrl = state.nextUrl;
  let phase: "backfill" | "watch" = state.phase === "watch" ? "watch" : "backfill";
  let cursorEnd = state.cursorEnd;
  if (notices.length) {
    for (const notice of notices) {
      const url = `${FULFILLMENT}/order/${encodeURIComponent(notice.orderId)}`;
      const read = await ebayGet(token, url);
      if (read.error) {
        await saveSyncState({ accountKey: connection.connectionKey, phase, cursorEnd, nextUrl, lastError: read.error, feeNote: state.feeNote, feeBlocked: state.feeBlocked, success: false });
        return { ok: false, error: read.error, retryable: read.status === 429 || read.status >= 500 };
      }
      if (read.body) orders.push(read.body.order ?? read.body);
      await finishSaleNotice(notice.id);
    }
  } else {
    const window = nextOrderWindow({
      now: Date.now(),
      cursorEnd: cursorEnd ? Date.parse(cursorEnd) : null,
      phase,
    });
    const url = nextUrl || `${FULFILLMENT}/order?filter=${encodeURIComponent(`creationdate:[${window.start}..${window.end}]`)}&limit=50`;
    const read = await ebayGet(token, url);
    if (read.error) {
      await saveSyncState({ accountKey: connection.connectionKey, phase, cursorEnd, nextUrl, lastError: read.error, feeNote: state.feeNote, feeBlocked: state.feeBlocked, success: false });
      return { ok: false, error: read.error, retryable: read.status === 429 || read.status >= 500 };
    }
    orders.push(...(Array.isArray(read.body?.orders) ? read.body.orders : []));
    const next = typeof read.body?.next === "string" ? read.body.next : "";
    if (next) {
      nextUrl = next.startsWith("http") ? next : `https://api.ebay.com${next}`;
    } else {
      nextUrl = "";
      phase = window.phase;
      cursorEnd = window.nextCursorEnd ? new Date(window.nextCursorEnd).toISOString() : null;
    }
  }

  const lines = parseFulfillmentOrders(orders);
  let feeNote = state.feeNote;
  let feeBlocked = state.feeBlocked;
  const fees: { orderId: string; feeCents: number | null; sellerShippingCents: number | null }[] = [];
  const orderIds = [...new Set(lines.map((line) => line.orderId))];
  if (!feeBlocked && orderIds.length) {
    const feeUrl = `${FINANCES}?filter=${encodeURIComponent(`orderId:{${orderIds[0]}}`)}&limit=20`;
    const feeRead = await fetch(feeUrl, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (feeRead.status === 401 || feeRead.status === 403) {
      feeBlocked = true;
      feeNote = feeGapFromStatus(feeRead.status);
    } else if (feeRead.ok) {
      const body = await feeRead.json() as Record<string, unknown>;
      fees.push({ orderId: orderIds[0], ...feeFromTransactions(body, orderIds[0]) });
    } else {
      feeNote = feeGapFromStatus(feeRead.status) || feeNote;
    }
  }
  const saved = await saveParsedSales(connection.connectionKey, lines, fees);
  await saveSyncState({
    accountKey: connection.connectionKey,
    phase,
    cursorEnd,
    nextUrl,
    lastError: "",
    feeNote,
    feeBlocked,
    success: true,
  });
  return { ok: true, accountKey: connection.connectionKey, saved: saved.saved, retryable: false };
}
