import { describe, expect, test } from "vitest";
import {
  fillExistingWorkspaceJob,
  groupAfterManualSku,
  manualSkuSavedMessage,
  missingSkuForVinted,
  parseManualSku,
  partitionVintedPrepare,
  planManualSkuAssignment,
  skuFieldEditable,
  vintedPrepareBlock,
  vintedPrepareResultMessage,
  workspaceGroupVisible,
  workspaceItemHref,
} from "@/lib/archive/manual-sku";
import { planArchiveVintedPrepare, workspaceGroupAfterVintedPrepare } from "@/lib/archive/vinted-review";
import type { ItemGroup } from "@/lib/types";

const CALCULATOR = "Caliber Desktop Calculator 12 Digit LCD Display Dual Power Solar Battery V-30189";
const EBAY_ITEM = "880062095664";
const TYPED_SKU = "CALC-30189";

function publishedWithoutSku(): ItemGroup {
  return {
    id: "archive-job-1",
    sku: "",
    name: CALCULATOR,
    photoIds: ["photo-1"],
    status: "done",
    postStatus: "posted",
    listingId: EBAY_ITEM,
    vintedStatus: "not_prepared",
    listing: {
      title: CALCULATOR,
      description: "Desktop calculator",
      suggested_price: 12.99,
      currency: "USD",
    },
  };
}

