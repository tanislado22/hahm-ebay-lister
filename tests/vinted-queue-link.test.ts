import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  articleIdFromSearch,
  assignArticleIds,
  openQueueArticle,
  orderQueue,
  photosForArticle,
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

  it("un artículo ausente no se inserta en la cola", () => {
    const queue = assignArticleIds([ready("K75-A", "Coat")], [{ articleId: alpha, sku: "K75-A" }]);
    const opened = openQueueArticle(queue, "job-missing");
    expect(opened.found).toBe(false);
    expect(opened.queue).toEqual(queue);
    expect(opened.queue).toHaveLength(1);
  });
});
