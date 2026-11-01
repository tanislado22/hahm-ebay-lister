import { ebayItemUrl } from "@/lib/vinted/card-text";
import { decodeXml, ebayItemIdText, ebayThumbUrl, exactSku, safeEbayImageUrl } from "@/lib/archive/text";

export interface EbayVariant {
  sku: string;
  price: string;
  currency: string;
  quantity: string;
  specifics: { name: string; value: string }[];
}

export interface EbayItemDetail {
  itemId: string;
  sku: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  ebayUrl: string;
  listingStatus: string;
  quantitySold: number | null;
  galleryUrl: string;
  pictureUrls: string[];
  variants: EbayVariant[];
}

export interface ActiveListSummary {
  itemId: string;
  sku: string;
  title: string;
  listingStatus: string;
  price: string;
  currency: string;
  galleryUrl: string;
}

export interface ActiveListPage {
  page: number | null;
  pages: number | null;
  entries: number | null;
  items: ActiveListSummary[];
  truncated: boolean;
}

const DESCRIPTION_CAP = 500_000;

function tagBlock(block: string, name: string): { value: string; rest: string } {
  const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!match || match.index == null) return { value: "", rest: block };
  const rest = block.slice(0, match.index) + block.slice(match.index + match[0].length);
  return { value: decodeXml(match[1]), rest };
}

function rawTag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match?.[1] ? decodeXml(match[1]) : "";
}

function priceFrom(block: string): { price: string; currency: string } {
  const match = block.match(/<(CurrentPrice|StartPrice)\b([^>]*)>([\s\S]*?)<\/\1>/i);
  if (!match) return { price: "", currency: "" };
  const currency = match[2].match(/currencyID="([^"]+)"/i)?.[1]?.trim() || "";
  return { price: decodeXml(match[3]), currency };
}

function pictureUrls(block: string): string[] {
  const urls: string[] = [];
  const pattern = /<PictureURL\b[^>]*>([\s\S]*?)<\/PictureURL>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block))) {
    const url = safeEbayImageUrl(decodeXml(match[1]));
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

function variantsFrom(block: string): EbayVariant[] {
  const variants: EbayVariant[] = [];
  const pattern = /<Variation\b[^>]*>([\s\S]*?)<\/Variation>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block))) {
    const body = match[1];
    const specifics: { name: string; value: string }[] = [];
    const lists = /<NameValueList\b[^>]*>([\s\S]*?)<\/NameValueList>/gi;
    let list: RegExpExecArray | null;
    while ((list = lists.exec(body))) {
      const name = rawTag(list[1], "Name");
      const value = rawTag(list[1], "Value");
      if (name && value) specifics.push({ name, value });
    }
    const price = priceFrom(body);
    variants.push({
      sku: exactSku(rawTag(body, "SKU")),
      price: price.price,
      currency: price.currency,
      quantity: rawTag(body, "Quantity"),
      specifics,
    });
  }
  return variants;
}

function quantitySold(block: string): number | null {
  const raw = rawTag(block, "QuantitySold");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

export function parseEbayItemXml(xml: string): EbayItemDetail | null {
  const start = xml.search(/<Item[\s>]/i);
  const end = xml.toLowerCase().lastIndexOf("</item>");
  if (start < 0 || end < start) return null;
  const item = xml.slice(start, end + "</item>".length);
  const description = tagBlock(item, "Description");
  const variations = tagBlock(description.rest, "Variations");
  const pictures = tagBlock(variations.rest, "Pictures");
  const variationPictures = tagBlock(pictures.rest, "VariationSpecificPictureSet");
  const body = variationPictures.rest;
  const itemId = ebayItemIdText(rawTag(body, "ItemID") || rawTag(item, "ItemID"));
  if (!itemId) return null;
  const price = priceFrom(body);
  const urls = [
    ...pictureUrls(pictures.value ? `<Pictures>${pictures.value}</Pictures>` : body),
    ...pictureUrls(variationPictures.value),
    ...pictureUrls(variations.value),
  ].filter((url, index, all) => all.indexOf(url) === index);
  const gallery = safeEbayImageUrl(rawTag(body, "GalleryURL"));
  const viewUrl = rawTag(body, "ViewItemURL");
  const descriptionText = description.value.length > DESCRIPTION_CAP
    ? `${description.value.slice(0, DESCRIPTION_CAP)}\n\n[eBay envió una descripción más larga de la que se guardó.]`
    : description.value;
  return {
    itemId,
    sku: exactSku(rawTag(body, "SKU")),
    title: rawTag(body, "Title"),
    description: descriptionText,
    price: price.price,
    currency: price.currency,
    ebayUrl: viewUrl.startsWith("https://") ? viewUrl : ebayItemUrl(itemId) || "",
    listingStatus: rawTag(body, "ListingStatus"),
    quantitySold: quantitySold(body),
    galleryUrl: gallery || (urls[0] ? ebayThumbUrl(urls[0]) : ""),
    pictureUrls: urls.length ? urls : gallery ? [gallery] : [],
    variants: variantsFrom(variations.value),
  };
}

export function parseActiveListPage(xml: string): ActiveListPage {
  const section = xml.match(/<ActiveList\b[^>]*>([\s\S]*?)<\/ActiveList>/i)?.[1] ?? "";
  const pages = Number(section.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/i)?.[1] ?? "");
  const entries = Number(section.match(/<TotalNumberOfEntries>(\d+)<\/TotalNumberOfEntries>/i)?.[1] ?? "");
  const page = Number(section.match(/<PageNumber>(\d+)<\/PageNumber>/i)?.[1] ?? "");
  const items: ActiveListSummary[] = [];
  const pattern = /<Item\b[^>]*>([\s\S]*?)<\/Item>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(section))) {
    const block = match[1];
    const itemId = ebayItemIdText(rawTag(block, "ItemID"));
    if (!itemId) continue;
    const listingStatus = rawTag(block, "ListingStatus");
    const normalized = listingStatus.toLowerCase();
    if (normalized === "completed" || normalized === "ended") continue;
    const price = priceFrom(block);
    items.push({
      itemId,
      sku: exactSku(rawTag(block, "SKU")),
      title: rawTag(block, "Title"),
      listingStatus,
      price: price.price,
      currency: price.currency,
      galleryUrl: safeEbayImageUrl(rawTag(block, "GalleryURL") || rawTag(block, "PictureURL")),
    });
  }
  return {
    page: Number.isFinite(page) && page > 0 ? page : null,
    pages: Number.isFinite(pages) && pages > 0 ? pages : null,
    entries: Number.isFinite(entries) && entries >= 0 ? entries : null,
    items,
    truncated: /<Ack>Warning<\/Ack>/i.test(xml) && /truncat/i.test(xml),
  };
}
