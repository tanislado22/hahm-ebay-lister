import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { syncDuplicatePresence } from "@/lib/vinted/inventory-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { since?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  try {
    const result = await syncDuplicatePresence(String(body.since || ""));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[vinted/inventory/presence]", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: "No se pudo comprobar el estado en Vinted. No se eliminó ningún registro." }, { status: 500 });
  }
}
