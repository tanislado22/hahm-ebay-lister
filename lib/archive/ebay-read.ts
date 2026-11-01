import { EBAY_TRADING } from "@/lib/ebay/config";
import { parseActiveListPage, parseEbayItemXml, type ActiveListPage, type EbayItemDetail } from "@/lib/archive/parse-item";
import { isReadOnlyTradingCall } from "@/lib/archive/link";
import { classifyTradingProblem } from "@/lib/archive/trading-error";

const COMPATIBILITY_LEVEL = "1423";
const SITE_ID = "0";
const PAGE_SIZE = 200;

export type TradingRead =
  | { ok: true; xml: string }
  | {
      ok: false;
      status: number;
      xml: string;
      retryable: boolean;
      config: boolean;
      message: string;
      missing: string[];
    };

async function readOnlyTradingCall(accessToken: string, callName: string, body: string): Promise<TradingRead> {
  if (!isReadOnlyTradingCall(callName)) {
    return {
      ok: false,
      status: 0,
      xml: "",
      retryable: false,
      config: false,
      message: "La importación solo puede leer anuncios.",
      missing: [],
    };
  }
  let response: Response;
  try {
    response = await fetch(EBAY_TRADING, {
      method: "POST",
      headers: {
        "X-EBAY-API-IAF-TOKEN": accessToken,
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": callName,
        "X-EBAY-API-SITEID": SITE_ID,
        "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
      },
      body,
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      status: 0,
      xml: "",
      retryable: true,
      config: false,
      message: timedOut
        ? "eBay tardó demasiado. Se puede continuar la misma importación."
        : "No hubo respuesta de eBay. Se puede continuar la misma importación.",
      missing: [],
    };
  }
  const xml = await response.text();
  if (!response.ok || !/<Ack>(Success|Warning)<\/Ack>/i.test(xml)) {
    const problem = classifyTradingProblem(response.status, xml);
    return { ok: false, status: response.status, xml, ...problem };
  }
  return { ok: true, xml };
}

export async function readEbayUserId(accessToken: string): Promise<TradingRead & { userId?: string }> {
  const result = await readOnlyTradingCall(
    accessToken,
    "GetUser",
    `<?xml version="1.0" encoding="utf-8"?>
<GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents"></GetUserRequest>`
  );
  if (!result.ok) return result;
  const userId = result.xml.match(/<UserID>([\s\S]*?)<\/UserID>/i)?.[1]?.trim() ?? "";
  return { ...result, userId };
}

export async function readActiveListPage(accessToken: string, page: number): Promise<TradingRead & { page?: ActiveListPage }> {
  const result = await readOnlyTradingCall(
    accessToken,
    "GetMyeBaySelling",
    `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>${PAGE_SIZE}</EntriesPerPage>
      <PageNumber>${page}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`
  );
  if (!result.ok) return result;
  return { ...result, page: parseActiveListPage(result.xml) };
}

export async function readEbayItem(accessToken: string, itemId: string): Promise<TradingRead & { item?: EbayItemDetail | null }> {
  const clean = itemId.replace(/[^\d]/g, "");
  const result = await readOnlyTradingCall(
    accessToken,
    "GetItem",
    `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${clean}</ItemID>
  <IncludeItemSpecifics>false</IncludeItemSpecifics>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemRequest>`
  );
  if (!result.ok) return result;
  return { ...result, item: parseEbayItemXml(result.xml) };
}
