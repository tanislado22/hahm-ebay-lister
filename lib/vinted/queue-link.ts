export function vintedQueueHref(articleId: string): string {
  return `/vinted?article=${encodeURIComponent(articleId.trim())}`;
}

export function articleIdFromSearch(search: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return (new URLSearchParams(query).get("article") || "").trim();
}

export interface QueueArticleJob {
  articleId: string;
  sku: string;
}

export function assignArticleIds<T extends { sku: string }>(
  listings: readonly T[],
  jobs: readonly QueueArticleJob[]
): Array<T & { articleIds: string[] }> {
  const idsBySku = new Map<string, string[]>();
  for (const job of jobs) {
    const sku = job.sku.trim();
    const articleId = job.articleId.trim();
    if (!sku || !articleId) continue;
    const ids = idsBySku.get(sku) ?? [];
    if (!ids.includes(articleId)) ids.push(articleId);
    idsBySku.set(sku, ids);
  }
  const seen = new Set<string>();
  const items: Array<T & { articleIds: string[] }> = [];
  for (const listing of listings) {
    const sku = listing.sku.trim();
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    items.push({ ...listing, sku, articleIds: idsBySku.get(sku) ?? [] });
  }
  return items;
}

export function orderQueue<T extends { sku: string; vintedStatus: string }>(
  items: readonly T[],
  currentSku: string
): T[] {
  return [...items].sort((left, right) => {
    if (currentSku && left.sku === currentSku) return -1;
    if (currentSku && right.sku === currentSku) return 1;
    if (left.vintedStatus === right.vintedStatus) return left.sku.localeCompare(right.sku);
    return left.vintedStatus === "ready" ? -1 : 1;
  });
}

export function queueIndexForArticle(items: readonly { articleIds: readonly string[] }[], articleId: string): number | null {
  const id = articleId.trim();
  if (!id) return null;
  const index = items.findIndex((item) => item.articleIds.includes(id));
  return index >= 0 ? index : null;
}

export function photosForArticle<T>(
  jobs: readonly { articleId: string; sku: string; photos: readonly T[] }[],
  sku: string,
  articleId: string
): T[] {
  const exact = jobs.find((job) => job.articleId === articleId);
  if (exact) return [...exact.photos];
  const matches = jobs.filter((job) => job.sku === sku);
  const last = matches[matches.length - 1];
  return last ? [...last.photos] : [];
}

export function openQueueArticle<T extends { sku: string; articleIds: string[] }>(
  queue: readonly T[],
  articleId: string
): { queue: T[]; index: number; found: boolean } {
  const index = queueIndexForArticle(queue, articleId);
  return { queue: [...queue], index: index ?? 0, found: index != null };
}

export function saveQueueListingUrl<
  T extends { articleIds: readonly string[]; vintedStatus: string; vintedListingUrl: string | null }
>(items: readonly T[], articleId: string, url: string): { items: T[]; index: number | null } {
  const index = queueIndexForArticle(items, articleId);
  if (index == null) return { items: [...items], index: null };
  const trimmed = url.trim();
  const next = items.map((item, itemIndex) =>
    itemIndex === index
      ? {
          ...item,
          vintedStatus: "published",
          vintedListingUrl: trimmed || item.vintedListingUrl,
        }
      : item
  );
  return { items: next, index };
}
