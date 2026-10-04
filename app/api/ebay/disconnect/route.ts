import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { deleteEbayConnection, ebayConnectionKey } from "@/lib/ebay/client-connections";
import { EBAY_COOKIE } from "@/lib/ebay/session";

export const dynamic = "force-dynamic";

// Forget the stored eBay connection.
export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let workMode: "store" | "client" = "store";
  let clientId: string | null = null;
  try {
    const body = (await req.json()) as { workMode?: string; clientId?: string | null };
    if (body?.workMode === "client") workMode = "client";
    if (typeof body?.clientId === "string") clientId = body.clientId;
  } catch {
    /* empty body still disconnects the store cookie */
  }

  const connectionKey = ebayConnectionKey(workMode, clientId);
  if (connectionKey) {
    try {
      await deleteEbayConnection(connectionKey);
    } catch (error) {
      console.error("[ebay/disconnect] could not delete stored connection", error);
    }
  }

  const res = NextResponse.json({ ok: true });
  if (workMode === "store") res.cookies.delete(EBAY_COOKIE);
  return res;
}
