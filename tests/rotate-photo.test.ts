import { describe, expect, it } from "vitest";
import { applyRotatedPhoto, clockwiseSize, ROTATE_JPEG_QUALITY } from "@/lib/photos/rotate";

describe("rotate photo", () => {
  it("turns the frame 90 degrees clockwise without shrinking it", () => {
    expect(clockwiseSize(1200, 800)).toEqual({ width: 800, height: 1200 });
    expect(clockwiseSize(800, 1200)).toEqual({ width: 1200, height: 800 });
    expect(ROTATE_JPEG_QUALITY).toBeGreaterThanOrEqual(0.9);
  });

  it("replaces only the chosen photo and keeps the order", () => {
    const photos = [
      { id: "a", data: "front" },
      { id: "b", data: "side" },
      { id: "c", data: "back" },
    ];
    const next = applyRotatedPhoto(photos, "b", { data: "side-turned" });
    expect(next.map((photo) => photo.id)).toEqual(["a", "b", "c"]);
    expect(next.map((photo) => photo.data)).toEqual(["front", "side-turned", "back"]);
    expect(photos[1].data).toBe("side");
  });
});
