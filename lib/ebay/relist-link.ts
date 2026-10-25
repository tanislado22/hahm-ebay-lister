export interface StoredEbayArticle {
  id: string;
  sku: string;
  itemId: string;
  title?: string;
  source?: "platform" | "vinted";
}

export interface ActiveEbayListing {
  itemId: string;
  sku: string;
}

export type OldListingState = "active" | "ended" | "unknown";

export type RelinkOutcome = "updated" | "unchanged" | "missing" | "review" | "skipped";

export interface EbayRelinkPlan {
  id: string;
  sku: string;
  title: string;
  source: "platform" | "vinted" | "";
  previousItemId: string;
  nextItemId: string | null;
  outcome: RelinkOutcome;
}

export interface EbayRelinkSummary {
  updated: number;
  missing: number;
  review: number;
  unchanged: number;
  skipped: number;
  incomplete: boolean;
  plans: EbayRelinkPlan[];
}

export function exactEbaySku(value: string): string {
  return value.trim();
}

export function ebayItemIdText(value: string): string {
  return value.replace(/\D/g, "");
}

/** Old Item IDs that are not in the active catalog still need a status lookup. */
export async function resolveOldListingStates(input: {
  itemIds: readonly string[];
  lookup: (itemId: string) => Promise<OldListingState>;
  budgetMs: number;
  now?: () => number;
  concurrency?: number;
}): Promise<{ states: Map<string, OldListingState>; incomplete: boolean }> {
  const states = new Map<string, OldListingState>();
  const now = input.now ?? Date.now;
  const started = now();
  const unique = [...new Set(input.itemIds.filter(Boolean))];
  let cursor = 0;
  let incomplete = false;
  const workers = Array.from({ length: Math.max(1, input.concurrency ?? 4) }, async () => {
    while (cursor < unique.length) {
      if (now() - started >= input.budgetMs) {
        incomplete = true;
        return;
      }
      const itemId = unique[cursor];
      cursor += 1;
      if (!itemId || states.has(itemId)) continue;
      states.set(itemId, await input.lookup(itemId));
    }
  });
  await Promise.all(workers);
  if ([...states.keys()].length < unique.length) incomplete = true;
  return { states, incomplete };
}

export function planEbayRelinks(input: {
  articles: readonly StoredEbayArticle[];
  active: readonly ActiveEbayListing[];
  oldState: (itemId: string) => OldListingState;
  catalogComplete: boolean;
}): EbayRelinkSummary {
  if (!input.catalogComplete) {
    return {
      updated: 0,
      missing: 0,
      review: 0,
      unchanged: 0,
      skipped: input.articles.length,
      incomplete: true,
      plans: input.articles.map((article) => ({
        id: article.id,
        sku: exactEbaySku(article.sku),
        title: article.title?.trim() ?? "",
        source: article.source ?? "",
        previousItemId: ebayItemIdText(article.itemId),
        nextItemId: null,
        outcome: "skipped",
      })),
    };
  }

  const activeById = new Map<string, ActiveEbayListing>();
  for (const listing of input.active) {
    const itemId = ebayItemIdText(listing.itemId);
    if (!itemId) continue;
    activeById.set(itemId, { itemId, sku: exactEbaySku(listing.sku) });
  }
  const activeBySku = new Map<string, ActiveEbayListing[]>();
  for (const listing of activeById.values()) {
    if (!listing.sku) continue;
    const group = activeBySku.get(listing.sku) ?? [];
    group.push(listing);
    activeBySku.set(listing.sku, group);
  }

  const plans: EbayRelinkPlan[] = [];
  for (const article of input.articles) {
    const sku = exactEbaySku(article.sku);
    const title = article.title?.trim() ?? "";
    const source = article.source ?? "";
    const previousItemId = ebayItemIdText(article.itemId);
    const state = previousItemId ? input.oldState(previousItemId) : "unknown";
    if (state === "active") {
      plans.push({ id: article.id, sku, title, source, previousItemId, nextItemId: null, outcome: "unchanged" });
      continue;
    }
    if (state !== "ended") {
      plans.push({ id: article.id, sku, title, source, previousItemId, nextItemId: null, outcome: "skipped" });
      continue;
    }
    if (!sku) {
      plans.push({ id: article.id, sku, title, source, previousItemId, nextItemId: null, outcome: "review" });
      continue;
    }
    const matches = (activeBySku.get(sku) ?? []).filter((listing) => listing.itemId !== previousItemId);
    if (matches.length === 1) {
      plans.push({
        id: article.id,
        sku,
        title,
        source,
        previousItemId,
        nextItemId: matches[0].itemId,
        outcome: "updated",
      });
      continue;
    }
    plans.push({
      id: article.id,
      sku,
      title,
      source,
      previousItemId,
      nextItemId: null,
      outcome: matches.length === 0 ? "missing" : "review",
    });
  }

  return {
    updated: plans.filter((plan) => plan.outcome === "updated").length,
    missing: plans.filter((plan) => plan.outcome === "missing").length,
    review: plans.filter((plan) => plan.outcome === "review").length,
    unchanged: plans.filter((plan) => plan.outcome === "unchanged").length,
    skipped: plans.filter((plan) => plan.outcome === "skipped").length,
    incomplete: false,
    plans,
  };
}
