import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  articleIdFromSearch,
  assignArticleIds,
  openQueueArticle,
  orderQueue,
  photosForArticle,
  saveQueueListingUrl,
  vintedQueueHref,
} from "@/lib/vinted/queue-link";

const alpha = "job-alpha";
const beta = "job-beta";

function ready(sku: string, title: string) {
  return { sku, title, vintedStatus: "ready" as const };
}

describe("Open Vinted queue abre el artículo en otra pestaña", () => {
  it("usa el identificador del artículo y no navega la lista actual", () => {
    expect(vintedQueueHref(beta)).toBe("/vinted?article=job-beta");
    expect(articleIdFromSearch("?article=job-beta")).toBe(beta);
    expect(vintedQueueHref(" job-beta ")).toBe("/vinted?article=job-beta");

    const card = readFileSync("app/ListingCard.tsx", "utf8");
    const button = card.slice(card.indexOf("Open Vinted queue") - 240, card.indexOf("Open Vinted queue"));
    expect(button).toContain("vintedQueueHref(group.id)");
    expect(button).toContain('target="_blank"');
    expect(button).not.toContain('href="/vinted"');
  });

  it("después de preparar, abre esa ficha y no agrega otra copia", () => {
    const listings = [ready("K75-A", "Coat"), ready("K75-A", "Coat copy"), ready("K75-B", "Jacket")];
    const jobs = [
      { articleId: alpha, sku: "K75-A" },
      { articleId: alpha, sku: "K75-A" },
      { articleId: beta, sku: "K75-B" },
    ];
    const queue = orderQueue(assignArticleIds(listings, jobs), "K75-A");
    expect(queue.map((item) => item.sku)).toEqual(["K75-A", "K75-B"]);
    expect(queue[0]?.articleIds).toEqual([alpha]);
    expect(queue).toHaveLength(2);

    const opened = openQueueArticle(queue, beta);
    expect(opened.found).toBe(true);
    expect(opened.queue).toHaveLength(queue.length);
    expect(opened.queue[opened.index]?.sku).toBe("K75-B");
    expect(opened.queue[opened.index]?.articleIds).toEqual([beta]);

    const again = openQueueArticle(opened.queue, beta);
    expect(again.queue).toHaveLength(2);
    expect(again.index).toBe(opened.index);

    const photos = photosForArticle(
      [
        { articleId: alpha, sku: "K75-A", photos: ["coat"] },
        { articleId: beta, sku: "K75-B", photos: ["jacket"] },
      ],
      "K75-B",
      beta
    );
    expect(photos).toEqual(["jacket"]);
  });

  it("guardar la URL se queda en la ficha por su id aunque la cola cambie de orden", () => {
    const nike = "job-nike";
    const coat = "job-coat";
    const jacket = "job-jacket";
    const listings = [
      { sku: "NIKE-1", title: "Nike Pro", description: "Running tights", vintedStatus: "ready", vintedListingUrl: null as string | null },
      { sku: "COAT-1", title: "Wool Coat", description: "Heavy wool", vintedStatus: "ready", vintedListingUrl: null as string | null },
      { sku: "JACK-1", title: "Field Jacket", description: "Canvas shell", vintedStatus: "ready", vintedListingUrl: null as string | null },
    ];
    const jobs = [
      { articleId: nike, sku: "NIKE-1", photos: ["nike-front"] },
      { articleId: coat, sku: "COAT-1", photos: ["coat-front", "coat-back"] },
      { articleId: jacket, sku: "JACK-1", photos: ["jacket-front"] },
    ];
    const queue = orderQueue(assignArticleIds(listings, jobs), "NIKE-1").map((listing) => ({
      ...listing,
      photos: photosForArticle(jobs, listing.sku, listing.articleIds.includes(coat) ? coat : ""),
    }));
    const opened = openQueueArticle(queue, coat);
    const working = opened.queue[opened.index];
    expect(working?.sku).toBe("COAT-1");
    expect(working?.title).toBe("Wool Coat");
    expect(working?.photos).toEqual(["coat-front", "coat-back"]);
    expect(opened.queue[0]?.sku).toBe("NIKE-1");

    const saved = saveQueueListingUrl(opened.queue, coat, " https://www.vinted.com/items/555 ");
    expect(saved.index).toBe(opened.index);
    const stayed = saved.items[saved.index ?? -1];
    expect(stayed?.articleIds).toEqual([coat]);
    expect(stayed?.sku).toBe("COAT-1");
    expect(stayed?.title).toBe("Wool Coat");
    expect(stayed?.description).toBe("Heavy wool");
    expect(stayed?.photos).toEqual(["coat-front", "coat-back"]);
    expect(stayed?.vintedStatus).toBe("published");
    expect(stayed?.vintedListingUrl).toBe("https://www.vinted.com/items/555");
    expect(saved.items.find((item) => item.articleIds.includes(nike))?.vintedListingUrl).toBeNull();
    expect(saved.items.find((item) => item.articleIds.includes(nike))?.vintedStatus).toBe("ready");

    const reordered = orderQueue(saved.items, "NIKE-1");
    expect(reordered[opened.index]?.sku).not.toBe("COAT-1");
    const still = openQueueArticle(reordered, coat);
    expect(still.found).toBe(true);
    expect(still.index).not.toBe(opened.index);
    expect(still.queue[still.index]?.sku).toBe("COAT-1");
    expect(still.queue[still.index]?.title).toBe("Wool Coat");
    expect(still.queue[still.index]?.vintedListingUrl).toBe("https://www.vinted.com/items/555");

    const reloadedListings = saved.items.map((item) => ({
      sku: item.sku,
      title: item.title,
      description: item.description,
      vintedStatus: item.vintedStatus,
      vintedListingUrl: item.vintedListingUrl,
    }));
    const reloaded = orderQueue(assignArticleIds(reloadedListings, jobs), "NIKE-1").map((listing) => ({
      ...listing,
      photos: photosForArticle(jobs, listing.sku, listing.articleIds.includes(coat) ? coat : ""),
    }));
    const again = openQueueArticle(reloaded, coat);
    expect(again.queue[0]?.title).toBe("Nike Pro");
    expect(again.queue[again.index]?.sku).toBe("COAT-1");
    expect(again.queue[again.index]?.title).toBe("Wool Coat");
    expect(again.queue[again.index]?.description).toBe("Heavy wool");
    expect(again.queue[again.index]?.photos).toEqual(["coat-front", "coat-back"]);
    expect(again.queue[again.index]?.vintedListingUrl).toBe("https://www.vinted.com/items/555");
    expect(again.queue[again.index]?.vintedStatus).toBe("published");

    const queueUi = readFileSync("app/VintedQueue.tsx", "utf8");
    expect(queueUi).toContain("saveQueueListingUrl(items, articleId, url.trim())");
    expect(queueUi).toContain("Open saved listing");
    expect(queueUi).not.toContain("nextReady");
  });

  it("un artículo ausente no se inserta en la cola", () => {
    const queue = assignArticleIds([ready("K75-A", "Coat")], [{ articleId: alpha, sku: "K75-A" }]);
    const opened = openQueueArticle(queue, "job-missing");
    expect(opened.found).toBe(false);
    expect(opened.queue).toEqual(queue);
    expect(opened.queue).toHaveLength(1);
  });
});
