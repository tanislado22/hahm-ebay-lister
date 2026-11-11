import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  VINTED_UNLINK_MESSAGE,
  applyStoredVintedLink,
  showsVintedPrepare,
  showsVintedQueue,
  unlinkVintedAssociation,
  vintedStatusLabel,
} from "@/lib/vinted/unlink";

const published = {
  vintedStatus: "published" as const,
  vintedListingUrl: "https://www.vinted.com/items/123",
  vintedListingId: "123",
  publishedOnVinted: true,
  publishedOnEbay: true,
  ebayItemId: "555",
  prepared: { title: "Coat", sku: "K75-A" },
  photos: ["front", "back"],
};

describe("desvincular Vinted de una ficha publicada", () => {
  it("al confirmar quita el enlace, deja la ficha sin publicar y conserva fotos, datos y eBay", () => {
    const next = unlinkVintedAssociation(published);
    expect(next.vintedStatus).toBe("not_prepared");
    expect(next.vintedListingUrl).toBeNull();
    expect(next.vintedListingId).toBeNull();
    expect(next.publishedOnVinted).toBe(false);
    expect(vintedStatusLabel(next.vintedStatus)).toBe("Not Published");
    expect(showsVintedPrepare(next.vintedStatus)).toBe(true);
    expect(showsVintedQueue(next.vintedStatus)).toBe(true);
    expect(next.publishedOnEbay).toBe(published.publishedOnEbay);
    expect(next.ebayItemId).toBe(published.ebayItemId);
    expect(next.prepared).toEqual(published.prepared);
    expect(next.photos).toEqual(published.photos);

    const again = unlinkVintedAssociation(next);
    expect(again).toEqual(next);
  });

  it("cancelar no cambia la ficha y al recargar sigue desvinculada", () => {
    expect(published.vintedStatus).toBe("published");
    expect(published.vintedListingUrl).toContain("vinted.com");

    const reloaded = applyStoredVintedLink(
      { vintedStatus: "published" as const, vintedListingUrl: published.vintedListingUrl, photos: ["front"] },
      { vintedStatus: "not_prepared", vintedListingUrl: null }
    );
    expect(reloaded.vintedStatus).toBe("not_prepared");
    expect(reloaded.vintedListingUrl).toBeUndefined();
    expect(reloaded.photos).toEqual(["front"]);

    expect(VINTED_UNLINK_MESSAGE).toBe(
      "¿Seguro que quieres desvincular este artículo de Vinted? Se quitará el enlace guardado y podrás volver a prepararlo para publicar. Esto no eliminará ninguna publicación en Vinted ni afectará eBay."
    );
    const card = readFileSync("app/ListingCard.tsx", "utf8");
    expect(card).toContain("Desvincular Vinted");
    expect(card).toContain("{VINTED_UNLINK_MESSAGE}");
    expect(card).toContain("Cancelar");
    expect(card).toContain("Sí, desvincular");
    expect(card).toContain("Prepare for Vinted");
    expect(card).toContain("Open Vinted queue");
    const cancel = card.slice(card.indexOf("Cancelar") - 180, card.indexOf("Cancelar"));
    expect(cancel).toContain("setConfirmUnlink(false)");
    expect(cancel).not.toContain("onUnlinkVinted");
  });
});
