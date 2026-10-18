import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import { quoteGuatemalaPrice } from "@/lib/markets/guatemala-price-quote";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const access = await authorizeGuatemalaRequest(request, "", "publish");
  if (!access.ok) return access.response;
  let listing: Record<string, unknown> = {};
  try {
    const body = (await request.json()) as { listing?: unknown };
    if (body.listing && typeof body.listing === "object") listing = body.listing as Record<string, unknown>;
  } catch {
    listing = {};
  }
  return NextResponse.json(await quoteGuatemalaPrice(access.clientId, listing));
}
