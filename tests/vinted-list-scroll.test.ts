import { describe, expect, test } from "vitest";
import { listScrollAnchor, scrollDelta } from "@/lib/vinted/list-scroll";

describe("inventory list scroll anchor", () => {
  const ids = ["9243241763", "8894785510", "178425031509"];

  test("keeps the following article for any SKU when the current one leaves the list", () => {
    expect(listScrollAnchor(ids, "8894785510", 640)).toEqual({
      id: "8894785510",
      nextId: "178425031509",
      top: 640,
    });
    expect(listScrollAnchor(["a", "b"], "a", 120).nextId).toBe("b");
  });

  test("has no following article at the end or for an unknown id", () => {
    expect(listScrollAnchor(ids, "178425031509", 900).nextId).toBe("");
    expect(listScrollAnchor(ids, "missing", 10)).toEqual({ id: "missing", nextId: "", top: 10 });
  });

  test("measures the correction that returns a jumped page to the working article", () => {
    expect(scrollDelta(0, 640)).toBe(-640);
    expect(scrollDelta(640, 640)).toBe(0);
  });
});
