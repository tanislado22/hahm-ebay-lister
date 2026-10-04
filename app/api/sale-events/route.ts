import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { listSaleEvents } from "@/lib/inventory/sale-events";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const status = req.nextUrl.searchParams.get("status") ?? "needs_review";
  if (status !== "needs_review" && status !== "failed" && status !== "sent" && status !== "skipped") {
    return NextResponse.json({ ok: false, error: "Unsupported status." }, { status: 400 });
  }
  try {
    const events = await listSaleEvents(status);
    return NextResponse.json({ ok: true, events });
  } catch (error) {
    console.error("[sale-events]", error);
    return NextResponse.json({ ok: false, error: "Could not load sale events." }, { status: 500 });
  }
}
