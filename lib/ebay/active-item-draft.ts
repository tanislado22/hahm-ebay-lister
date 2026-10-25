import { EBAY_TRADING } from "@/lib/ebay/config";

export interface ActiveItemDraft {
  itemId: string;
  sku: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  photoUrls: string[];
  brand: string;
  size: string;
  color: string;
  condition: string;
  category: string;
  active: boolean;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return match?.[1] ? decodeXml(match[1]) : "";
}

export function textFromEbayDescription(value: string): string {
  const withoutHidden = value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withBreaks = withoutHidden
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeXml(withBreaks)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function specificValue(block: string, names: string[]): string {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const pattern = /<NameValueList>([\s\S]*?)<\/NameValueList>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block))) {
    const name = tag(match[1], "Name").toLowerCase();
    if (!wanted.has(name)) continue;
    const value = tag(match[1], "Value");
    if (value) return value;
  }
  return "";
}

function pictureUrls(item: string): string[] {
  const details = item.match(/<PictureDetails\b[^>]*>([\s\S]*?)<\/PictureDetails>/i)?.[1] || "";
  const source = details || item;
  const urls: string[] = [];
  const pattern = /<PictureURL>([\s\S]*?)<\/PictureURL>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const url = decodeXml(match[1]);
    if (url.startsWith("https://") && !urls.includes(url)) urls.push(url);
  }
  if (urls.length) return urls;
  const gallery = tag(item, "GalleryURL");
  return gallery.startsWith("https://") ? [gallery] : [];
}

export function parseActiveItemDraft(xml: string): ActiveItemDraft | null {
  const item = xml.match(/<Item\b[^>]*>([\s\S]*?)<\/Item>/i)?.[1];
  if (!item) return null;
  const itemId = tag(item, "ItemID").replace(/\D/g, "");
  if (!itemId) return null;
  const priceTag =
    item.match(/<CurrentPrice\b([^>]*)>([\s\S]*?)<\/CurrentPrice>/i) ||
    item.match(/<StartPrice\b([^>]*)>([\s\S]*?)<\/StartPrice>/i);
  const currency = priceTag?.[1]?.match(/currencyID="([^"]+)"/i)?.[1] || "USD";
  const status = tag(item, "ListingStatus").toLowerCase();
  const categoryBlock = item.match(/<PrimaryCategory\b[^>]*>([\s\S]*?)<\/PrimaryCategory>/i)?.[1] || "";
  return {
    itemId,
    sku: tag(item, "SKU").trim(),
    title: tag(item, "Title").trim(),
    description: textFromEbayDescription(tag(item, "Description")),
    price: priceTag?.[2] ? decodeXml(priceTag[2]).trim() : "",
    currency,
    photoUrls: pictureUrls(item),
    brand: specificValue(item, ["Brand"]),
    size: specificValue(item, ["Size"]),
    color: specificValue(item, ["Color", "Colour"]),
    condition: tag(item, "ConditionDisplayName") || tag(item, "ConditionDescription"),
    category: categoryBlock ? tag(categoryBlock, "CategoryName") || categoryBlock : "",
    active: status === "active",
  };
}

async function tradingCall(accessToken: string, body: string): Promise<string> {
  const response = await fetch(EBAY_TRADING, {
    method: "POST",
    headers: {
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetItem",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1423",
    },
    body,
  });
  const text = await response.text();
  if (!response.ok || !/<Ack>(Success|Warning)<\/Ack>/i.test(text)) {
    throw new Error(`eBay GetItem failed (${response.status})`);
  }
  return text;
}

export async function fetchActiveItemDraft(accessToken: string, itemId: string): Promise<ActiveItemDraft | null> {
  const clean = itemId.replace(/[^\d]/g, "");
  if (!clean) return null;
  const xml = await tradingCall(
    accessToken,
    `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${clean}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
</GetItemRequest>`
  );
  return parseActiveItemDraft(xml);
}
