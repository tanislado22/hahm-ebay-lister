import { describe, expect, test } from "vitest";
import { keepWorkingOrder, listScrollHold } from "@/lib/vinted/list-scroll";

describe("inventory working order", () => {
  const previous = [
    { vintedItemId: "100", sku: "ST-1" },
    { vintedItemId: "200", sku: "ST-2" },
    { vintedItemId: "300", sku: "ST-3" },
  ];

  test("does not move a just-confirmed article to the top when the server sorts by updated time", () => {
    const incoming = [
      { vintedItemId: "200", sku: "ST-2", status: "verified" },
      { vintedItemId: "100", sku: "ST-1" },
      { vintedItemId: "300", sku: "ST-3" },
    ];
    expect(keepWorkingOrder(previous, incoming).map((item) => item.vintedItemId)).toEqual(["100", "200", "300"]);
    expect(keepWorkingOrder(previous, incoming)[1]).toMatchObject({ status: "verified", sku: "ST-2" });
  });

  test("drops articles missing from the response and appends new ones", () => {
    const incoming = [
      { vintedItemId: "400", sku: "ST-4" },
      { vintedItemId: "300", sku: "ST-3" },
    ];
    expect(keepWorkingOrder(previous, incoming).map((item) => item.vintedItemId)).toEqual(["300", "400"]);
  });
});

describe("inventory scroll hold", () => {
  test("remembers the document position and the following article for any SKU", () => {
    expect(listScrollHold(["100", "200", "300"], "200", 2480)).toEqual({
      id: "200",
      nextId: "300",
      scrollTop: 2480,
    });
    expect(listScrollHold(["a", "b"], "b", 900).nextId).toBe("");
  });
});
