import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { restoreGroup } from "@/lib/archive/workspace";
import { photosForPreparedSku } from "@/lib/vinted/prepare";
import { materializeSavedPhotos, savedPhotosInOrder } from "@/lib/vinted/saved-photo";

const require = createRequire(import.meta.url);
const fields = require("../extension-v2/fields.js") as {
  fieldIsFillable: (field: { tag?: string; editable?: boolean; width: number; height: number }) => boolean;
  matchFillableField: (
    fields: Array<{
      tag?: string;
      type?: string;
      editable?: boolean;
      width: number;
      height: number;
      placeholder?: string;
      aria?: string;
      name?: string;
      testId?: string;
      label?: string;
    }>,
    aliases: string[]
  ) => { placeholder?: string } | null;
};

const EBAY = "https://i.ebayimg.com/images/g/glitter/s-l1600.jpg";
const NEW_BYTES = "abcdabcd";

describe("Vinted receives restored and new photos", () => {
  test("keeps a restored URL photo and a new photo, in that order", async () => {
    const restored = { id: "front", mediaType: "image/jpeg", data: "", previewUrl: EBAY };
    const fresh = { id: "back", mediaType: "image/jpeg", data: NEW_BYTES, previewUrl: "" };
    const saved = savedPhotosInOrder([
      restored,
      { id: "empty", data: "", previewUrl: "" },
      fresh,
    ]);
    expect(saved.map((photo) => photo.id)).toEqual(["front", "back"]);
    expect(photosForPreparedSku([{ sku: "Glitter", photos: saved }], "Glitter").map((photo) => photo.id)).toEqual([
      "front",
      "back",
    ]);

    const downloaded: string[] = [];
    const ready = await materializeSavedPhotos(saved, async (url) => {
      downloaded.push(url);
      return { mediaType: "image/jpeg", data: "ebaybytes" };
    });
    expect(downloaded).toEqual([EBAY]);
    expect(ready.map((photo) => photo.data)).toEqual(["ebaybytes", NEW_BYTES]);
  });

  test("a restored article keeps its archive description when the listing has none", () => {
    const group = restoreGroup({
      articleId: "article-1",
      sourceJobId: "job-1",
      sku: "Glitter",
      title: "Glitter jacket",
      description: "Chaqueta con brillo",
      price: "12.00",
      currency: "USD",
      ebayItemId: "123456789012",
      ebayUrl: "",
      vintedStatus: "",
      vintedListingUrl: "",
      storedGroup: { listing: { title: "Glitter jacket", description: "" } },
      photoIds: ["front"],
    });
    expect(group.listing?.description).toBe("Chaqueta con brillo");
  });
});

describe("Vinted description field", () => {
  test("finds a tall description box and leaves the title field alone", () => {
    const description = {
      tag: "textarea",
      type: "textarea",
      width: 480,
      height: 180,
      placeholder: "Describe your item",
      label: "Describe your item",
    };
    const title = {
      tag: "input",
      type: "text",
      width: 480,
      height: 44,
      placeholder: "What are you selling?",
      label: "Title",
    };
    expect(fields.fieldIsFillable(description)).toBe(true);
    expect(fields.fieldIsFillable({ tag: "input", width: 480, height: 180 })).toBe(false);
    expect(fields.matchFillableField([title, description], ["description", "describe your item", "describe"])).toBe(description);
    expect(fields.matchFillableField([description], ["title", "what are you selling"])).toBe(null);
    expect(fields.matchFillableField([title], ["title", "what are you selling"])).toBe(title);
  });
});
