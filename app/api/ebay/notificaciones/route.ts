import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { enqueueSaleNotice } from "@/lib/usa-lots/store";

export const dynamic = "force-dynamic";

function orderIdFrom(body: unknown): { orderId: string; topic: string } {
  if (!body || typeof body !== "object") return { orderId: "", topic: "" };
  const record = body as Record<string, unknown>;
  const topic = String(record.metadata && typeof record.metadata === "object" ? (record.metadata as { topic?: unknown }).topic ?? "" : record.topic ?? "");
  const data = record.notification && typeof record.notification === "object" ? record.notification as Record<string, unknown> : record;
  const nested = data.data && typeof data.data === "object" ? data.data as Record<string, unknown> : data;
  const order = nested.order && typeof nested.order === "object" ? nested.order as { orderId?: unknown } : null;
  const raw = String(order?.orderId ?? nested.orderId ?? "");
  const orderId = /^[A-Za-z0-9-]{6,64}$/.test(raw) ? raw : "";
  return { orderId, topic: topic.slice(0, 80) };
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
  const endpoint = new URL("/api/ebay/notificaciones", req.nextUrl.origin).toString();
  const challengeResponse = crypto.createHash("sha256").update(`${challenge}${token}${endpoint}`).digest("hex");
  return NextResponse.json({ challengeResponse });
}

export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const notice = orderIdFrom(body);
  if (!notice.orderId) return NextResponse.json({ ok: true, ignored: true });
  try {
    await enqueueSaleNotice(notice.orderId, notice.topic || "order");
  } catch (error) {
    console.error("[ebay] notificaciones", error);
    return NextResponse.json({ ok: false, error: "No se pudo guardar la notificación para la siguiente sincronización." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
