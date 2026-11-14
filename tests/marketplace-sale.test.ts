import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeMarketplaceNotices,
  manualMarketplaceMoney,
  marketplaceListingKey,
  matchMarketplaceArticle,
  planMarketplaceSale,
  type MarketplaceArticle,
  type MarketplaceExistingSale,
  type MarketplaceNotice,
} from "@/lib/usa-lots/marketplace-sale";
import { buildLotReport, saleProfit, type LotSaleSnapshot } from "@/lib/usa-lots/profit";

const coat: MarketplaceArticle = {
  id: "coat",
  sku: "2830",
  lotId: "lote-1",
  listingUrls: ["https://poshmark.com/listing/navy-wool-coat-64abc"],
};

const nike: MarketplaceArticle = {
  id: "nike",
  sku: "NIKE-1",
  lotId: "lote-1",
  listingUrls: [],
};

function money(partial: {
  itemCents?: number | null;
  buyerShippingCents?: number | null;
  feeCents?: number | null;
  sellerShippingCents?: number | null;
  refundCents?: number | null;
  unitCostCents?: number | null;
  feeLabel?: string;
}) {
  return saleProfit({
    itemCents: partial.itemCents ?? null,
    buyerShippingCents: partial.buyerShippingCents ?? null,
    taxRemittedCents: 0,
    feeCents: partial.feeCents ?? null,
    sellerShippingCents: partial.sellerShippingCents ?? null,
    refundCents: partial.refundCents ?? null,
    otherCents: 0,
    unitCostCents: partial.unitCostCents ?? 5000,
    quantity: 1,
    costEstimated: false,
    cancelled: false,
    feeLabel: partial.feeLabel,
  });
}

function snapshot(itemId: string, profit: ReturnType<typeof saleProfit>, platform?: string): LotSaleSnapshot {
  return { itemId, cancelled: false, linkStatus: "lotted", profit, platform, quantity: 1, recordedCostCents: 5000 };
}

const notice = (patch: Partial<MarketplaceNotice> = {}): MarketplaceNotice => ({
  platform: "poshmark",
  externalId: "gmail-ayer",
  sku: "2830",
  title: "Navy Wool Coat",
  listingUrl: "",
  itemCents: 8000,
  buyerShippingCents: 0,
  feeCents: 1600,
  sellerShippingCents: 400,
  refundCents: 0,
  ...patch,
});

