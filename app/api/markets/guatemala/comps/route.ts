import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { guatemalaCompReport } from "@/lib/markets/guatemala";

export const dynamic = "force-dynamic";

// Guatemala comparisons stay empty until a real local source is connected.
// This route never estimates a price and never reads eBay.
export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  return NextResponse.json(guatemalaCompReport());
}
