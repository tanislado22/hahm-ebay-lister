import type { EbayVariant } from "@/lib/archive/parse-item";
import { exactSku } from "@/lib/archive/text";
import { listingUrlForPlatform } from "@/lib/telegram/sale-links";

export interface LocalRecord {
  id: string;
  source: "platform" | "job";
  sku: string;
  ebayItemId: string;
  vintedListingUrl: string;
  vintedListingId: string;
  vintedTitle: string;
  vintedStatus: string;
}

export interface ArticleCore {
  sku: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  ebayUrl: string;
  listingStatus: string;
  quantitySold: number | null;
  variants: EbayVariant[];
  vintedListingUrl: string;
  vintedListingId: string;
  vintedTitle: string;
  vintedStatus: string;
}

export interface LinkPlan {
  archiveId: string | null;
  vintedFrom: LocalRecord | null;
  linkPlatformId: string | null;
  sourceJobId: string | null;
  note: string;
}

function sameItem(left: string, right: string): boolean {
  return left.trim() !== "" && left.trim() === right.trim();
}

function pickOne(records: LocalRecord[]): LocalRecord | "many" | null {
  if (records.length === 1) return records[0];
  if (records.length > 1) return "many";
  return null;
}

function vintedChoice(records: LocalRecord[]): { record: LocalRecord | null; note: string } {
  const withLink = records.filter(
    (record) => record.vintedListingUrl.trim() || record.vintedListingId.trim() || record.vintedStatus.trim()
  );
  if (withLink.length === 0) return { record: records.length === 1 ? records[0] : null, note: "" };
  const urls = new Set(withLink.map((record) => record.vintedListingUrl.trim()).filter(Boolean));
  if (urls.size > 1) {
    return {
      record: null,
      note: "Hay vínculos de Vinted distintos en los registros locales. No se eligió ninguno.",
    };
  }
  return { record: withLink[0], note: "" };
}

export function planImportLink(input: {
  ebayItemId: string;
  ebaySku: string;
  existingArchiveId: string | null;
  locals: LocalRecord[];
}): LinkPlan {
  const itemId = input.ebayItemId.trim();
  const sku = exactSku(input.ebaySku);
  const byItem = input.locals.filter((record) => sameItem(record.ebayItemId, itemId));
  const bySku =
    sku === ""
      ? []
      : input.locals.filter(
          (record) =>
            record.sku === sku && (record.ebayItemId.trim() === "" || sameItem(record.ebayItemId, itemId))
        );
  const pool = byItem.length ? byItem : bySku;
  const manySku = byItem.length === 0 && bySku.length > 1;
  const chosen = manySku ? null : pickOne(pool);
  const records = chosen && chosen !== "many" ? [chosen] : manySku ? [] : pool;
  const vinted = chosen === "many" || manySku ? { record: null, note: "" } : vintedChoice(records);
  const platform = (manySku ? null : pickOne(pool.filter((record) => record.source === "platform")));
  const job = (manySku ? null : pickOne(pool.filter((record) => record.source === "job")));
  const notes = [
    manySku
      ? `El SKU ${sku} está en más de un registro local sin Item ID. No se unieron.`
      : "",
    chosen === "many" ? "Hay varios registros locales con el mismo Item ID. No se unieron los vínculos." : "",
    vinted.note,
  ].filter(Boolean);
  return {
    archiveId: input.existingArchiveId,
    vintedFrom: vinted.record,
    linkPlatformId: platform && platform !== "many" ? platform.id : null,
    sourceJobId: job && job !== "many" ? job.id : null,
    note: notes.join(" "),
  };
}

