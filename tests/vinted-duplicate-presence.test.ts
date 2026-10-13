import { describe, expect, test } from "vitest";
import { duplicateGroupsWithoutArchived } from "@/lib/vinted/inventory-archive";
import { findPossibleDuplicates } from "@/lib/vinted/inventory-review";
import {
  applyPresenceResult,
  canonicalVintedId,
  classifyVintedPage,
  dropRemovedRecord,
  markListingRemoved,
  planInventoryImport,
  type PresenceListing,
} from "@/lib/vinted/duplicate-presence";

const photo = "https://images.vinted.net/closet/coat.jpg";

function listing(id: string, sku: string, title: string, url = `https://www.vinted.com/items/${id}`) {
  return { vintedItemId: id, sku, title, photoUrl: photo, url };
}

function presenceRow(id: string, sku: string, ebayItemId = ""): PresenceListing {
  return { vintedItemId: id, sku, ebayItemId, archivedAt: null, presence: "" };
}

describe("vinted duplicate identity", () => {
  test("treats two stored rows with the same Vinted ID as one publication", () => {
    expect(canonicalVintedId("178425031509-blue-jeans", "")).toBe("178425031509");
    expect(canonicalVintedId("other", "https://www.vinted.es/items/178425031509-blue-jeans?ref=closet")).toBe("178425031509");
    const groups = findPossibleDuplicates(
      [
        listing("178425031509-blue-jeans", "ST-245", "Blue coat", "https://www.vinted.com/items/178425031509-blue-jeans"),
        listing("178425031509", "ST-245", "Blue coat copy", "https://www.vinted.com/items/178425031509"),
      ],
      []
    );
    expect(groups).toEqual([{ reason: "same-listing", itemIds: ["178425031509-blue-jeans", "178425031509"] }]);
  });

  test("keeps two different Vinted listings that share a SKU available for review", () => {
    const groups = findPossibleDuplicates(
      [listing("111111111111", "2443", "Blue coat"), listing("222222222222", "2443", "Other coat", "https://www.vinted.com/items/222222222222")],
      []
    );
    expect(groups).toEqual([{ reason: "sku", itemIds: ["111111111111", "222222222222"] }]);
  });

  test("groups items without a SKU only when the title and photo match", () => {
    const groups = findPossibleDuplicates(
      [
        listing("333333333333", "", "Red scarf"),
        listing("444444444444", "", "Red scarf"),
        listing("555555555555", "", "Red scarf", "https://www.vinted.com/items/555555555555"),
      ],
      []
    );
    expect(groups.map((group) => group.reason)).toEqual(["title-photo"]);
    expect(groups[0].itemIds).toEqual(["333333333333", "444444444444", "555555555555"]);
  });
});

describe("vinted presence sync", () => {
  test("archives only the listing confirmed removed and leaves the active one", () => {
    const rows = [presenceRow("111111111111", "2443", "123456789012"), presenceRow("222222222222", "2443", "123456789013")];
    const checked = applyPresenceResult(rows, "222222222222", "removed", "2026-10-12T20:00:00.000Z");
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.rows[0]).toEqual(rows[0]);
    expect(checked.rows[1]).toMatchObject({ sku: "2443", ebayItemId: "123456789013", presence: "removed", archivedAt: "2026-10-12T20:00:00.000Z" });
    const groups = findPossibleDuplicates(
      [
        listing("111111111111", "2443", "Blue coat"),
        listing("222222222222", "2443", "Blue coat"),
      ],
      []
    );
    expect(duplicateGroupsWithoutArchived(groups, ["222222222222"])).toEqual([]);
  });

  test("does not archive a listing that cannot be verified", () => {
    const rows = [presenceRow("111111111111", "", "123456789012"), presenceRow("222222222222", "ST-26", "123456789013")];
    const checked = applyPresenceResult(rows, "111111111111", "unverified", "2026-10-12T20:00:00.000Z");
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.rows[0]).toMatchObject({ presence: "unverified", archivedAt: null, sku: "", ebayItemId: "123456789012" });
    expect(checked.rows[1]).toEqual(rows[1]);
  });

  test("classifies connection errors and blocked pages as unverified", () => {
    expect(classifyVintedPage({ status: 0, body: "" })).toBe("unverified");
    expect(classifyVintedPage({ status: 403, body: "forbidden" })).toBe("unverified");
    expect(classifyVintedPage({ status: 429, body: "" })).toBe("unverified");
    expect(classifyVintedPage({ status: 200, body: "Just a moment... captcha" })).toBe("unverified");
    expect(classifyVintedPage({ status: 200, body: "x".repeat(500) })).toBe("active");
    expect(classifyVintedPage({ status: 404, body: "not found" })).toBe("removed");
    expect(classifyVintedPage({ status: 200, body: `${"x".repeat(500)} This item is no longer available` })).toBe("removed");
  });

  test("removes only the selected internal record after a manual removed mark", () => {
    const rows = [presenceRow("111111111111", "2443", "123456789012"), presenceRow("222222222222", "2443", "123456789013")];
    const marked = markListingRemoved(rows, "111111111111");
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    expect(marked.rows[0].archivedAt).toBeNull();
    expect(marked.rows[1]).toEqual(rows[1]);
    const dropped = dropRemovedRecord(marked.rows, "111111111111", "2026-10-12T21:00:00.000Z");
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) return;
    expect(dropped.rows[0].archivedAt).toBe("2026-10-12T21:00:00.000Z");
    expect(dropped.rows[1]).toEqual(rows[1]);
    expect(dropRemovedRecord(rows, "222222222222", "2026-10-12T21:00:00.000Z").ok).toBe(false);
  });

  test("does not recreate an archived Vinted record on a later import", () => {
    expect(planInventoryImport(null)).toBe("insert");
    expect(planInventoryImport({ archivedAt: "2026-10-12T21:00:00.000Z" })).toBe("skip-archived");
    expect(planInventoryImport({ archivedAt: null })).toBe("update");
  });
});
