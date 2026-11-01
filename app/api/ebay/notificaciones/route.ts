import { NextRequest, NextResponse } from "next/server";
import { basicAuthHeader, EBAY_TOKEN_URL, getEbayCreds, isEbayConfigured } from "@/lib/ebay/config";
import { notificationEndpoint } from "@/lib/usa-lots/notify-api";
import {
  challengeResponse,
  decodeSignatureHeader,
  ORDER_CONFIRMATION_TOPIC,
  orderIdFromNotification,
  verifyEbayNotification,
} from "@/lib/usa-lots/notifications";
import { ingestNotifiedOrder } from "@/lib/usa-lots/sync-step";
import { holdSaleNotice } from "@/lib/usa-lots/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const keys = new Map<string, string>();

async function publicKey(kid: string): Promise<string> {
  const cached = keys.get(kid);
  if (cached) return cached;
  const url = `https://api.ebay.com/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`;
  let response = await fetch(url, { headers: { Accept: "application/json" } });
  if ((response.status === 401 || response.status === 403) && isEbayConfigured()) {
    const creds = getEbayCreds();
    const tokenResponse = await fetch(EBAY_TOKEN_URL, {
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
    const tokenBody = await tokenResponse.json().catch(() => null) as { access_token?: string } | null;
    if (tokenBody?.access_token) {
      response = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${tokenBody.access_token}` } });
    }
  }
  if (!response.ok) return "";
  const body = await response.json().catch(() => null) as { key?: string } | null;
  const key = String(body?.key ?? "");
  if (key) keys.set(kid, key);
  return key;
}

export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get("challenge_code") || "";
  const token = process.env.EBAY_NOTIFICATION_VERIFICATION_TOKEN || "";
  if (!challenge || !token) {
    return NextResponse.json({
      ok: false,
      error: "Falta EBAY_NOTIFICATION_VERIFICATION_TOKEN. Sin esa variable eBay no puede verificar el destino de notificaciones.",
    }, { status: 503 });
  }
  const destination = notificationEndpoint({
    productionHost: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    requestOrigin: req.nextUrl.origin,
  });
  if ("error" in destination) {
    return NextResponse.json({ ok: false, error: destination.error }, { status: 503 });
  }
  return NextResponse.json({ challengeResponse: challengeResponse(challenge, token, destination.endpoint) });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const header = req.headers.get("x-ebay-signature") || "";
  const decoded = decodeSignatureHeader(header);
  if (!decoded) {
    return NextResponse.json({ ok: false, error: "La notificación no trae una firma reconocible." }, { status: 412 });
  }
  const key = await publicKey(decoded.kid);
  if (!key || !verifyEbayNotification(raw, header, key)) {
    return NextResponse.json({ ok: false, error: "La firma de la notificación no es válida." }, { status: 412 });
  }
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const notice = orderIdFromNotification(body);
  if (notice.topic && notice.topic !== ORDER_CONFIRMATION_TOPIC) return NextResponse.json({ ok: true, ignored: true });
  if (!notice.orderId) return NextResponse.json({ ok: true, ignored: true });
  try {
    const result = await ingestNotifiedOrder(notice.orderId);
    if (result === "unpaid" || result === "retry" || result === "missing") {
      await holdSaleNotice(notice.orderId, notice.topic || "order");
    }
  } catch (error) {
    console.error("[ebay] notificaciones", error);
    return NextResponse.json({ ok: false, error: "No se pudo guardar la notificación." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
