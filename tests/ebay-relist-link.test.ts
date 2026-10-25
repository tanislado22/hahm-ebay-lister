import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activePageCount,
  ebaySellerUserId,
  fetchAllActiveSellerListings,
  fetchEbaySellerUser,
  readActiveList,
} from "@/lib/ebay/active-inventory";
import { planEbayRelinks, resolveOldListingStates, type ActiveEbayListing, type StoredEbayArticle } from "@/lib/ebay/relist-link";

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
      articles: [{ ...stored, title: "Shorts anteriores", source: "vinted" }],
      active: [{ itemId: "555555555555", sku: "OTRO" }],
      oldState: endedState,
      catalogComplete: true,
    });
    expect(titleOnly.missing).toBe(1);
    expect(titleOnly.updated).toBe(0);
    expect(titleOnly.plans[0]).toMatchObject({
      sku: "0123-AB",
      title: "Shorts anteriores",
      previousItemId: "111111111111",
      source: "vinted",
      outcome: "missing",
    });

    const withoutSku = planEbayRelinks({
      articles: [
        { id: "mismo", sku: "0123-AB", itemId: "111111111111", title: "Camisa" },
        { id: "otro", sku: "9999", itemId: "999999999999", title: "Camisa", source: "vinted" },
      ],
      active: [
        { itemId: "111111111111", sku: "" },
        { itemId: "777777777777", sku: "" },
      ],
      oldState: (itemId) => (itemId === "999999999999" ? "ended" : "active"),
      catalogComplete: true,
    });
    expect(withoutSku.unchanged).toBe(1);
    expect(withoutSku.missing).toBe(1);
    expect(withoutSku.updated).toBe(0);
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

  it("deja de consultar anuncios anteriores cuando se acaba el tiempo y no los cuenta como sin coincidencia", async () => {
    let calls = 0;
    const lookedUp = await resolveOldListingStates({
      itemIds: ["111", "222", "333"],
      budgetMs: 0,
      now: () => 1000,
      lookup: async () => {
        calls += 1;
        return "ended";
      },
    });
    expect(calls).toBe(0);
    expect(lookedUp.incomplete).toBe(true);
    expect(lookedUp.states.size).toBe(0);

    const finished = await resolveOldListingStates({
      itemIds: ["111", "222", "333"],
      budgetMs: 1000,
      now: () => 0,
      lookup: async () => "ended",
    });
    expect(finished.incomplete).toBe(false);
    expect([...finished.states.values()]).toEqual(["ended", "ended", "ended"]);
  });

  it("lee todas las páginas y un fallo de eBay no devuelve un inventario parcial", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      const page = body.includes("<PageNumber>2</PageNumber>") ? 2 : 1;
      return new Response(activePageXml(page), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAllActiveSellerListings("token");
    const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    expect(requestBody).toContain("<ActiveList>");
    expect(requestBody).toContain("<PageNumber>1</PageNumber>");
    expect(requestBody).not.toContain("ReturnAll");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.listings.map((listing) => listing.itemId)).toEqual(["111111111111", "222222222222"]);
      expect(result.listings.map((listing) => listing.sku)).toEqual(["0123-AB", "0456-CD"]);
      expect(result.activeCount ?? result.listings.length).toBe(result.listings.length);
    }

    vi.stubGlobal("fetch", vi.fn(async () => new Response("Failure", { status: 500 })));
    const failed = await fetchAllActiveSellerListings("token");
    expect(failed).toEqual({
      ok: false,
      error: "No se pudo leer el inventario activo de eBay. No se clasificó ningún vínculo ni se modificó ningún Item ID.",
    });
  });

  it("conserva en el catálogo un anuncio activo sin ListingStatus o sin SKU y no cuenta los vendidos", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      const page = body.includes("<PageNumber>2</PageNumber>") ? 2 : 1;
      return new Response(page === 1 ? activeWithoutStatusXml() : lastActiveXml(), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAllActiveSellerListings("token");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toBe(2);
    expect(result.received).toBe(3);
    expect(result.listings).toHaveLength(3);
    expect(result.listings.map((listing) => listing.itemId)).toEqual([
      "178559107770",
      "178559110556",
      "178517467282",
    ]);
    expect(result.withSku).toBe(2);
    expect(result.listings.filter((listing) => !listing.sku)).toHaveLength(1);
    expect(result.activeCount ?? result.listings.length).toBe(result.listings.length);
    expect(result.listings.some((listing) => listing.itemId === "999999999999")).toBe(false);
  });

  it("rechaza una respuesta cortada por eBay sin tratarla como inventario vacío", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(
        `<GetMyeBaySellingResponse><Ack>Warning</Ack><Errors><LongMessage>The result set was truncated.</LongMessage></Errors>${emptyActivePagesXml()}</GetMyeBaySellingResponse>`,
        { status: 200 }
      ))
    );
    const result = await fetchAllActiveSellerListings("token");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("cortó la respuesta");
    expect(result.error).toContain("No se clasificó ningún vínculo");
  });

  it("no clasifica vínculos cuando hay páginas y el catálogo activo queda vacío", async () => {
    const fetchMock = vi.fn(async () => new Response(emptyActivePagesXml(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAllActiveSellerListings("token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("13 páginas");
    expect(result.error).toContain("No se clasificó ningún vínculo");
    expect(readActiveList(emptyActivePagesXml()).received).toHaveLength(0);
    expect(readActiveList(emptyActivePagesXml()).pages).toBe(13);
  });

  it("lee el usuario de eBay sin devolver el token ni el correo", async () => {
    expect(ebaySellerUserId(`<User><UserID>tienda-prueba</UserID><Email>secreto@example.com</Email></User>`)).toBe(
      "tienda-prueba"
    );
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("X-EBAY-API-CALL-NAME")).toBe("GetUser");
      expect(headers.get("X-EBAY-API-IAF-TOKEN")).toBe("token-secreto");
      return new Response(
        `<GetUserResponse><Ack>Success</Ack><User><UserID>tienda-prueba</UserID><Email>secreto@example.com</Email></User></GetUserResponse>`,
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = await fetchEbaySellerUser("token-secreto");
    expect(user).toBe("tienda-prueba");
    expect(user).not.toContain("token-secreto");
    expect(user).not.toContain("secreto@example.com");
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

function activeWithoutStatusXml(): string {
  return `<?xml version="1.0"?>
<GetMyeBaySellingResponse>
  <Ack>Success</Ack>
  <SoldList>
    <PaginationResult>
      <TotalNumberOfPages>13</TotalNumberOfPages>
      <TotalNumberOfEntries>2400</TotalNumberOfEntries>
    </PaginationResult>
    <ItemArray>
      <Item><ItemID>999999999999</ItemID><Title>Vendido</Title><SKU>1602</SKU><ListingStatus>Completed</ListingStatus></Item>
    </ItemArray>
  </SoldList>
  <ActiveList>
    <PaginationResult>
      <TotalNumberOfPages>2</TotalNumberOfPages>
      <TotalNumberOfEntries>3</TotalNumberOfEntries>
    </PaginationResult>
    <ItemArray>
      <Item>
        <ItemID>178559107770</ItemID>
        <Title>Soffe Juniors L Navy Blue White Trim Dolphin Running Shorts Retro Athletic</Title>
        <SellingStatus><QuantitySold>0</QuantitySold></SellingStatus>
      </Item>
      <Item>
        <ItemID>178559110556</ItemID>
        <SKU>2856</SKU>
        <Title>Fabletics PowerHold High Waist Leggings Colorblock Gray Pink Mesh Approx S See</Title>
        <SellingStatus><CurrentPrice currencyID="USD">24.99</CurrentPrice><QuantitySold>0</QuantitySold></SellingStatus>
      </Item>
    </ItemArray>
  </ActiveList>
</GetMyeBaySellingResponse>`;
}

function lastActiveXml(): string {
  return `<?xml version="1.0"?>
<GetMyeBaySellingResponse>
  <Ack>Success</Ack>
  <ActiveList>
    <PaginationResult>
      <TotalNumberOfPages>2</TotalNumberOfPages>
      <TotalNumberOfEntries>3</TotalNumberOfEntries>
    </PaginationResult>
    <ItemArray>
      <Item>
        <ItemID>178517467282</ItemID>
        <SKU>1602</SKU>
        <Title>Le Lis Multicolor Paisley Tank</Title>
        <SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus>
      </Item>
    </ItemArray>
  </ActiveList>
</GetMyeBaySellingResponse>`;
}

function emptyActivePagesXml(): string {
  return `<?xml version="1.0"?>
<GetMyeBaySellingResponse>
  <Ack>Success</Ack>
  <ActiveList>
    <PaginationResult>
      <TotalNumberOfPages>13</TotalNumberOfPages>
      <TotalNumberOfEntries>2400</TotalNumberOfEntries>
    </PaginationResult>
    <ItemArray></ItemArray>
  </ActiveList>
</GetMyeBaySellingResponse>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});
