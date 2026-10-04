import { NextRequest, NextResponse } from "next/server";
import { secretEqual } from "@/lib/secret";
import { runEbaySalesCheck } from "@/lib/ebay/sales-check";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const alt = req.headers.get("x-cron-secret") ?? "";
  return secretEqual(bearer, secret) || secretEqual(alt, secret);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await runEbaySalesCheck();
    return NextResponse.json({ ok: true, ...result });
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
