export const EXISTING_PRUEBA1_TEST_SALE = {
  sku: "prueba1",
  publishedPriceGtq: "40.00",
  chargedPriceGtq: "20.00",
  soldFromInclusive: "2026-10-17T09:22:00.000Z",
  soldToExclusive: "2026-10-17T09:23:00.000Z",
} as const;

export interface ExistingSaleMark {
  sku: string;
  publishedPriceGtq: string;
  chargedPriceGtq: string;
  soldAt: string;
  clientIsGuatemala: boolean;
  isTest: boolean;
  soldByRole?: string | null;
  soldByUsername?: string | null;
}

// Identifies the one sale already recorded in the preview. It is not a rule for future SKUs.
export function matchesExistingPrueba1TestSale(sale: ExistingSaleMark): boolean {
  const soldAt = new Date(sale.soldAt).getTime();
  const from = new Date(EXISTING_PRUEBA1_TEST_SALE.soldFromInclusive).getTime();
  const to = new Date(EXISTING_PRUEBA1_TEST_SALE.soldToExclusive).getTime();
  return (
    sale.clientIsGuatemala &&
    sale.sku === EXISTING_PRUEBA1_TEST_SALE.sku &&
    sale.publishedPriceGtq === EXISTING_PRUEBA1_TEST_SALE.publishedPriceGtq &&
    sale.chargedPriceGtq === EXISTING_PRUEBA1_TEST_SALE.chargedPriceGtq &&
    soldAt >= from &&
    soldAt < to
  );
}

export function markExistingPrueba1SaleAsTest<T extends ExistingSaleMark>(sale: T, alreadyApplied: boolean): T {
  if (alreadyApplied || sale.isTest || !matchesExistingPrueba1TestSale(sale)) return sale;
  return { ...sale, isTest: true };
}