describe("imported eBay listing without a SKU", () => {
  test("the posted listing can receive a typed SKU and keeps the eBay id", () => {
    const group = publishedWithoutSku();
    expect(skuFieldEditable(group.postStatus, group.sku)).toBe(true);
    expect(parseManualSku("")).toMatchObject({ ok: false });
    expect(parseManualSku(CALCULATOR).ok).toBe(false);

    const plan = planManualSkuAssignment({
      nextSku: ` ${TYPED_SKU} `,
      articleSku: "",
      articleId: "article-1",
      ebayItemId: EBAY_ITEM,
      jobSku: "",
      listingSkus: [],
    });
    expect(plan).toMatchObject({
      ok: true,
      sku: TYPED_SKU,
      articleId: "article-1",
      ebayItemId: EBAY_ITEM,
      ebayWrite: false,
      duplicate: false,
      updateListingIds: [],
    });
    if (!plan.ok) return;
    const saved = groupAfterManualSku(group, plan.sku);
    expect(saved.id).toBe(group.id);
    expect(saved.sku).toBe(TYPED_SKU);
    expect(saved.listingId).toBe(EBAY_ITEM);
    expect(saved.postStatus).toBe("posted");
    expect(saved.vintedStatus).toBe("not_prepared");
    expect(saved.vintedListingUrl).toBeUndefined();
    expect(saved.listing?.suggested_price).toBe(12.99);
    expect(skuFieldEditable(saved.postStatus, saved.sku)).toBe(false);
    expect(manualSkuSavedMessage({
      sku: plan.sku,
      ebayItemId: EBAY_ITEM,
      archive: true,
      workspace: true,
      inventory: false,
      queue: false,
    })).toContain("No se modificó el anuncio en eBay");

    const reloaded = planManualSkuAssignment({
      nextSku: saved.sku,
      articleSku: saved.sku,
      articleId: "article-1",
      ebayItemId: EBAY_ITEM,
      jobSku: saved.sku,
      listingSkus: [{ id: "listing-1", sku: "", ebayItemId: EBAY_ITEM }],
    });
    expect(reloaded).toMatchObject({
      ok: true,
      sku: TYPED_SKU,
      ebayItemId: EBAY_ITEM,
      ebayWrite: false,
      updateListingIds: ["listing-1"],
    });
  });

  test("prepare names the missing SKU and does not describe an eBay publish failure", () => {
    const group = publishedWithoutSku();
    const blocked = vintedPrepareBlock({ sku: group.sku, title: group.listing?.title || "" });
    expect(blocked).toEqual({ ok: false, error: missingSkuForVinted("es") });
    if (blocked.ok) return;
    expect(blocked.error).toContain("Guardar SKU");
    expect(blocked.error).not.toMatch(/eBay/i);
    expect(blocked.error).not.toContain("No se inventó");

    const untitled = vintedPrepareBlock({ sku: TYPED_SKU, title: "  " });
    expect(untitled.ok).toBe(false);
    if (!untitled.ok) expect(untitled.error).toContain("título");
  });

  test("after the SKU is saved, prepare keeps the listing posted and does not publish on Vinted", () => {
    const group = groupAfterManualSku(publishedWithoutSku(), TYPED_SKU);
    const ready = vintedPrepareBlock({ sku: group.sku, title: group.listing?.title || "" });
    expect(ready).toEqual({ ok: true, sku: TYPED_SKU });
    const prepared = workspaceGroupAfterVintedPrepare(group, TYPED_SKU, EBAY_ITEM);
    expect(prepared.id).toBe(group.id);
    expect(prepared.sku).toBe(TYPED_SKU);
    expect(prepared.listingId).toBe(EBAY_ITEM);
    expect(prepared.postStatus).toBe("posted");
    expect(prepared.vintedStatus).toBe("ready");
    expect(prepared.vintedListingUrl).toBeUndefined();
    const plan = planArchiveVintedPrepare({
      reviewUrl: "",
      reviewStored: "unverified",
      postStatus: prepared.postStatus || "",
      ebayItemId: EBAY_ITEM,
      jobId: prepared.id,
      sku: prepared.sku,
    });
    expect(plan.ebayWrite).toBe(false);
    expect(plan.marksLinked).toBe(false);
    expect(plan.review).toBe("unverified");
    expect(plan.postStatus).toBe("posted");
    expect(plan.listingId).toBe(EBAY_ITEM);
    expect(plan.jobId).toBe(group.id);
  });

  test("an item already in the workspace opens in place and is not duplicated", () => {
    const existing = publishedWithoutSku();
    const incoming = {
      ...publishedWithoutSku(),
      id: "another-id",
      sku: TYPED_SKU,
      photoIds: ["photo-from-archive"],
    };
    const filled = fillExistingWorkspaceJob(
      { group: { ...existing, photoIds: [] }, photos: [] },
      { group: incoming, photos: [{ id: "photo-from-archive" }] }
    );
    expect(filled.duplicate).toBe(false);
    expect(filled.changed).toBe(true);
    expect(filled.group.id).toBe(existing.id);
    expect(filled.group.listingId).toBe(EBAY_ITEM);
    expect(filled.group.postStatus).toBe("posted");
    expect(filled.group.sku).toBe(TYPED_SKU);
    expect(filled.group.photoIds).toEqual(["photo-from-archive"]);
    expect(workspaceItemHref(existing.id, "store", null)).toBe(`/?trabajo=${existing.id}`);

    const again = fillExistingWorkspaceJob(
      { group: filled.group, photos: filled.photos },
      { group: { ...incoming, id: "third-id", sku: "OTHER" }, photos: [{ id: "new" }] }
    );
    expect(again.duplicate).toBe(false);
    expect(again.changed).toBe(false);
    expect(again.group.id).toBe(existing.id);
    expect(again.group.sku).toBe(TYPED_SKU);
  });

  test("prepare all reports each missing field and still prepares the items that are ready", () => {
    const split = partitionVintedPrepare([
      {
        id: "calc",
        label: CALCULATOR,
        sku: "",
        title: CALCULATOR,
        vintedStatus: "not_prepared",
        hasListing: true,
      },
      {
        id: "ready-1",
        label: "Blue shirt",
        sku: "K75-B",
        title: "Blue shirt",
        vintedStatus: "not_prepared",
        hasListing: true,
      },
      {
        id: "done",
        label: "Already on Vinted",
        sku: "K75-C",
        title: "Already on Vinted",
        vintedStatus: "published",
        hasListing: true,
      },
    ]);
    expect(split.ready).toEqual([{ id: "ready-1", sku: "K75-B" }]);
    expect(split.blocked).toHaveLength(1);
    expect(split.blocked[0].error).toContain("Save SKU");
    expect(split.blocked[0].error).not.toMatch(/eBay/i);
    const message = vintedPrepareResultMessage(split.ready.length, split.blocked);
    expect(message).toContain("Prepared for Vinted");
    expect(message).toContain("not published on Vinted");
    expect(message).toContain(CALCULATOR);
    expect(message).toContain("Save SKU");
  });

  test("a published import with a listing stays visible even before photos are attached", () => {
    expect(workspaceGroupVisible({ photoIds: [], status: "done", listing: { title: CALCULATOR }, listingId: EBAY_ITEM, postStatus: "posted" })).toBe(true);
    expect(workspaceGroupVisible({ photoIds: [], status: "idle" })).toBe(false);
  });

  test("an existing SKU and a SKU owned by another listing are left unchanged", () => {
    expect(planManualSkuAssignment({
      nextSku: "NEW",
      articleSku: "OLD",
      articleId: "article-1",
      ebayItemId: EBAY_ITEM,
      jobSku: "",
      listingSkus: [],
    }).ok).toBe(false);
    expect(planManualSkuAssignment({
      nextSku: TYPED_SKU,
      articleSku: "",
      articleId: "article-1",
      ebayItemId: EBAY_ITEM,
      jobSku: "",
      listingSkus: [{ id: "other", sku: TYPED_SKU, ebayItemId: "111" }],
    }).ok).toBe(false);
  });
});