export function mergeArticleCore(
  existing: ArticleCore | null,
  incoming: ArticleCore,
  vintedFrom: LocalRecord | null
): ArticleCore {
  const prior = existing;
  return {
    sku: incoming.sku !== "" ? incoming.sku : prior?.sku || "",
    title: incoming.title || prior?.title || "",
    description: incoming.description || prior?.description || "",
    price: incoming.price || prior?.price || "",
    currency: incoming.currency || prior?.currency || "",
    ebayUrl: incoming.ebayUrl || prior?.ebayUrl || "",
    listingStatus: incoming.listingStatus || prior?.listingStatus || "",
    quantitySold: incoming.quantitySold != null ? incoming.quantitySold : prior?.quantitySold ?? null,
    variants: incoming.variants.length ? incoming.variants : prior?.variants || [],
    vintedListingUrl: prior?.vintedListingUrl || vintedFrom?.vintedListingUrl || "",
    vintedListingId: prior?.vintedListingId || vintedFrom?.vintedListingId || "",
    vintedTitle: prior?.vintedTitle || vintedFrom?.vintedTitle || "",
    vintedStatus: prior?.vintedStatus || vintedFrom?.vintedStatus || "",
  };
}

export interface SaleCandidate {
  id: string;
  sku: string;
  ebayItemId: string;
}

export function chooseSaleRecord(
  sku: string,
  ebayItemId: string,
  rows: SaleCandidate[]
): { kind: "none" } | { kind: "ambiguous" } | { kind: "one"; id: string } {
  const itemId = ebayItemId.trim();
  const exact = exactSku(sku);
  if (itemId) {
    const byId = rows.filter((row) => row.ebayItemId.trim() === itemId);
    if (byId.length === 1) return { kind: "one", id: byId[0].id };
    if (byId.length > 1) return { kind: "ambiguous" };
  }
  if (!exact) return { kind: "none" };
  const bySku = rows.filter(
    (row) => row.sku === exact && (row.ebayItemId.trim() === "" || !itemId || row.ebayItemId.trim() === itemId)
  );
  if (bySku.length === 1) return { kind: "one", id: bySku[0].id };
  if (bySku.length > 1) return { kind: "ambiguous" };
  return { kind: "none" };
}

export function existingVintedLink(input: {
  rows: LocalRecord[];
  ebayItemId: string;
  sku: string;
  groupUrl: string;
  groupStatus: string;
}): { url: string; id: string; title: string; status: string } {
  const itemId = input.ebayItemId.trim();
  const sku = exactSku(input.sku);
  const byItem = itemId ? input.rows.filter((row) => row.ebayItemId.trim() === itemId) : [];
  const pool = byItem.length ? byItem : input.rows.filter((row) => sku !== "" && row.sku === sku);
  if (pool.length === 1) {
    const row = pool[0];
    const url = row.vintedListingUrl.trim() || listingUrlForPlatform("vinted", input.groupUrl) || "";
    return {
      url,
      id: row.vintedListingId.trim(),
      title: row.vintedTitle.trim(),
      status: row.vintedStatus.trim() || (url ? input.groupStatus.trim() : ""),
    };
  }
  const urls = [...new Set(pool.map((row) => row.vintedListingUrl.trim()).filter(Boolean))];
  if (urls.length === 1) return { url: urls[0], id: "", title: "", status: input.groupStatus.trim() };
  if (pool.length === 0) {
    const url = listingUrlForPlatform("vinted", input.groupUrl) || "";
    return { url, id: "", title: "", status: url ? input.groupStatus.trim() : "" };
  }
  return { url: "", id: "", title: "", status: "" };
}

export function canArchivePublished(postStatus: string | null | undefined): boolean {
  return postStatus === "posted";
}

export function removalAfterSave(saved: boolean): "keep" | "remove" {
  return saved ? "remove" : "keep";
}

export const WORKSPACE_DELETE_REMOVES_ARCHIVE = false;

export const READ_ONLY_TRADING_CALLS = ["GetMyeBaySelling", "GetItem", "GetUser"] as const;

export function isReadOnlyTradingCall(callName: string): boolean {
  return (READ_ONLY_TRADING_CALLS as readonly string[]).includes(callName);
}
