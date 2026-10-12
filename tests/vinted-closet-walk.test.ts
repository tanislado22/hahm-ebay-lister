import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const walk = require("../extension-v2/closet-walk.js") as {
  VINTED_SYNC_LIMIT: number;
  emptyProgress: () => { order: string[]; committed: string[] };
  mergeClosetOrder: (stored: string[], visible: string[]) => string[];
  nextBatchItems: (
    order: string[],
    committed: string[],
    payloads: Record<string, { vintedItemId: string }>,
    limit: number
  ) => { batch: { vintedItemId: string }[]; blocked: boolean };
  commitSynced: (progress: { order: string[]; committed: string[] }, ids: string[]) => { order: string[]; committed: string[] };
  summarizeKnownIds: (existingIds: string[], batchIds: string[]) => { received: number; inserted: number; existing: number };
};

function payloads(ids: string[]) {
  return Object.fromEntries(ids.map((id) => [id, { vintedItemId: id }]));
}

describe("vinted closet walk", () => {
  test("takes the first 30 and continues with the next 30", () => {
    const ids = Array.from({ length: 70 }, (_, index) => String(index + 1));
    let progress = { order: walk.mergeClosetOrder([], ids), committed: [] as string[] };
    const first = walk.nextBatchItems(progress.order, progress.committed, payloads(ids), walk.VINTED_SYNC_LIMIT);
    expect(first.batch).toHaveLength(30);
    expect(first.batch[0].vintedItemId).toBe("1");
    expect(first.batch[29].vintedItemId).toBe("30");
    progress = walk.commitSynced(progress, first.batch.map((item) => item.vintedItemId));
    const second = walk.nextBatchItems(progress.order, progress.committed, payloads(ids), walk.VINTED_SYNC_LIMIT);
    expect(second.batch.map((item) => item.vintedItemId)).toEqual(ids.slice(30, 60));
  });

  test("does not duplicate ids already stored and does not skip one that appears while loading", () => {
    const stored = ["1", "2", "3"];
    const order = walk.mergeClosetOrder(stored, ["2", "9", "3", "4"]);
    expect(order).toEqual(["1", "2", "9", "3", "4"]);
    const progress = walk.commitSynced({ order, committed: [] }, ["1", "2", "3"]);
    const next = walk.nextBatchItems(progress.order, progress.committed, payloads(order), 30);
    expect(next.batch.map((item) => item.vintedItemId)).toEqual(["9", "4"]);
  });

  test("a failed batch stays uncommitted and a reset clears only the walk", () => {
    const progress = { order: ["1", "2"], committed: [] as string[] };
    const retry = walk.nextBatchItems(progress.order, progress.committed, payloads(["1", "2"]), 30);
    expect(retry.batch.map((item) => item.vintedItemId)).toEqual(["1", "2"]);
    expect(walk.emptyProgress()).toEqual({ order: [], committed: [] });
    expect(walk.summarizeKnownIds(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], Array.from({ length: 30 }, (_, index) => String(index + 1)))).toEqual({
      received: 30,
      inserted: 20,
      existing: 10,
    });
  });
});
