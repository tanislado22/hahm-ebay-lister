import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { catalogPublicState } from "@/lib/markets/guatemala-catalog";
import { fingerprintImageBytes, varyImageBytes } from "@/lib/markets/guatemala-photo-image";
import {
  PHOTO_SEARCH_MESSAGES,
  decodeInventoryPhoto,
  photoSearchKeepsInternalPhoto,
  photoSearchLotLabel,
  rankPhotoFingerprints,
} from "@/lib/markets/guatemala-photo-search";

async function painted(color: { r: number; g: number; b: number }, mark: number): Promise<Buffer> {
  const raw = Buffer.alloc(64 * 80 * 3);
  for (let y = 0; y < 80; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const index = (y * 64 + x) * 3;
      const stripe = x > mark && x < mark + 8;
      raw[index] = stripe ? 255 - color.r : color.r;
      raw[index + 1] = stripe ? 255 - color.g : color.g;
      raw[index + 2] = stripe ? 255 - color.b : color.b;
    }
  }
  return sharp(raw, { raw: { width: 64, height: 80, channels: 3 } }).jpeg().toBuffer();
}

describe("guatemala photo search", () => {
  it("recovers the same garment from a new photo and names its lot", async () => {
    const original = await painted({ r: 180, g: 40, b: 40 }, 12);
    const twin = await painted({ r: 20, g: 90, b: 180 }, 40);
    const queryBytes = await varyImageBytes(original);
    const query = await fingerprintImageBytes(queryBytes!);
    const ranked = rankPhotoFingerprints(query!, [
      { id: "red", fingerprint: (await fingerprintImageBytes(original))! },
      { id: "blue", fingerprint: (await fingerprintImageBytes(twin))! },
    ]);
    expect(ranked.ranked[0]?.id).toBe("red");
    expect(ranked.clarity).toBe("clear");
    expect(photoSearchLotLabel(3, "USA")).toBe("Lote 3 · USA");
  });

  it("warns when two garments are too close and when nothing matches", async () => {
    const left = await painted({ r: 30, g: 140, b: 70 }, 18);
    const right = await painted({ r: 34, g: 146, b: 74 }, 19);
    const other = await painted({ r: 240, g: 210, b: 40 }, 48);
    const query = (await fingerprintImageBytes(left))!;
    const close = rankPhotoFingerprints(query, [
      { id: "left", fingerprint: query },
      { id: "right", fingerprint: (await fingerprintImageBytes(right))! },
    ]);
    expect(close.clarity).toBe("several");
    expect(close.ranked.map((item) => item.id)).toEqual(["left", "right"]);

    const blank = await sharp({ create: { width: 48, height: 48, channels: 3, background: "#777" } }).png().toBuffer();
    const none = rankPhotoFingerprints(
      (await fingerprintImageBytes(blank))!,
      [{ id: "other", fingerprint: (await fingerprintImageBytes(other))! }],
      0
    );
    expect(none.clarity).toBe("none");
    expect(none.ranked).toEqual([]);
  });

  it("keeps a missing photo optional and an unpublished photo inside inventory", () => {
    expect(decodeInventoryPhoto(undefined, undefined)).toEqual({ ok: true, photo: null });
    const tiny = Buffer.from("jpeg").toString("base64");
    expect(decodeInventoryPhoto("image/jpeg", tiny).ok).toBe(true);
    expect(decodeInventoryPhoto("text/plain", tiny)).toEqual({ ok: false, error: PHOTO_SEARCH_MESSAGES.unreadable });
    expect(photoSearchKeepsInternalPhoto(false)).toBe(true);
    expect(
      catalogPublicState(
        {
          id: "1",
          clientId: "tienda",
          sku: "USA-001",
          title: "Blusa",
          description: "",
          brand: "",
          size: "M",
          condition: "",
          priceGtq: "10.00",
          status: "disponible",
          photos: [{ id: "f", mediaType: "image/jpeg", data: "abcdabcd" }],
          sales: [],
          published: false,
        },
        "tienda"
      )
    ).toBe("oculto");
  });
});