describe("ventas de Poshmark y Depop en el lote", () => {
  const items = [
    { id: "coat", ebayItemId: "", disposition: "" as const, unitCostCents: 5000, costEstimated: false },
    { id: "nike", ebayItemId: "111", disposition: "" as const, unitCostCents: 5000, costEstimated: false },
  ];

  it("vincula por SKU y actualiza vendidos, restantes, neto, ganancia e inversión", () => {
    const plan = planMarketplaceSale(notice(), [coat, nike], []);
    expect(plan).toMatchObject({ action: "record", itemId: "coat", lotId: "lote-1", hasNet: true });
    const report = buildLotReport({
      purchaseCents: 10000,
      extraCents: 0,
      sellableCount: 2,
      publishedCount: 1,
      items,
      sales: [snapshot("coat", money({
        itemCents: 8000,
        buyerShippingCents: 0,
        feeCents: 1600,
        sellerShippingCents: 400,
        refundCents: 0,
        feeLabel: "comisión de Poshmark",
      }), "poshmark")],
    });
    expect(report.sold).toBe(1);
    expect(report.remaining).toBe(1);
    expect(report.recoveredCents).toBe(6000);
    expect(report.soldProfitCents).toBe(1000);
    expect(report.investmentLeftCents).toBe(4000);
    expect(report.recoveredProvisional).toBe(false);
  });

  it("vincula Depop por el enlace de la publicación y no por el título", () => {
    const depop: MarketplaceArticle = {
      id: "jacket",
      sku: "",
      lotId: "lote-1",
      listingUrls: ["https://www.depop.com/products/coat-123?ref=mail"],
    };
    expect(marketplaceListingKey("depop", "https://www.depop.com/products/coat-123")).toBe("depop.com/products/coat-123");
    const plan = planMarketplaceSale(notice({
      platform: "depop",
      externalId: "depop-1",
      sku: "",
      title: "Blue Denim Jacket",
      listingUrl: "https://www.depop.com/products/coat-123",
    }), [depop], []);
    expect(plan).toMatchObject({ action: "record", itemId: "jacket" });
    expect(matchMarketplaceArticle({ platform: "depop", sku: "", listingUrl: "" }, [depop]).kind).toBe("none");
  });

  it("no cuenta dos veces la misma prenda si llega por correo y por la ficha", () => {
    const email: MarketplaceExistingSale = {
      id: "sale-email",
      orderId: "poshmark:gmail-ayer",
      itemId: "coat",
      sku: "2830",
      platform: "poshmark",
      listingKey: "",
      cancelled: false,
      linkStatus: "lotted",
      hasNet: false,
    };
    const manual = planMarketplaceSale(notice({ externalId: "manual-coat" }), [coat], [email]);
    expect(manual).toMatchObject({ action: "complete", saleId: "sale-email", itemId: "coat" });
    const ebay = snapshot("coat", money({
      itemCents: 8000,
      buyerShippingCents: 0,
      feeCents: 1000,
      sellerShippingCents: 500,
      refundCents: 0,
    }), "ebay");
    const again = snapshot("coat", money({
      itemCents: 4000,
      buyerShippingCents: 0,
      feeCents: 800,
      sellerShippingCents: 0,
      refundCents: 0,
      feeLabel: "comisión de Poshmark",
    }), "poshmark");
    const report = buildLotReport({
      purchaseCents: 10000,
      extraCents: 0,
      sellableCount: 2,
      publishedCount: 1,
      items,
      sales: [ebay, again],
    });
    expect(report.sold).toBe(1);
    expect(report.recoveredCents).toBe(6500);
    expect(report.recoveredCents).not.toBe(6500 + 3200);
    expect(report.investmentLeftCents).toBe(3500);
  });

  it("descuenta la prenda detectada sin anotar la comisión faltante como cero", () => {
    const detected = money({ feeLabel: "comisión de Poshmark" });
    expect(detected.recoveredCents).toBeNull();
    expect(detected.missing).toContain("comisión de Poshmark");
    expect(detected.missing).not.toContain("comisión de eBay");
    const ebay = snapshot("nike", money({
      itemCents: 8000,
      buyerShippingCents: 0,
      feeCents: 1000,
      sellerShippingCents: 500,
      refundCents: 0,
    }), "ebay");
    const report = buildLotReport({
      purchaseCents: 10000,
      extraCents: 0,
      sellableCount: 2,
      publishedCount: 1,
      items,
      sales: [ebay, snapshot("coat", detected, "poshmark")],
    });
    expect(report.sold).toBe(2);
    expect(report.remaining).toBe(0);
    expect(report.recoveredCents).toBe(6500);
    expect(report.recoveredProvisional).toBe(true);
    expect(report.soldProfitCents).toBe(1500);
    expect(report.investmentLeftCents).toBe(3500);
    expect(report.pending.join(" ")).toContain("Poshmark");
    expect(report.pending.join(" ")).toContain("no se anotó como cero");
  });

  it("no adivina la ficha cuando el SKU está repetido y exige montos escritos", () => {
    const copy = { ...coat, id: "coat-2" };
    expect(matchMarketplaceArticle({ platform: "poshmark", sku: "2830", listingUrl: "" }, [coat, copy]).kind).toBe("ambiguous");
    expect(planMarketplaceSale(notice(), [coat, copy], []).action).toBe("unmatched");
    expect(manualMarketplaceMoney({ price: "80.00", fee: "", buyerShipping: "0.00", sellerShipping: "0.00" }).ok).toBe(false);
    expect(manualMarketplaceMoney({ price: "80.00", fee: "16.00", buyerShipping: "0.00", sellerShipping: "4.00" })).toMatchObject({
      ok: true,
      money: { itemCents: 8000, feeCents: 1600, buyerShippingCents: 0, sellerShippingCents: 400, refundCents: 0 },
    });
  });

  it("explica en pantalla por qué no entró el aviso de Poshmark", () => {
    expect(describeMarketplaceNotices([], [])).toEqual([
      "No se importó la venta de Poshmark: no hay ningún aviso de Poshmark ni de Depop guardado. El correo no quedó registrado en esta base.",
    ]);
    expect(describeMarketplaceNotices([
      { platform: "poshmark", status: "failed", sku: "", title: "Navy Wool Coat", externalId: "gmail-ayer", soldAt: "2026-11-12T15:00:00.000Z" },
    ], [])[0]).toContain("estado failed");
    expect(describeMarketplaceNotices([
      { platform: "poshmark", status: "sent", sku: "", title: "Navy Wool Coat", externalId: "gmail-ayer", soldAt: "2026-11-12T15:00:00.000Z" },
    ], ["poshmark:gmail-ayer"])[0]).toContain("Ventas por vincular");
  });

  it("la ficha del lote ofrece el registro manual", () => {
    const page = readFileSync("app/lotes/page.tsx", "utf8");
    expect(page).toContain('action: "marketplace"');
    expect(page).toContain("Registrar venta");
    expect(page).toContain("Poshmark y Depop no envían el precio ni la comisión");
    expect(page).toContain("Avisos de Poshmark y Depop");
    expect(page).toContain("Este lote no tiene prendas registradas una por una");
    const route = readFileSync("app/api/lotes/route.ts", "utf8");
    expect(route).toContain('action === "marketplace"');
    expect(route).toContain("importDetectedMarketplaceSales");
  });
});
