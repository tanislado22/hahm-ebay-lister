import { describe, expect, test } from "vitest";
import { exactSku } from "@/lib/archive/text";
import { applyIncomingSale, lotForMatch, matchSaleToItem } from "@/lib/usa-lots/match";
import { isReadOnlyOrderRequest, parseFulfillmentOrders } from "@/lib/usa-lots/parse-order";
import { allocateSharedCents, applyAverageCosts, averageUnitCents, buildLotReport, saleProfit } from "@/lib/usa-lots/profit";
import { describeSaleSync, feeGapFromStatus, nextOrderWindow } from "@/lib/usa-lots/sync-plan";

const archived = {
  id: "archive-1",
  sku: "00123",
  ebayItemId: "123456789012",
  lotId: "lote-a",
  source: "archive" as const,
};

describe("USA purchase lots", () => {
  test("keeps the exact SKU and does not match a similar title", () => {
    expect(exactSku("  00123  ")).toBe("00123");
    const parsed = parseFulfillmentOrders([{
      orderId: "ORD-1",
      creationDate: "2026-03-01T00:00:00.000Z",
      lineItems: [{ lineItemId: "LINE-1", legacyItemId: "123456789012", sku: "00123", title: "Camisa", quantity: 1, lineItemCost: { value: "20.00", currency: "USD" } }],
    }]);
    expect(parsed[0]?.sku).toBe("00123");
    const missed = matchSaleToItem({
      ebayItemId: "",
      sku: "",
      variantSku: "",
      title: "Camisa azul parecida",
      items: [archived],
    });
    expect(missed.kind).toBe("unmatched");
    expect(matchSaleToItem({ ebayItemId: "", sku: "123", variantSku: "", title: "Camisa", items: [archived] }).kind).toBe("unmatched");
    expect(matchSaleToItem({ ebayItemId: "123456789012", sku: "", variantSku: "", title: "Otra", items: [archived] })).toMatchObject({ kind: "one", item: archived });
  });

  test("puts a sale only in its lot, or in the open queues, never a default lot", () => {
    expect(lotForMatch({ kind: "one", item: archived })).toEqual({ linkStatus: "lotted", lotId: "lote-a", itemId: "archive-1" });
    expect(lotForMatch({ kind: "one", item: { ...archived, lotId: "" } }).linkStatus).toBe("unassigned");
    expect(lotForMatch({ kind: "unmatched" })).toEqual({ linkStatus: "unmatched", lotId: "", itemId: "" });
    expect(lotForMatch({ kind: "ambiguous" }).lotId).toBe("");
  });

  test("uses the accepted offer, ignores remitted tax, and keeps a repeated sale once", () => {
    const [line] = parseFulfillmentOrders([{
      orderId: "ORD-2",
      creationDate: "2026-03-02T00:00:00.000Z",
      pricingSummary: { deliveryCost: { value: "8.00", currency: "USD" } },
      lineItems: [{
        lineItemId: "LINE-2",
        legacyItemId: "123456789012",
        sku: "00123",
        quantity: 2,
        lineItemCost: { value: "20.00", currency: "USD" },
        discountedLineItemCost: { value: "18.00", currency: "USD" },
        ebayCollectAndRemitTaxes: [{ amount: { value: "1.50", currency: "USD" } }],
      }],
    }]);
    expect(line?.itemCents).toBe(1800);
    expect(line?.buyerShippingCents).toBe(800);
    expect(line?.taxRemittedCents).toBe(150);
    expect(line?.quantity).toBe(2);
    const profit = saleProfit({
      itemCents: line?.itemCents ?? null,
      buyerShippingCents: line?.buyerShippingCents ?? null,
      taxRemittedCents: line?.taxRemittedCents ?? null,
      feeCents: null,
      sellerShippingCents: null,
      refundCents: 0,
      otherCents: 0,
      unitCostCents: 400,
      quantity: 2,
      costEstimated: false,
      cancelled: false,
    });
    expect(profit.incomeCents).toBe(2600);
    expect(profit.costCents).toBe(800);
    expect(profit.profitCents).toBeNull();
    expect(profit.label).toBe("Ganancia provisional");
    expect(profit.missing).toEqual(expect.arrayContaining(["comisión de eBay", "envío pagado por ti"]));
    const first = { id: "sale-1", orderId: "ORD-2", lineItemId: "LINE-2", lotId: "lote-a", linkLocked: true, incomeCents: 2600 };
    const repeated = applyIncomingSale([first], { ...first, id: "sale-2", lotId: "lote-b", incomeCents: 2000 });
    expect(repeated).toHaveLength(1);
    expect(repeated[0]).toMatchObject({ id: "sale-1", lotId: "lote-a", incomeCents: 2000 });
  });

  test("shares an order expense by price and does not treat a missing refund as zero", () => {
    expect(allocateSharedCents(800, [1800, 2000])).toEqual([378, 422]);
    const [line] = parseFulfillmentOrders([{
      orderId: "ORD-3",
      creationDate: "2026-03-03T00:00:00.000Z",
      cancelStatus: { cancelState: "CANCELED" },
      lineItems: [{ lineItemId: "LINE-3", sku: "00123", quantity: 1, lineItemCost: { value: "10.00", currency: "USD" } }],
    }]);
    expect(line?.cancelled).toBe(true);
    expect(line?.refundCents).toBeNull();
    expect(saleProfit({
      itemCents: 1000,
      buyerShippingCents: 0,
      taxRemittedCents: 0,
      feeCents: 100,
      sellerShippingCents: 0,
      refundCents: null,
      otherCents: 0,
      unitCostCents: 400,
      quantity: 1,
      costEstimated: false,
      cancelled: true,
    }).missing).toContain("reembolso de la cancelación");
  });

  test("marks an incomplete average as estimated and leaves historical costs unchanged", () => {
    expect(averageUnitCents(100000, 5000, null)).toBeNull();
    const blocked = applyAverageCosts(
      [{ id: "a", locked: true, sold: false, source: "manual" }, { id: "b", locked: false, sold: true, source: "average" }],
      1050,
      2
    );
    expect(blocked.items.every((item) => item.unitCostCents == null)).toBe(true);
    const open = applyAverageCosts([{ id: "c", locked: false, sold: false, source: "estimated" }], 1050, 4);
    expect(open.estimated).toBe(true);
    expect(open.items[0]).toMatchObject({ unitCostCents: 1050, costEstimated: true });
    const missing = applyAverageCosts([{ id: "d", locked: false, sold: false, source: "estimated" }], null, null);
    expect(missing.error).toContain("No se inventó una cantidad");
  });

  test("separates sold profit from investment recovery and does not count a Guatemala transfer as a sale", () => {
    const report = buildLotReport({
      purchaseCents: 10000,
      extraCents: 0,
      sellableCount: 2,
      publishedCount: 1,
      items: [
        { id: "sold", ebayItemId: "1", disposition: "", unitCostCents: 5000, costEstimated: false },
        { id: "moved", ebayItemId: "", disposition: "guatemala-transfer", unitCostCents: 5000, costEstimated: false },
      ],
      sales: [{
        itemId: "sold",
        cancelled: false,
        linkStatus: "lotted",
        profit: saleProfit({
          itemCents: 8000,
          buyerShippingCents: 0,
          taxRemittedCents: 200,
          feeCents: 1000,
          sellerShippingCents: 500,
          refundCents: 0,
          otherCents: 0,
          unitCostCents: 5000,
          quantity: 1,
          costEstimated: false,
          cancelled: false,
        }),
      }],
    });
    expect(report.sold).toBe(1);
    expect(report.transferred).toBe(1);
    expect(report.soldProfitCents).toBe(1500);
    expect(report.recoveredCents).toBe(6500);
    expect(report.investmentLeftCents).toBe(3500);
    expect(report.investedCents).toBe(10000);
  });

  test("continues the server sync without a browser and does not call the schedule active", () => {
    const now = Date.parse("2026-11-01T00:00:00.000Z");
    const first = nextOrderWindow({ now, cursorEnd: null, phase: "backfill" });
    const second = nextOrderWindow({ now, cursorEnd: first.nextCursorEnd, phase: first.phase });
    expect(second.end < first.end).toBe(true);
    expect(isReadOnlyOrderRequest("GET", "https://api.ebay.com/sell/fulfillment/v1/order?limit=50")).toBe(true);
    expect(isReadOnlyOrderRequest("POST", "https://api.ebay.com/sell/fulfillment/v1/order")).toBe(false);
    expect(isReadOnlyOrderRequest("POST", "https://api.ebay.com/ws/api.dll")).toBe(false);
    expect(feeGapFromStatus(403)).toContain("sell.finances");
    const status = describeSaleSync({ cronSecretSet: false, notificationTokenSet: false, lastSuccessAt: null, lastError: "", feeNote: "" });
    expect(status.active).toBe(false);
    expect(status.lines.join(" ")).toContain("CRON_SECRET");
    expect(status.lines.join(" ")).toContain("cada 15 minutos");
  });
});
