import crypto from "crypto";
import { describe, expect, test } from "vitest";
import { exactSku } from "@/lib/archive/text";
import { EBAY_SCOPES, FULFILLMENT_READONLY_SCOPE } from "@/lib/ebay/config";
import { buildAuthorizeUrl, refreshAccessToken } from "@/lib/ebay/oauth";
import { connectionFromToken } from "@/lib/ebay/session";
import { feeFromTransactions } from "@/lib/usa-lots/finances";
import { applyIncomingSale, lotForMatch, matchSaleToItem, planStoredSaleLinks } from "@/lib/usa-lots/match";
import { cronAuthorized } from "@/lib/ebay/cron-auth";
import { describeEbayFailure, emailFromXml, needsNotificationConfig, notificationCollectionUrl, notificationConfigUrl, notificationEndpoint, validAlertEmail } from "@/lib/usa-lots/notify-api";
import { subscribeSaleNotifications } from "@/lib/usa-lots/subscribe";
import { challengeResponse, selectPaidSaleTopics, verifyEbayNotification } from "@/lib/usa-lots/notifications";
import { isReadOnlyOrderRequest, mergeSaleLines, parseFulfillmentOrders, saleLinesToStore } from "@/lib/usa-lots/parse-order";
import { planMarketplaceSale } from "@/lib/usa-lots/marketplace-sale";
import { ratioToUsd } from "@/lib/usa-lots/money";
import { allocateSharedCents, applyAverageCosts, applyExactAverageCosts, averageShare, averageUnitCents, buildLotReport, costForLinkedSale, saleProfit } from "@/lib/usa-lots/profit";
import { resolveMarketplaceIdentity } from "@/lib/vinted/sale-identity";
import { describeSaleSync, feeGapFromStatus, FINANCES_SCOPE, nextOrderWindow, NOTIFICATION_SCOPE, readsRecentOrdersDuring } from "@/lib/usa-lots/sync-plan";

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
      [{ id: "a", locked: true, sold: false, source: "manual" }, { id: "b", locked: false, sold: true, source: "average", hasCost: true }],
      1050,
      2
    );
    expect(blocked.items.every((item) => item.unitCostCents == null)).toBe(true);
    const open = applyAverageCosts([{ id: "c", locked: false, sold: false, source: "estimated" }], 1050, 4);
    expect(open.estimated).toBe(false);
    expect(open.items[0]).toMatchObject({ unitCostCents: 1050, costEstimated: false });
    const missing = applyAverageCosts([{ id: "d", locked: false, sold: false, source: "estimated" }], null, null);
    expect(missing.error).toContain("No se inventó una cantidad");
  });

  test("keeps the full purchase in the lot and gives Guatemala only its share plus its own shipping", () => {
    const plain = buildLotReport({
      purchaseCents: 90000,
      extraCents: 11500,
      sellableCount: 1723,
      publishedCount: 0,
      guatemalaPieces: 770,
      guatemalaShippingCents: 36000,
      items: [],
      sales: [],
    });
    expect(plain.investedCents).toBe(101500);
    expect(plain.transferred).toBe(770);
    expect(plain.usPieces).toBe(953);
    expect(plain.remaining).toBe(953);
    expect(plain.registered).toBe(0);
    expect(plain.averageUnitCents).toBe(58);
    expect(plain.averageDisplayCents).toBe(59);
    expect(plain.averageText).toBe("$0.589089");
    expect(plain.pendingAssignCents).toBe(0);
    expect(plain.guatemalaShippingUnitCents).toBe(46);
    expect(averageUnitCents(90000, 11500 + 36000, 1723)).toBe(79);

    const items = [
      { id: "us-1", ebayItemId: "111", disposition: "" as const, unitCostCents: 500, costEstimated: false, manual: true },
      { id: "gt-1", ebayItemId: "", disposition: "guatemala-transfer" as const, unitCostCents: 58, costEstimated: false },
    ];
    const report = buildLotReport({
      purchaseCents: 90000,
      extraCents: 11500,
      sellableCount: 1723,
      publishedCount: 1,
      guatemalaPieces: 770,
      guatemalaShippingCents: 36000,
      items,
      sales: [{
        itemId: "sold-old",
        cancelled: false,
        linkStatus: "lotted",
        quantity: 1,
        recordedCostCents: 80,
        profit: saleProfit({
          itemCents: 2000,
          buyerShippingCents: 0,
          taxRemittedCents: 0,
          feeCents: 200,
          sellerShippingCents: 0,
          refundCents: 0,
          otherCents: 0,
          unitCostCents: 80,
          quantity: 1,
          costEstimated: false,
          cancelled: false,
        }),
      }],
    });
    expect(report.investedCents).toBe(101500);
    expect(report.registered).toBe(2);
    expect(report.transferred).toBe(770);
    expect(report.linkedTransfers).toBe(1);
    expect(report.usPieces).toBe(953);
    expect(report.remaining).toBe(953);
    expect(report.averageDisplayCents).toBe(59);
    expect(report.averageUnitCents).toBe(58);
    expect(averageUnitCents(90000, 11500, 1723)).toBe(58);
    expect(averageUnitCents(90000, 11500 + 36000, 1723)).not.toBe(58);
    expect(report.guatemalaShippingCents).toBe(36000);
    expect(report.guatemalaShippingUnitCents).toBe(46);
    expect(report.pendingAssignCents).toBe(-462);
    expect(report.pending.join(" ")).toContain("Los costos ya asignados superan lo invertido por $4.62");
    expect(report.pending.join(" ")).toContain("No se suman al costo de Estados Unidos");

    const linkedLater = buildLotReport({
      purchaseCents: 90000,
      extraCents: 11500,
      sellableCount: 1723,
      publishedCount: 1,
      guatemalaPieces: 770,
      guatemalaShippingCents: 36000,
      items: [
        ...items,
        ...Array.from({ length: 9 }, (_, index) => ({
          id: `gt-${index + 2}`,
          ebayItemId: "",
          disposition: "guatemala-transfer" as const,
          unitCostCents: 58,
          costEstimated: false,
        })),
      ],
      sales: [],
    });
    expect(linkedLater.registered).toBe(11);
    expect(linkedLater.transferred).toBe(770);
    expect(linkedLater.usPieces).toBe(953);

    const split = applyAverageCosts(
      [
        { id: "us", locked: false, sold: false, source: "estimated", disposition: "" as const },
        { id: "gt", locked: false, sold: false, source: "estimated", disposition: "guatemala-transfer" as const },
        { id: "manual", locked: true, sold: false, source: "manual", disposition: "" as const },
        { id: "sold", locked: false, sold: true, source: "average", disposition: "" as const, hasCost: true },
      ],
      58,
      1723,
      58 + 46
    );
    expect(split.items.map((item) => item.unitCostCents)).toEqual([58, 104, null, null]);
  });

  test("prices SKU 3053 with the exact $1,015 / 1,723 share and links the next sale once", () => {
    const share = averageShare(90000, 11500, 1723);
    expect(share).toEqual({ numerator: 101500, denominator: 1723 });
    expect(ratioToUsd(101500, 1723)).toBe("$0.589089");
    const applied = applyExactAverageCosts(
      [
        { id: "3053", locked: false, source: "estimated", disposition: "" as const },
        { id: "manual", locked: true, source: "manual", disposition: "" as const, hasCost: true },
        { id: "gt", locked: false, source: "estimated", disposition: "guatemala-transfer" as const },
      ],
      share,
      { numerator: 101500 * 770 + 36000 * 1723, denominator: 1723 * 770 }
    );
    expect(applied.items[0]).toMatchObject({ costShare: share, costEstimated: false });
    expect(applied.items[1].costShare).toBeNull();
    expect(applied.items[2]?.costShare?.denominator).toBeGreaterThan(1);
    expect(applied.estimated).toBe(false);

    const profit = saleProfit({
      itemCents: 800,
      buyerShippingCents: 0,
      taxRemittedCents: 0,
      feeCents: 295,
      sellerShippingCents: 0,
      refundCents: 0,
      otherCents: 0,
      unitCostCents: null,
      unitCostNumerator: 101500,
      unitCostDenominator: 1723,
      quantity: 1,
      costEstimated: false,
      cancelled: false,
    });
    expect(profit.recoveredCents).toBe(505);
    expect(profit.profitCents).toBe(446);
    expect(profit.label).toBe("Ganancia");
    expect(profit.provisional).toBe(false);
    expect(profit.missing).toEqual([]);

    const ebay = saleProfit({
      itemCents: 1200,
      buyerShippingCents: 821,
      taxRemittedCents: 131,
      feeCents: 313,
      sellerShippingCents: 712,
      refundCents: 0,
      otherCents: 0,
      unitCostCents: null,
      unitCostNumerator: 101500,
      unitCostDenominator: 1723,
      quantity: 1,
      costEstimated: false,
      cancelled: false,
    });
    const report = buildLotReport({
      purchaseCents: 90000,
      extraCents: 11500,
      sellableCount: 1723,
      publishedCount: 2,
      items: [
        { id: "3053", ebayItemId: "", disposition: "", unitCostCents: null, costEstimated: false, costShare: share },
        { id: "3006", ebayItemId: "880094115816", disposition: "", unitCostCents: null, costEstimated: false, costShare: share },
      ],
      sales: [
        { itemId: "3053", cancelled: false, linkStatus: "lotted", platform: "poshmark", profit },
        { itemId: "3006", cancelled: false, linkStatus: "lotted", platform: "ebay", profit: ebay },
      ],
    });
    expect(report.sold).toBe(2);
    expect(report.recoveredCents).toBe(1501);
    expect(report.investedCents).toBe(101500);
    expect(report.soldProfitCents).toBe((profit.profitCents ?? 0) + (ebay.profitCents ?? 0));
    expect(report.soldProfitProvisional).toBe(false);
    expect(report.pending.join(" ")).not.toContain("costo del artículo");
    const repeated = buildLotReport({
      purchaseCents: 90000,
      extraCents: 11500,
      sellableCount: 1723,
      publishedCount: 2,
      items: [
        { id: "3053", ebayItemId: "", disposition: "", unitCostCents: null, costEstimated: false, costShare: share },
        { id: "3006", ebayItemId: "880094115816", disposition: "", unitCostCents: null, costEstimated: false, costShare: share },
      ],
      sales: [
        { itemId: "3053", cancelled: false, linkStatus: "lotted", platform: "poshmark", profit },
        { itemId: "3006", cancelled: false, linkStatus: "lotted", platform: "ebay", profit: ebay },
      ],
    });
    expect(repeated.investedCents).toBe(report.investedCents);
    expect(repeated.recoveredCents).toBe(report.recoveredCents);
    expect(repeated.sold).toBe(2);

    const kept = costForLinkedSale({ itemCostCents: 250, itemShare: null, lotShare: share });
    expect(kept).toEqual({ unitCostCents: 250, numerator: null, denominator: null, estimated: false });
    const filled = costForLinkedSale({ itemCostCents: null, itemShare: null, lotShare: share });
    expect(filled).toEqual({ unitCostCents: null, numerator: 101500, denominator: 1723, estimated: false });

    const identity = resolveMarketplaceIdentity(
      "You just sold 100% Cotton NEW on Poshmark",
      "You just sold 100% Cotton NEW on Poshmark.\nUnder Armour Notre Dame Fighting Irish Green Leprechaun T-Shirt Mens XXL\nSKU 3053\n",
      [
        { sku: "3053", vintedTitle: "Jockey Classics Classic Comfort Briefs 3-Pack White Size 7/L 100% Cotton NEW", ebayTitle: "" },
        { sku: "3006", vintedTitle: "Under Armour Notre Dame Fighting Irish Green Leprechaun T-Shirt Mens XXL", ebayTitle: "" },
      ]
    );
    const article = { id: "3053", sku: identity.sku, title: identity.title, lotId: "compra-1000", listingUrls: [], disposition: "" as const };
    const notice = {
      platform: "poshmark" as const,
      externalId: "msg-3053",
      sku: identity.sku,
      title: identity.title,
      listingUrl: "",
      itemCents: 800,
      buyerShippingCents: 0,
      feeCents: 295,
      sellerShippingCents: 0,
      refundCents: 0,
    };
    expect(planMarketplaceSale(notice, [article], [])).toMatchObject({ action: "record", itemId: "3053", lotId: "compra-1000" });
    expect(planMarketplaceSale(notice, [article], [{
      id: "sale-3053",
      orderId: "poshmark:msg-3053",
      itemId: "3053",
      sku: "3053",
      platform: "poshmark",
      listingKey: "",
      cancelled: false,
      linkStatus: "lotted",
      hasNet: true,
    }]).action).toBe("duplicate");
  });

  test("links paid order 01-15420-99914 to SKU 3006 once and keeps the gain provisional", () => {
    const lot = { id: "lote-1000", sku: "3006", ebayItemId: "880094115816", lotId: "compra-1000", source: "lot" as const, unitCostCents: 59, costEstimated: false };
    const archive = { id: "archivo-3006", sku: "3006", ebayItemId: "880094115816", lotId: "", source: "archive" as const };
    const parsed = saleLinesToStore(parseFulfillmentOrders([{
      orderId: "01-15420-99914",
      orderPaymentStatus: "PAID",
      creationDate: "2026-11-08T18:00:00.000Z",
      lineItems: [{
        lineItemId: "linea-3006",
        legacyItemId: "880094115816",
        sku: "3006",
        title: "Prenda parecida",
        quantity: 1,
        lineItemCost: { value: "12.00", currency: "USD" },
      }],
    }]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.itemCents).toBe(1200);
    const match = lotForMatch(matchSaleToItem({
      ebayItemId: parsed[0]?.ebayItemId ?? "",
      sku: parsed[0]?.sku ?? "",
      variantSku: "",
      title: parsed[0]?.title ?? "",
      items: [archive, lot],
    }));
    expect(match).toEqual({ linkStatus: "lotted", lotId: "compra-1000", itemId: "lote-1000" });
    const stored = {
      id: "venta-3006",
      ebayItemId: "880094115816",
      sku: "3006",
      title: "Otra camisa",
      linkStatus: "unmatched" as const,
      linkLocked: false,
      lotId: "",
      itemId: "",
      unitCostCents: null,
    };
    const first = planStoredSaleLinks([stored], [archive, lot]);
    expect(first).toEqual([{
      saleId: "venta-3006",
      lotId: "compra-1000",
      itemId: "lote-1000",
      linkStatus: "lotted",
      fillUnitCostCents: 59,
      fillCostEstimated: false,
    }]);
    const second = planStoredSaleLinks([{ ...stored, linkStatus: "lotted", lotId: "compra-1000", itemId: "lote-1000", unitCostCents: 59 }], [archive, lot]);
    expect(second).toEqual([]);
    const incoming = { id: "venta-nueva", orderId: "01-15420-99914", lineItemId: "linea-3006", lotId: "compra-1000", linkLocked: false, incomeCents: 1200 };
    const repeated = applyIncomingSale(applyIncomingSale([], incoming), { ...incoming, id: "venta-duplicada", incomeCents: 1200 });
    expect(repeated).toHaveLength(1);
    expect(repeated[0]?.incomeCents).toBe(1200);
    const ambiguous = matchSaleToItem({
      ebayItemId: "",
      sku: "3006",
      variantSku: "",
      title: "Mismo título",
      items: [lot, { ...lot, id: "otra", ebayItemId: "111" }],
    });
    expect(ambiguous.kind).toBe("ambiguous");
    expect(matchSaleToItem({ ebayItemId: "", sku: "", variantSku: "", title: "Prenda parecida", items: [lot] }).kind).toBe("unmatched");
    const profit = saleProfit({
      itemCents: 1200,
      buyerShippingCents: null,
      taxRemittedCents: null,
      feeCents: null,
      sellerShippingCents: null,
      refundCents: 0,
      otherCents: 0,
      unitCostCents: 59,
      quantity: 1,
      costEstimated: false,
      cancelled: false,
    });
    expect(profit.profitCents).toBeNull();
    expect(profit.label).toBe("Ganancia provisional");
    expect(profit.missing).toEqual(expect.arrayContaining(["comisión de eBay", "envío pagado por ti", "envío cobrado al comprador"]));
    const lotInput = {
      purchaseCents: 90000,
      extraCents: 11500,
      sellableCount: 1723,
      publishedCount: 1,
      guatemalaPieces: 770,
      guatemalaShippingCents: 36000,
      items: [
        { id: "lote-1000", ebayItemId: "880094115816", disposition: "" as const, unitCostCents: 59, costEstimated: false, manual: true },
      ],
      sales: [{
        itemId: "archivo-3006",
        ebayItemId: "880094115816",
        cancelled: false,
        linkStatus: "lotted" as const,
        quantity: 1,
        recordedCostCents: 59,
        profit,
      }],
    };
    const report = buildLotReport(lotInput);
    expect(report.sold).toBe(1);
    expect(report.remaining).toBe(952);
    expect(report.usPieces).toBe(953);
    expect(report.transferred).toBe(770);
    expect(report.soldProfitCents).toBeNull();
    expect(report.soldProfitProvisional).toBe(true);
    expect(lotInput.purchaseCents).toBe(90000);
    expect(lotInput.extraCents).toBe(11500);
    expect(lotInput.sellableCount).toBe(1723);
    expect(lotInput.guatemalaPieces).toBe(770);
    expect(lotInput.items[0]?.unitCostCents).toBe(59);
    const again = buildLotReport(lotInput);
    expect(again.sold).toBe(report.sold);
    expect(again.recoveredCents).toBe(report.recoveredCents);
    expect(mergeSaleLines(parsed, parsed)).toHaveLength(1);
    expect(readsRecentOrdersDuring("backfill")).toBe(true);
    expect(readsRecentOrdersDuring("watch")).toBe(false);
    const historical = planStoredSaleLinks([{ ...stored, unitCostCents: 80 }], [lot]);
    expect(historical[0]?.fillUnitCostCents).toBeNull();
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
    const status = describeSaleSync({
      cronSecretSet: true,
      notificationTokenSet: false,
      lastSuccessAt: null,
      lastSource: "",
      lastSaved: 0,
      salesStored: 0,
      lastError: "",
      feeNote: "",
    });
    expect(status.active).toBe(false);
    expect(status.lines.join(" ")).toContain("No hay una consulta correcta");
    expect(status.lines.join(" ")).toContain("CRON_SECRET");
    expect(status.lines.join(" ")).toContain("una vez al día");
    expect(status.lines.join(" ")).toContain("20 USD");
    expect(status.lines.join(" ")).not.toMatch(/sincronización activa/i);
  });

  test("records one paid sale in its lot and leaves an unlotted sale out of the totals", () => {
    const paid = saleLinesToStore(parseFulfillmentOrders([{
      orderId: "ORD-LOTE",
      orderPaymentStatus: "PAID",
      creationDate: "2026-04-01T00:00:00.000Z",
      lineItems: [{ lineItemId: "LINE-LOTE", legacyItemId: "123456789012", sku: "00123", quantity: 1, lineItemCost: { value: "20.00", currency: "USD" }, discountedLineItemCost: { value: "18.00", currency: "USD" } }],
    }]));
    const pending = saleLinesToStore(parseFulfillmentOrders([{
      orderId: "ORD-PEND",
      orderPaymentStatus: "PENDING",
      lineItems: [{ lineItemId: "LINE-PEND", sku: "00123", quantity: 1, lineItemCost: { value: "10.00", currency: "USD" } }],
    }]));
    expect(paid).toHaveLength(1);
    expect(pending).toHaveLength(0);
    const once = applyIncomingSale([], { id: "sale-1", orderId: "ORD-LOTE", lineItemId: "LINE-LOTE", lotId: "lote-a", linkLocked: true, incomeCents: 1800 });
    const repeated = applyIncomingSale(once, { id: "sale-9", orderId: "ORD-LOTE", lineItemId: "LINE-LOTE", lotId: "lote-b", linkLocked: false, incomeCents: 1800 });
    expect(repeated).toHaveLength(1);
    expect(repeated[0]).toMatchObject({ id: "sale-1", lotId: "lote-a" });
    const profit = saleProfit({
      itemCents: 1800,
      buyerShippingCents: 0,
      taxRemittedCents: 150,
      feeCents: 200,
      sellerShippingCents: 0,
      refundCents: 0,
      otherCents: 0,
      unitCostCents: 500,
      quantity: 1,
      costEstimated: false,
      cancelled: false,
    });
    const item = { id: "item-a", ebayItemId: "123456789012", disposition: "" as const, unitCostCents: 500, costEstimated: false };
    const lotted = { itemId: "item-a", cancelled: false, linkStatus: "lotted" as const, profit };
    const base = buildLotReport({ purchaseCents: 1000, extraCents: 0, sellableCount: 1, publishedCount: 1, items: [item], sales: [lotted] });
    const looseProfit = saleProfit({
      itemCents: 9000,
      buyerShippingCents: 0,
      taxRemittedCents: 0,
      feeCents: 100,
      sellerShippingCents: 0,
      refundCents: 0,
      otherCents: 0,
      unitCostCents: null,
      quantity: 1,
      costEstimated: false,
      cancelled: false,
    });
    const withLoose = buildLotReport({
      purchaseCents: 1000,
      extraCents: 0,
      sellableCount: 1,
      publishedCount: 1,
      items: [item],
      sales: [lotted, { itemId: "item-b", cancelled: false, linkStatus: "unassigned", profit: looseProfit }],
    });
    expect(base.sold).toBe(1);
    expect(withLoose.sold).toBe(base.sold);
    expect(withLoose.soldProfitCents).toBe(base.soldProfitCents);
    expect(withLoose.recoveredCents).toBe(base.recoveredCents);
    expect(withLoose.investedCents).toBe(base.investedCents);
  });

  test("keeps the eBay fee separate from the sale price and checks notification topics", () => {
    expect(feeFromTransactions({
      transactions: [
        { transactionType: "SALE", orderId: "ORD-FEE", amount: { value: "18.00", currency: "USD" }, totalFeeAmount: { value: "2.35", currency: "USD" } },
        { transactionType: "SHIPPING_LABEL", orderId: "ORD-FEE", amount: { value: "4.50", currency: "USD" } },
      ],
    }, "ORD-FEE")).toEqual({ feeCents: 235, sellerShippingCents: 450 });
    expect(feeFromTransactions({
      transactions: [{ transactionType: "SALE", orderId: "ORD-FEE", amount: { value: "18.00", currency: "USD" } }],
    }, "ORD-FEE").feeCents).toBeNull();
    const granted = EBAY_SCOPES.split(/\s+/);
    const topic = (id: string, authorizationScopes: string[] = [], status = "ENABLED") => ({ id, schemaVersion: "1.0", authorizationScopes, status });
    const chosen = selectPaidSaleTopics([
      topic("ORDER_CONFIRMATION", [NOTIFICATION_SCOPE]),
      topic("LOAN_APPLICATION_CANCEL", [FINANCES_SCOPE]),
      topic("ORDER_CANCELLED"),
      topic("BUYER_QUESTION"),
      topic("ITEM_PRICE_REFUND"),
    ], granted);
    expect(chosen.selected.map((item) => item.id)).toEqual(["ORDER_CONFIRMATION"]);
    expect(chosen.unavailable).toEqual([]);
    expect(chosen.unauthorized).toEqual([]);
    const missing = selectPaidSaleTopics([topic("LOAN_APPLICATION_CANCEL"), topic("ORDER_CANCELLED")], granted);
    expect(missing.selected).toEqual([]);
    expect(missing.unavailable).toEqual(["ORDER_CONFIRMATION"]);
    const blocked = selectPaidSaleTopics([
      topic("ORDER_CONFIRMATION", ["https://api.ebay.com/oauth/api_scope/commerce.identity.readonly"]),
    ], granted);
    expect(blocked.selected).toEqual([]);
    expect(blocked.unauthorized).toEqual([{ id: "ORDER_CONFIRMATION", missingScopes: ["https://api.ebay.com/oauth/api_scope/commerce.identity.readonly"] }]);
    const oldGrant = granted.filter((scope) => scope !== FULFILLMENT_READONLY_SCOPE);
    const readonlyOnly = selectPaidSaleTopics([
      topic("ORDER_CONFIRMATION", [FULFILLMENT_READONLY_SCOPE, NOTIFICATION_SCOPE]),
    ], oldGrant);
    expect(readonlyOnly.selected).toEqual([]);
    expect(readonlyOnly.unauthorized[0]?.missingScopes).toEqual([FULFILLMENT_READONLY_SCOPE]);
    const grantedReadonly = selectPaidSaleTopics([
      topic("ORDER_CONFIRMATION", [FULFILLMENT_READONLY_SCOPE, NOTIFICATION_SCOPE]),
    ], [NOTIFICATION_SCOPE, FULFILLMENT_READONLY_SCOPE]);
    expect(grantedReadonly.selected.map((item) => item.id)).toEqual(["ORDER_CONFIRMATION"]);
    const unreported = selectPaidSaleTopics([
      topic("ORDER_CONFIRMATION", [FULFILLMENT_READONLY_SCOPE]),
      topic("LOAN_APPLICATION_CANCEL", [FINANCES_SCOPE]),
    ], null);
    expect(unreported.selected.map((item) => item.id)).toEqual(["ORDER_CONFIRMATION"]);
    expect(unreported.unauthorized).toEqual([]);
    expect(EBAY_SCOPES).toContain(FULFILLMENT_READONLY_SCOPE);
    expect(connectionFromToken("refresh-prueba", 3600, `${NOTIFICATION_SCOPE} ${FULFILLMENT_READONLY_SCOPE}`).grantedScopes).toEqual([
      NOTIFICATION_SCOPE,
      FULFILLMENT_READONLY_SCOPE,
    ]);
    expect(EBAY_SCOPES).toContain(FINANCES_SCOPE);
    expect(EBAY_SCOPES).toContain(NOTIFICATION_SCOPE);
    const endpoint = "https://example.com/api/ebay/notificaciones";
    expect(challengeResponse("code", "token", endpoint)).toBe(
      crypto.createHash("sha256").update(`codetoken${endpoint}`).digest("hex")
    );
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const body = JSON.stringify({ notification: { orderId: "12-34567-89012" } });
    const signer = crypto.createSign("sha1");
    signer.update(body);
    const signature = signer.sign(privateKey).toString("base64");
    const header = Buffer.from(JSON.stringify({ alg: "ECDSA", kid: "key-1", signature, digest: "SHA1" })).toString("base64");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyEbayNotification(body, header, pem)).toBe(true);
    expect(verifyEbayNotification(`${body}x`, header, pem)).toBe(false);
  });

  test("asks eBay for at most 100 topics and keeps the lister as the notification host", () => {
    const topics = new URL(notificationCollectionUrl("topic"));
    expect(topics.pathname).toBe("/commerce/notification/v1/topic");
    expect(Number(topics.searchParams.get("limit"))).toBeGreaterThanOrEqual(10);
    expect(Number(topics.searchParams.get("limit"))).toBeLessThanOrEqual(100);
    expect(notificationCollectionUrl("subscription", "next-page")).toContain("continuation_token=next-page");
    const failure = describeEbayFailure(400, {
      errors: [{ errorId: 195004, longMessage: "Invalid limit. Supported ranges 10 - 100. Token secreto-privado-de-prueba" }],
    }, ["secreto-privado-de-prueba"]);
    expect(failure).toContain("195004");
    expect(failure).toContain("Invalid limit");
    expect(failure).not.toContain("secreto-privado-de-prueba");
    expect(notificationEndpoint({
      productionHost: "www.variedadessanandres.com",
      requestOrigin: "https://hahm-ebay-lister-ebay-lister3.vercel.app",
    })).toEqual({ endpoint: "https://hahm-ebay-lister-ebay-lister3.vercel.app/api/ebay/notificaciones" });
    expect(notificationEndpoint({
      productionHost: "hahm-ebay-lister-ebay-lister3.vercel.app",
      requestOrigin: "https://www.variedadessanandres.com",
    })).toEqual({ endpoint: "https://hahm-ebay-lister-ebay-lister3.vercel.app/api/ebay/notificaciones" });
    expect(cronAuthorized(null, null, "")).toBe(false);
    expect(cronAuthorized("Bearer cron-de-prueba", null, "cron-de-prueba")).toBe(true);
    expect(cronAuthorized("Bearer otro", null, "cron-de-prueba")).toBe(false);
    const missingConfig = {
      errors: [{ errorId: 195003, longMessage: "Please provide configurations required for notifications. Refer to /config" }],
    };
    expect(needsNotificationConfig(409, missingConfig)).toBe(true);
    expect(needsNotificationConfig(409, { errors: [{ errorId: 195021, longMessage: "Destination exists for this endpoint" }] })).toBe(false);
    expect(notificationConfigUrl()).toBe("https://api.ebay.com/commerce/notification/v1/config");
    expect(validAlertEmail("alertas@ejemplo.com")).toBe("alertas@ejemplo.com");
    expect(validAlertEmail("no es correo")).toBe("");
    expect(emailFromXml("<User><Email>alertas@ejemplo.com</Email><UserID>tienda</UserID></User>")).toBe("alertas@ejemplo.com");
  });

  test("saves the eBay alert config before creating the destination and subscription", async () => {
    const calls: string[] = [];
    const posted: string[] = [];
    const original = global.fetch;
    const previous = {
      id: process.env.EBAY_CLIENT_ID,
      secret: process.env.EBAY_CLIENT_SECRET,
      ru: process.env.EBAY_RU_NAME,
      email: process.env.EBAY_NOTIFICATION_ALERT_EMAIL,
    };
    process.env.EBAY_CLIENT_ID = "app-id-prueba";
    process.env.EBAY_CLIENT_SECRET = "cert-prueba";
    process.env.EBAY_RU_NAME = "ru-prueba";
    delete process.env.EBAY_NOTIFICATION_ALERT_EMAIL;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url.includes("/identity/v1/oauth2/token")) return json({ access_token: "app-token-prueba", expires_in: 7200 });
      if (url.includes("/topic")) {
        return json({
          topics: [
            { topicId: "LOAN_APPLICATION_CANCEL", status: "ENABLED", authorizationScopes: [FINANCES_SCOPE], supportedPayloads: [{ schemaVersion: "1.0" }] },
            { topicId: "ORDER_CONFIRMATION", status: "ENABLED", authorizationScopes: [NOTIFICATION_SCOPE, FULFILLMENT_READONLY_SCOPE], supportedPayloads: [{ schemaVersion: "1.0" }] },
            { topicId: "ORDER_CANCELLED", status: "ENABLED", supportedPayloads: [{ schemaVersion: "1.0" }] },
          ],
        });
      }
      if (url.endsWith("/config") && method === "GET") return json({}, 404);
      if (url.endsWith("/config") && method === "PUT") return new Response(null, { status: 204 });
      if (url.includes("/ws/api.dll")) {
        return new Response("<GetUserResponse><Ack>Success</Ack><User><Email>alertas@ejemplo.com</Email></User></GetUserResponse>", { status: 200 });
      }
      if (url.includes("/destination") && method === "GET") return json({ destinations: [] });
      if (url.includes("/destination") && method === "POST") return json({ destinationId: "dest-1" }, 201);
      if (url.includes("/subscription/") && method === "DELETE") return new Response(null, { status: 204 });
      if (url.includes("/subscription") && method === "GET") {
        const priorReads = calls.filter((call) => call.startsWith("GET ") && call.includes("/subscription")).length;
        if (priorReads === 1) {
          return json({
            subscriptions: [{ subscriptionId: "sub-loan", topicId: "LOAN_APPLICATION_CANCEL", destinationId: "dest-1", status: "ENABLED" }],
          });
        }
        return json({
          subscriptions: [{ subscriptionId: "sub-1", topicId: "ORDER_CONFIRMATION", destinationId: "dest-1", status: "ENABLED" }],
        });
      }
      if (url.includes("/subscription") && method === "POST") {
        posted.push(String(init?.body ?? ""));
        return json({ subscriptionId: "sub-1" }, 201);
      }
      return json({ errors: [{ errorId: 1, message: "unexpected" }] }, 500);
    };
    try {
      const result = await subscribeSaleNotifications({
        token: "user-token-prueba",
        endpoint: "https://hahm-ebay-lister-ebay-lister3.vercel.app/api/ebay/notificaciones",
        verificationToken: "a".repeat(32),
        grantedScopes: [NOTIFICATION_SCOPE, FULFILLMENT_READONLY_SCOPE],
        scopesReported: true,
      });
      expect(result.ok).toBe(true);
      const configAt = calls.findIndex((call) => call.startsWith("PUT ") && call.includes("/config"));
      const destinationAt = calls.findIndex((call) => call.startsWith("POST ") && call.includes("/destination"));
      const subscriptionAt = calls.findIndex((call) => call.startsWith("POST ") && call.includes("/subscription"));
      expect(configAt).toBeGreaterThanOrEqual(0);
      expect(destinationAt).toBeGreaterThan(configAt);
      expect(subscriptionAt).toBeGreaterThan(destinationAt);
      expect(calls.some((call) => call.startsWith("DELETE ") && call.includes("/subscription/sub-loan"))).toBe(true);
      expect(posted).toHaveLength(1);
      expect(posted[0]).toContain("ORDER_CONFIRMATION");
      expect(posted.join(" ")).not.toContain("LOAN_APPLICATION_CANCEL");
      expect(posted.join(" ")).not.toContain("ORDER_CANCELLED");
      if (result.ok) {
        const text = result.lines.join(" ");
        expect(text).not.toContain("alertas@ejemplo.com");
        expect(text).toContain("ORDER_CONFIRMATION quedó suscrita y activa");
        expect(text).toContain("LOAN_APPLICATION_CANCEL");
      }
    } finally {
      global.fetch = original;
      process.env.EBAY_CLIENT_ID = previous.id;
      process.env.EBAY_CLIENT_SECRET = previous.secret;
      process.env.EBAY_RU_NAME = previous.ru;
      if (previous.email == null) delete process.env.EBAY_NOTIFICATION_ALERT_EMAIL;
      else process.env.EBAY_NOTIFICATION_ALERT_EMAIL = previous.email;
    }
  });

  test("does not subscribe when the account grant lacks sell.fulfillment.readonly", async () => {
    const calls: string[] = [];
    const original = global.fetch;
    const previous = {
      id: process.env.EBAY_CLIENT_ID,
      secret: process.env.EBAY_CLIENT_SECRET,
      ru: process.env.EBAY_RU_NAME,
    };
    process.env.EBAY_CLIENT_ID = "app-id-prueba";
    process.env.EBAY_CLIENT_SECRET = "cert-prueba";
    process.env.EBAY_RU_NAME = "ru-prueba";
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url} ${init?.body ?? ""}`);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url.includes("/topic")) {
        return json({
          topics: [{ topicId: "ORDER_CONFIRMATION", status: "ENABLED", authorizationScopes: [FULFILLMENT_READONLY_SCOPE], supportedPayloads: [{ schemaVersion: "1.0" }] }],
        });
      }
      if (url.includes("/destination") && method === "GET") {
        return json({
          destinations: [{ destinationId: "dest-1", status: "ENABLED", deliveryConfig: { endpoint: "https://hahm-ebay-lister-ebay-lister3.vercel.app/api/ebay/notificaciones" } }],
        });
      }
      if (url.includes("/subscription") && method === "GET") return json({ subscriptions: [] });
      return json({ errors: [{ errorId: 1, message: "unexpected" }] }, 500);
    };
    try {
      const result = await subscribeSaleNotifications({
        token: "user-token-prueba",
        endpoint: "https://hahm-ebay-lister-ebay-lister3.vercel.app/api/ebay/notificaciones",
        verificationToken: "a".repeat(32),
        grantedScopes: EBAY_SCOPES.split(/\s+/).filter((scope) => scope !== FULFILLMENT_READONLY_SCOPE),
        scopesReported: true,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("no quedó suscrita");
        expect(result.error).toContain(FULFILLMENT_READONLY_SCOPE);
        expect(result.error).toContain("ENABLED");
        expect(result.error).not.toContain("quedó suscrita y activa");
      }
      expect(calls.some((call) => call.startsWith("POST ") && call.includes("/subscription"))).toBe(false);
      expect(calls.some((call) => call.startsWith("POST ") && call.includes("/destination"))).toBe(false);
      expect(buildAuthorizeUrl("estado-prueba")).toContain("sell.fulfillment.readonly");
      const refreshCalls: string[] = [];
      global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        refreshCalls.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({ access_token: "acceso", expires_in: 7200, token_type: "Bearer" }), { status: 200 });
      };
      const omitted = await refreshAccessToken("refresh-viejo");
      expect(omitted.scopesReported).toBe(false);
      expect(omitted.scope).toBeUndefined();
      expect(refreshCalls[0] ?? "").not.toContain("scope=");
      await refreshAccessToken("refresh-nuevo", [FULFILLMENT_READONLY_SCOPE]);
      expect(refreshCalls[1] ?? "").toContain("sell.fulfillment.readonly");
    } finally {
      global.fetch = original;
      process.env.EBAY_CLIENT_ID = previous.id;
      process.env.EBAY_CLIENT_SECRET = previous.secret;
      process.env.EBAY_RU_NAME = previous.ru;
    }
  });

  test("subscribes when the token response omits scope and confirms with a later read", async () => {
    const calls: string[] = [];
    const posted: string[] = [];
    const original = global.fetch;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      const endpoint = "https://hahm-ebay-lister-ebay-lister3.vercel.app/api/ebay/notificaciones";
      if (url.includes("/topic")) {
        return json({
          topics: [{ topicId: "ORDER_CONFIRMATION", status: "ENABLED", authorizationScopes: [FULFILLMENT_READONLY_SCOPE], supportedPayloads: [{ schemaVersion: "1.0" }] }],
        });
      }
      if (url.includes("/destination") && method === "GET") {
        return json({ destinations: [{ destinationId: "dest-1", status: "ENABLED", deliveryConfig: { endpoint } }] });
      }
      if (url.includes("/subscription") && method === "GET") {
        const reads = calls.filter((call) => call.startsWith("GET ") && call.includes("/subscription")).length;
        if (reads === 1) return json({ subscriptions: [] });
        return json({
          subscriptions: [{ subscriptionId: "sub-1", topicId: "ORDER_CONFIRMATION", destinationId: "dest-1", status: "ENABLED" }],
        });
      }
      if (url.includes("/subscription") && method === "POST") {
        posted.push(String(init?.body ?? ""));
        return json({ subscriptionId: "sub-1" }, 201);
      }
      return json({ errors: [{ errorId: 1, message: "unexpected" }] }, 500);
    };
    try {
      const result = await subscribeSaleNotifications({
        token: "user-token-prueba",
        endpoint: "https://hahm-ebay-lister-ebay-lister3.vercel.app/api/ebay/notificaciones",
        verificationToken: "a".repeat(32),
        grantedScopes: [],
        scopesReported: false,
      });
      expect(result.ok).toBe(true);
      expect(posted).toHaveLength(1);
      expect(posted[0]).toContain("ORDER_CONFIRMATION");
      expect(calls.some((call) => call.startsWith("POST ") && call.includes("/destination"))).toBe(false);
      expect(calls.filter((call) => call.startsWith("GET ") && call.includes("/subscription"))).toHaveLength(2);
      if (result.ok) {
        const text = result.lines.join(" ");
        expect(text).toContain("no trajo scope");
        expect(text).toContain("ORDER_CONFIRMATION quedó suscrita y activa");
        expect(text).toContain("ENABLED");
        expect(text).not.toContain(EBAY_SCOPES);
      }
    } finally {
      global.fetch = original;
    }
  });

  test("does not mark notifications ready when the later read lacks ORDER_CONFIRMATION", async () => {
    const original = global.fetch;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      const endpoint = "https://hahm-ebay-lister-ebay-lister3.vercel.app/api/ebay/notificaciones";
      if (url.includes("/topic")) {
        return json({ topics: [{ topicId: "ORDER_CONFIRMATION", status: "ENABLED", supportedPayloads: [{ schemaVersion: "1.0" }] }] });
      }
      if (url.includes("/destination") && method === "GET") {
        return json({ destinations: [{ destinationId: "dest-1", status: "ENABLED", deliveryConfig: { endpoint } }] });
      }
      if (url.includes("/subscription") && method === "GET") return json({ subscriptions: [] });
      if (url.includes("/subscription") && method === "POST") return json({ subscriptionId: "sub-1" }, 201);
      return json({ errors: [{ errorId: 1, message: "unexpected" }] }, 500);
    };
    try {
      const result = await subscribeSaleNotifications({
        token: "user-token-prueba",
        endpoint: "https://hahm-ebay-lister-ebay-lister3.vercel.app/api/ebay/notificaciones",
        verificationToken: "a".repeat(32),
        grantedScopes: [],
        scopesReported: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("no quedó suscrita");
        expect(result.error).toContain("ENABLED");
        expect(result.error).not.toContain("quedó suscrita y activa");
      }
    } finally {
      global.fetch = original;
    }
  });
});
