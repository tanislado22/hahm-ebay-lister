import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { archiveAccountKey } from "@/lib/archive/workspace";
import { listEbayConnections } from "@/lib/ebay/client-connections";
import { accessGrantFromCookie } from "@/lib/ebay/session";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import { notificationEndpoint } from "@/lib/usa-lots/notify-api";
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
  const destination = notificationEndpoint({
    productionHost: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    requestOrigin: req.nextUrl.origin,
  });
  if ("error" in destination) return NextResponse.json({ ok: false, error: destination.error }, { status: 400 });
  const endpoint = destination.endpoint;
  try {
    const connections = await listEbayConnections();
    const connection = connections.find((item) => item.connectionKey === accountKey);
    if (!connection) {
      return NextResponse.json({ ok: false, error: "Conecta la cuenta de eBay antes de preparar las notificaciones." }, { status: 400 });
    }
    const grant = await accessGrantFromCookie(connection.sealedConnection);
    if (!grant) return NextResponse.json({ ok: false, error: "No se pudo renovar el acceso a eBay." }, { status: 400 });
    if (!grant.grantedScopes.length) {
      return NextResponse.json({
        ok: false,
        error: "eBay no informó los permisos concedidos a esta cuenta. No se usó la lista de la aplicación. ORDER_CONFIRMATION no quedó suscrita.",
      }, { status: 400 });
    }
    const result = await subscribeSaleNotifications({
      token: grant.token,
      endpoint,
      verificationToken,
      grantedScopes: grant.grantedScopes,
    });
    if (!result.ok) console.error("[lotes] notificaciones", result.error);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    console.error("[lotes] notificaciones", error);
    return NextResponse.json({ ok: false, error: "No se pudo preparar la suscripción de notificaciones." }, { status: 500 });
  }
}
