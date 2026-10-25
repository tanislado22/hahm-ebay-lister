import { afterEach, describe, expect, it, vi } from "vitest";
import { activePageCount, fetchAllActiveSellerListings } from "@/lib/ebay/active-inventory";
import { planEbayRelinks, type ActiveEbayListing, type StoredEbayArticle } from "@/lib/ebay/relist-link";

const stored: StoredEbayArticle = { id: "articulo-1", sku: "0123-AB", itemId: "111111111111" };
const replacement: ActiveEbayListing = { itemId: "222222222222", sku: "0123-AB" };

function endedState(itemId: string): "active" | "ended" | "unknown" {
  return itemId === "111111111111" ? "ended" : "unknown";
}

describe("vínculos de eBay republicados", () => {
  it("cambia el Item ID cuando hay una sola publicación activa con el mismo SKU", () => {
    const summary = planEbayRelinks({
      articles: [stored],
      active: [replacement, { itemId: "333333333333", sku: "123-AB" }],
      oldState: endedState,
      catalogComplete: true,
    });
    expect(summary.updated).toBe(1);
    expect(summary.plans[0]).toMatchObject({
      id: "articulo-1",
      sku: "0123-AB",
      previousItemId: "111111111111",
      nextItemId: "222222222222",
      outcome: "updated",
    });
    expect(summary.plans).toHaveLength(1);
  });

  it("deja en revisión un SKU activo repetido o ausente y no usa el título", () => {
    const duplicate = planEbayRelinks({
      articles: [stored],
      active: [replacement, { itemId: "444444444444", sku: "0123-AB" }],
      oldState: endedState,
      catalogComplete: true,
    });
    expect(duplicate.review).toBe(1);
    expect(duplicate.updated).toBe(0);
    expect(duplicate.plans[0].nextItemId).toBeNull();

    const missingSku = planEbayRelinks({
      articles: [{ ...stored, sku: "  " }],
      active: [{ itemId: "222222222222", sku: "", title: "Mismo título" } as ActiveEbayListing],
      oldState: endedState,
      catalogComplete: true,
    });
    expect(missingSku.review).toBe(1);
    expect(missingSku.updated).toBe(0);

    const titleOnly = planEbayRelinks({
      articles: [stored],
      active: [{ itemId: "555555555555", sku: "OTRO" }],
      oldState: endedState,
      catalogComplete: true,
    });
    expect(titleOnly.missing).toBe(1);
    expect(titleOnly.updated).toBe(0);
  });

  it("no trata un error o un inventario incompleto como publicación finalizada", () => {
    const incomplete = planEbayRelinks({
      articles: [stored],
      active: [],
      oldState: () => "ended",
      catalogComplete: false,
    });
    expect(incomplete.incomplete).toBe(true);
    expect(incomplete.updated).toBe(0);
    expect(incomplete.missing).toBe(0);
    expect(incomplete.review).toBe(0);
    expect(incomplete.skipped).toBe(1);

    const lookupFailed = planEbayRelinks({
      articles: [stored],
      active: [replacement],
      oldState: () => "unknown",
      catalogComplete: true,
    });
    expect(lookupFailed.skipped).toBe(1);
    expect(lookupFailed.missing).toBe(0);
    expect(lookupFailed.updated).toBe(0);

    expect(activePageCount("<TotalNumberOfPages>0</TotalNumberOfPages>", 200)).toBeNull();
    expect(activePageCount("<Item></Item>", 200)).toBeNull();
    expect(activePageCount("<TotalNumberOfPages>3</TotalNumberOfPages>", 200)).toBe(3);
  });

  it("lee todas las páginas y un fallo de eBay no devuelve un inventario parcial", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      const page = body.includes("<PageNumber>2</PageNumber>") ? 2 : 1;
      return new Response(activePageXml(page), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAllActiveSellerListings("token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.listings.map((listing) => listing.itemId)).toEqual(["111111111111", "222222222222"]);
      expect(result.listings.map((listing) => listing.sku)).toEqual(["0123-AB", "0456-CD"]);
    }

    vi.stubGlobal("fetch", vi.fn(async () => new Response("Failure", { status: 500 })));
    const failed = await fetchAllActiveSellerListings("token");
    expect(failed).toEqual({
      ok: false,
      error: "No se pudo leer el inventario activo de eBay. No se marcó ninguna publicación como finalizada.",
    });
  });
});

function activePageXml(page: number): string {
  const item =
    page === 1
      ? itemXml("111111111111", "0123-AB")
      : itemXml("222222222222", "0456-CD");
  return `<?xml version="1.0"?>
<GetMyeBaySellingResponse>
  <Ack>Success</Ack>
  <ActiveList>
    <PaginationResult><TotalNumberOfPages>2</TotalNumberOfPages></PaginationResult>
    <ItemArray>${item}</ItemArray>
  </ActiveList>
</GetMyeBaySellingResponse>`;
}

function itemXml(itemId: string, sku: string): string {
  return `<Item><ItemID>${itemId}</ItemID><SKU>${sku}</SKU><Title>Camisa</Title><ListingStatus>Active</ListingStatus></Item>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});
