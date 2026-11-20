import { describe, expect, test } from "vitest";
import { materializeAssistPhotos, selectAssistPhotoRefs } from "@/lib/vinted/assist-photos";
import { photosForPreparedSku } from "@/lib/vinted/prepare";
import { materializeSavedPhotos, savedPhotosInOrder } from "@/lib/vinted/saved-photo";
import { buildReadySnapshotFromPrepared } from "@/lib/vinted/snapshot";

const EBAY = "https://i.ebayimg.com/images/g/glitter/s-l1600.jpg";
const NEW_BYTES = "abcdabcd";
const THUMB = "data:image/jpeg;base64,aaaaaaaa";

describe("Vinted receives restored and queue photos", () => {
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

  test("SKU 3146: queue thumbs with previewUrl still reach the assist fill payload", async () => {
    // Snapshot has text for 3146 but no photo bytes — the bug the queue/extension mismatch hits.
    const snapshotPhotos: Array<{ data?: string; previewUrl?: string }> = [];
    const thumbs = [
      "data:image/jpeg;base64,aaaaaaaa",
      "data:image/jpeg;base64,bbbbbbbb",
      "data:image/jpeg;base64,cccccccc",
    ];
    const queuePhotos = thumbs.map((previewUrl, index) => ({
      id: String(index + 1),
      mediaType: "image/jpeg",
      data: "",
      previewUrl,
    }));

    const usable = selectAssistPhotoRefs(snapshotPhotos, queuePhotos);
    expect(usable).toHaveLength(3);

    const ready = await materializeAssistPhotos(snapshotPhotos, queuePhotos, async () => null);
    expect(ready).toHaveLength(3);
    expect(ready.every((photo) => photo.data.length > 0)).toBe(true);

    const snapshot = buildReadySnapshotFromPrepared({
      prepared: {
        sku: "3146",
        title: "Ready jacket",
        description: "Blue jacket\nSKU: 3146",
        brand: "Diesel",
        category: "Women",
        vintedCategory: "Women / Outerwear",
        size: "M",
        color: "Blue",
        condition: "Good",
        price: "28.00",
      },
      photos: ready,
    });
    expect(snapshot.sku).toBe("3146");
    expect(snapshot.photos).toHaveLength(3);
    expect(snapshot.photos.map((photo) => photo.data)).toEqual(ready.map((photo) => photo.data));
  });

  test("prefers snapshot bytes over job fallback when the ready item already has photos", async () => {
    const snapshotPhotos = [{ id: "snap", data: NEW_BYTES, previewUrl: "" }];
    const fallback = [{ id: "job", data: "", previewUrl: THUMB }];
    const usable = selectAssistPhotoRefs(snapshotPhotos, fallback);
    expect(usable.map((photo) => photo.id)).toEqual(["snap"]);
  });

  test("keeps full JPEG base64 that starts with /9j/ instead of falling back to the thumb", async () => {
    // Real JPEG base64 begins with /9j/ (FF D8). That must not be treated as a file path.
    const jpeg = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUQEhIVFhUVFRUVFRUVFRUWFxUXFhUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAECBQYAB//EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAB6E//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z";
    const padded = jpeg + "A".repeat((4 - (jpeg.length % 4)) % 4);
    const photo = {
      id: "full",
      mediaType: "image/jpeg",
      data: padded,
      previewUrl: THUMB,
    };
    const ready = await materializeSavedPhotos([photo], async () => null);
    expect(ready).toHaveLength(1);
    expect(ready[0]?.data).toBe(padded);
    expect(ready[0]?.data.startsWith("/9j/")).toBe(true);
  });
});
