import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { listListings } from "@/lib/inventory/links";
import { workspaceKey } from "@/lib/inventory/workspace";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  const workMode = req.nextUrl.searchParams.get("workMode");
  const clientId = req.nextUrl.searchParams.get("clientId");
  const workspace = workspaceKey(workMode, clientId);
  if (!workspace) {
    return NextResponse.json({ ok: false, error: "Select a client first." }, { status: 400 });
  }

  try {
    const listings = await listListings(workspace);
    return NextResponse.json({ ok: true, listings });
  } catch (error) {
    console.error("[vinted/listings]", error);
    return NextResponse.json({ ok: false, error: "Could not load Vinted listings." }, { status: 500 });
  }
}
