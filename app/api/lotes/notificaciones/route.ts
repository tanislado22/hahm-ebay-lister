import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { archiveAccountKey } from "@/lib/archive/workspace";
import { listEbayConnections } from "@/lib/ebay/client-connections";
import { accessTokenFromCookie } from "@/lib/ebay/session";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import { subscribeSaleNotifications } from "@/lib/usa-lots/subscribe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { workMode?: unknown; clientId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const accountKey = archiveAccountKey(body.workMode, body.clientId);
  if (!accountKey) return NextResponse.json({ ok: false, error: "La cuenta no es válida." }, { status: 400 });
  if (accountKey.startsWith("client:") && (await clientIsGuatemala(accountKey.slice("client:".length)))) {
    return NextResponse.json({ ok: false, error: "El inventario de Guatemala no recibe estas notificaciones." }, { status: 400 });
  }
  const verificationToken = process.env.EBAY_NOTIFICATION_VERIFICATION_TOKEN || "";
  const endpoint = new URL("/api/ebay/notificaciones", req.nextUrl.origin).toString();
  try {
    const connections = await listEbayConnections();
    const connection = connections.find((item) => item.connectionKey === accountKey);
    if (!connection) {
      return NextResponse.json({ ok: false, error: "Conecta la cuenta de eBay antes de preparar las notificaciones." }, { status: 400 });
    }
    const token = await accessTokenFromCookie(connection.sealedConnection);
    if (!token) return NextResponse.json({ ok: false, error: "No se pudo renovar el acceso a eBay." }, { status: 400 });
    const result = await subscribeSaleNotifications({ token, endpoint, verificationToken });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    console.error("[lotes] notificaciones", error);
    return NextResponse.json({ ok: false, error: "No se pudo preparar la suscripción de notificaciones." }, { status: 500 });
  }
}
