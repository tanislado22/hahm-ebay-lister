import { NextRequest, NextResponse } from "next/server";
import { analyzeListing } from "@/lib/analyze-listing";
import { guardApiRequest } from "@/lib/api-guard";
import type { AnalyzeRequestBody } from "@/lib/types";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: AnalyzeRequestBody;
  try {
    body = (await req.json()) as AnalyzeRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const result = await analyzeListing(body);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, listing: result.listing });
}
