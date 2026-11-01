import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/ebay/cron-auth";
import { runEbaySalesCheck } from "@/lib/ebay/sales-check";
import { advanceUsaSaleSync } from "@/lib/usa-lots/sync-step";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  return cronAuthorized(
    req.headers.get("authorization"),
    req.headers.get("x-cron-secret"),
    process.env.CRON_SECRET ?? ""
  );
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await runEbaySalesCheck();
    let lots: unknown = null;
    try {
      lots = await advanceUsaSaleSync({ source: "cron" });
    } catch (error) {
      console.error("[cron/ebay-sales] lots", error);
      lots = { ok: false, error: "No se pudo continuar la sincronización de lotes." };
    }
    return NextResponse.json({ ok: true, ...result, lots });
  } catch (error) {
    console.error("[cron/ebay-sales]", error);
    return NextResponse.json({ ok: false, error: "eBay sale check failed." }, { status: 500 });
  }
}

export function GET(req: NextRequest) {
  return handle(req);
}

export function POST(req: NextRequest) {
  return handle(req);
}
