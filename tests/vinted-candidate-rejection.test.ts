import { describe, expect, test } from "vitest";
import {
  confirmCandidateOnListings,
  omitRejectedMatch,
  rejectCandidateOnListings,
  type CandidateListing,
} from "@/lib/vinted/candidate-rejection";

const st26 = { sku: "ST-26", title: "Levi's 550", ebayItemId: "123456789012", photoUrl: "" };
const st28 = { sku: "ST-28", title: "Levi's 551", ebayItemId: "123456789013", photoUrl: "" };

function listing(id: string, overrides: Partial<CandidateListing> = {}): CandidateListing {
  return {
    vintedItemId: id,
    sku: "",
    suggestedSku: "ST-26",
    ebayItemId: "",
    matchStatus: "review",
    detail: "Dos coincidencias.",
    candidates: [st26, st28],
    rejected: [],
    ...overrides,
  };
}

describe("individual eBay candidate rejection", () => {
  test("rejects only ST-26 and leaves ST-28 on the same Vinted listing", () => {
    const other = listing("vinted-other");
    const result = rejectCandidateOnListings([listing("vinted-1"), other], "vinted-1", st26);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[1]).toEqual(other);
    expect(result.rows[0].candidates).toEqual([st28]);
    expect(result.rows[0].rejected).toEqual([{ sku: "ST-26", ebayItemId: "123456789012" }]);
    expect(result.rows[0].suggestedSku).toBe("ST-28");
    expect(result.rows[0].matchStatus).toBe("review");
    expect(result.rows[0].vintedItemId).toBe("vinted-1");
  });

  test("does not change a listing whose association is already confirmed", () => {
    const confirmed = listing("vinted-1", { matchStatus: "verified", sku: "ST-28", ebayItemId: "123456789013", suggestedSku: "", candidates: [] });
    const result = rejectCandidateOnListings([confirmed], "vinted-1", st26);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Esa asociación ya está verificada.");
  });

  test("keeps a rejected candidate out of the next identification", () => {
    const match = omitRejectedMatch(
      {
        status: "review",
        sku: "",
        suggestedSku: "ST-26",
        ebayItemId: "",
        detail: "Dos coincidencias.",
        candidates: [st26, st28],
      },
      [{ sku: "ST-26", ebayItemId: "123456789012" }]
    );
    expect(match.candidates).toEqual([st28]);
    expect(match.sku).toBe("");
    expect(match.suggestedSku).toBe("ST-28");
    expect(match.status).toBe("review");
  });

  test("confirms only ST-28 on the selected Vinted listing", () => {
    const other = listing("vinted-other", { suggestedSku: "ST-26", sku: "ST-26", matchStatus: "verified", ebayItemId: "123456789012", candidates: [] });
    const result = confirmCandidateOnListings([listing("vinted-1"), other], "vinted-1", "ST-28", "123456789013");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[1]).toEqual(other);
    expect(result.rows[0]).toMatchObject({
      vintedItemId: "vinted-1",
      sku: "ST-28",
      ebayItemId: "123456789013",
      matchStatus: "verified",
      suggestedSku: "",
      candidates: [],
    });
  });
});
