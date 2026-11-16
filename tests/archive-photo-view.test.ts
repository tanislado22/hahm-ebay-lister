import { describe, expect, it } from "vitest";
import { photoForWorkspace } from "@/lib/archive/workspace";
import { photoViewSrc } from "@/lib/photos/view";

const EBAY = "https://i.ebayimg.com/images/g/abc/s-l1600.jpg";
const FULL = "abcdabcd";

describe("restored archive photos", () => {
  it("keeps the eBay address for a photo that was stored without bytes", () => {
    const photo = photoForWorkspace({ id: "ebay-1", mediaType: "image/jpeg", bytes: "", url: EBAY });
    expect(photo.previewUrl).toBe(EBAY);
    expect(photo.data).toBe("");
    expect(photoViewSrc(photo)).toBe(photo.previewUrl);
    expect(photoViewSrc(photo)).not.toBe("data:image/jpeg;base64,");
  });

  it("uses the stored image for a local photo and does not change its id", () => {
    const photos = [
      photoForWorkspace({ id: "front", mediaType: "image/jpeg", bytes: FULL, url: "" }),
      photoForWorkspace({ id: "back", mediaType: "image/jpeg", bytes: "", url: EBAY }),
    ];
    expect(photos.map((photo) => photo.id)).toEqual(["front", "back"]);
    expect(photoViewSrc(photos[0])).toBe(`data:image/jpeg;base64,${FULL}`);
    expect(photos[0].previewUrl).toBe(photoViewSrc(photos[0]));
    expect(photoViewSrc(photos[1])).toBe(EBAY);
  });

  it("does not wrap a data URL or a broken payload a second time", () => {
    const dataUrl = "data:image/jpeg;base64,abcdabcd";
    const stored = photoForWorkspace({ id: "wrapped", mediaType: "image/jpeg", bytes: dataUrl, url: "" });
    expect(photoViewSrc(stored)).toBe(dataUrl);
    expect(stored.previewUrl).toBe(dataUrl);
    expect(photoViewSrc({
      mediaType: "image/jpeg",
      data: "%%%not-base64",
      previewUrl: EBAY,
    })).toBe(EBAY);
    expect(photoViewSrc({
      mediaType: "image/jpeg",
      data: "abcdabc",
      previewUrl: EBAY,
    })).toBe(EBAY);
  });
});
