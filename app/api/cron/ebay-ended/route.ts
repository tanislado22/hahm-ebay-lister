import { NextRequest, NextResponse } from "next/server";
import { runEbayEndedCheck } from "@/lib/ebay/ended-check";
import { secretEqual } from "@/lib/secret";

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
  const send = req.nextUrl.searchParams.get("dryRun") !== "1";
  try {
    const result = await runEbayEndedCheck({ send });
    return NextResponse.json({ ok: true, dryRun: !send, ...result });
  } catch (error) {
    console.error("[cron/ebay-ended]", error);
    return NextResponse.json({ ok: false, error: "eBay ended-listing check failed." }, { status: 500 });
  }
}

export function GET(req: NextRequest) {
  return handle(req);
}

export function POST(req: NextRequest) {
  return handle(req);
}
