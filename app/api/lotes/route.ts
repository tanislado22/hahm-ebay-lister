import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { archiveAccountKey } from "@/lib/archive/workspace";
import { clientIsGuatemala } from "@/lib/markets/client-market";
import { usdToCents } from "@/lib/usa-lots/money";
import { describeSaleSync } from "@/lib/usa-lots/sync-plan";
import {
  assignItemsToLot,
  correctSaleLink,
  countUsaSales,
  createUsaLot,
  listOpenSales,
  listUsaLots,
  readLotReport,
  readSyncState,
  setManualItemCost,
  spreadAverageCost,
  transferItemToGuatemala,
} from "@/lib/usa-lots/store";

export const dynamic = "force-dynamic";

async function accountFrom(body: { workMode?: unknown; clientId?: unknown }): Promise<{ key: string } | { error: string; status: number }> {
  const key = archiveAccountKey(body.workMode, body.clientId);
  if (!key) return { error: "La cuenta no es válida.", status: 400 };
  if (key.startsWith("client:") && (await clientIsGuatemala(key.slice("client:".length)))) {
    return { error: "El inventario y el catálogo de Guatemala no se modifican desde los lotes de Estados Unidos.", status: 400 };
  }
  return { key };
}

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const params = req.nextUrl.searchParams;
  const account = await accountFrom({ workMode: params.get("workMode"), clientId: params.get("clientId") });
  if ("error" in account) return NextResponse.json({ ok: false, error: account.error }, { status: account.status });
  try {
    const lots = await listUsaLots(account.key);
    const open = await listOpenSales(account.key);
    const sync = await readSyncState(account.key);
    const salesStored = await countUsaSales(account.key);
    const status = describeSaleSync({
      cronSecretSet: Boolean(process.env.CRON_SECRET),
      notificationTokenSet: Boolean(process.env.EBAY_NOTIFICATION_VERIFICATION_TOKEN),
      lastSuccessAt: sync.lastSuccessAt,
      lastSource: sync.lastSource,
      lastSaved: sync.lastSaved,
      salesStored,
      lastError: sync.lastError,
      feeNote: sync.feeNote,
    });
    const lotId = params.get("lotId") || "";
    const detail = lotId ? await readLotReport(account.key, lotId) : null;
    return NextResponse.json({ ok: true, lots, open, status, detail });
  } catch (error) {
    console.error("[lotes] list", error);
    return NextResponse.json({ ok: false, error: "No se pudieron leer los lotes." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la solicitud." }, { status: 400 });
  }
  const account = await accountFrom(body);
  if ("error" in account) return NextResponse.json({ ok: false, error: account.error }, { status: account.status });
  const action = String(body.action || "create");
  try {
    if (action === "create") {
      const purchase = usdToCents(String(body.purchase || ""));
      const extra = usdToCents(String(body.extra || "0"));
      const countText = String(body.sellableCount || "").trim();
      const sellableCount = countText ? Number(countText) : null;
      if (purchase == null || extra == null) return NextResponse.json({ ok: false, error: "Escribe los montos en USD, por ejemplo 250.00." }, { status: 400 });
      if (countText && (!Number.isInteger(sellableCount) || (sellableCount ?? 0) < 1)) {
        return NextResponse.json({ ok: false, error: "El conteo de piezas tiene que ser un número entero, o déjalo vacío si todavía está incompleto." }, { status: 400 });
      }
      const created = await createUsaLot({
        accountKey: account.key,
        name: String(body.name || ""),
        purchasedOn: String(body.purchasedOn || ""),
        purchaseCents: purchase,
        extraCents: extra,
        sellableCount,
      });
      return NextResponse.json(created, { status: created.ok ? 200 : 400 });
    }
    if (action === "assign") {
      const items = Array.isArray(body.items) ? body.items.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        return [{
          sku: String(record.sku || ""),
          ebayItemId: String(record.ebayItemId || ""),
          archiveId: String(record.archiveId || ""),
          jobId: String(record.jobId || ""),
          title: String(record.title || ""),
        }];
      }) : [];
      const assigned = await assignItemsToLot({ accountKey: account.key, lotId: String(body.lotId || ""), items });
      return NextResponse.json(assigned, { status: assigned.ok ? 200 : 400 });
    }
    if (action === "cost") {
      const cents = usdToCents(String(body.cost || ""));
      if (cents == null) return NextResponse.json({ ok: false, error: "Escribe el costo del artículo en USD." }, { status: 400 });
      const saved = await setManualItemCost(account.key, String(body.itemId || ""), cents);
      return NextResponse.json(saved, { status: saved.ok ? 200 : 400 });
    }
    if (action === "average") {
      const spread = await spreadAverageCost(account.key, String(body.lotId || ""));
      return NextResponse.json(spread, { status: spread.ok ? 200 : 400 });
    }
    if (action === "transfer") {
      const moved = await transferItemToGuatemala(account.key, String(body.itemId || ""));
      return NextResponse.json(moved.ok ? { ...moved, message: "Quedó apartado para Guatemala como traslado. No se registró como venta y no se copió al catálogo de Guatemala." } : moved, { status: moved.ok ? 200 : 400 });
    }
    if (action === "correct") {
      const corrected = await correctSaleLink({
        accountKey: account.key,
        saleId: String(body.saleId || ""),
        lotId: String(body.lotId || ""),
        itemId: String(body.itemId || ""),
      });
      return NextResponse.json(corrected, { status: corrected.ok ? 200 : 400 });
    }
    return NextResponse.json({ ok: false, error: "Esa acción de lote no existe." }, { status: 400 });
  } catch (error) {
    console.error("[lotes]", error);
    return NextResponse.json({ ok: false, error: "No se pudo guardar el lote." }, { status: 500 });
  }
}
