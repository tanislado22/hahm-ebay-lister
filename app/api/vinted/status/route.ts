import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { markVintedPublished, saveVintedDraft } from "@/lib/inventory/links";
import { workspaceKey } from "@/lib/inventory/workspace";
import { vintedIdFromUrl, type VintedPrepared } from "@/lib/vinted/prepare";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: {
    workMode?: string;
    clientId?: string | null;
    sku?: string;
    vintedStatus?: "ready" | "published";
    vintedTitle?: string | null;
    vintedListingUrl?: string | null;
    prepared?: VintedPrepared | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const workspace = workspaceKey(body.workMode, body.clientId);
  const sku = body.sku?.trim() ?? "";
  if (!workspace || !sku) {
    return NextResponse.json({ ok: false, error: "SKU and workspace are required." }, { status: 400 });
  }

  const url = (body.vintedListingUrl ?? "").trim();
  if (url && !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ ok: false, error: "Vinted URL must start with http:// or https://." }, { status: 400 });
  }

  try {
    if (body.vintedStatus === "published") {
      const updated = await markVintedPublished({
        workspaceKey: workspace,
        sku,
        vintedTitle: body.vintedTitle || body.prepared?.title || null,
        vintedListingUrl: url || null,
        vintedListingId: url ? vintedIdFromUrl(url) : null,
        prepared: body.prepared ?? null,
      });
      if (!updated) {
        return NextResponse.json(
          { ok: false, error: "Prepare this SKU for Vinted before marking it published." },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, vintedStatus: "published" });
    }

    if (!body.prepared?.title) {
      return NextResponse.json({ ok: false, error: "A Vinted title is required." }, { status: 400 });
    }
    const updated = await saveVintedDraft({
      workspaceKey: workspace,
      sku,
      prepared: { ...body.prepared, sku },
    });
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "This SKU is not in the Vinted queue." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, vintedStatus: "ready" });
  } catch (error) {
    console.error("[vinted/status]", error);
    return NextResponse.json({ ok: false, error: "Could not update the Vinted status." }, { status: 500 });
  }
}
