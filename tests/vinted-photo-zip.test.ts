import { describe, expect, test } from "vitest";
import { buildStoredZip, vintedPhotoFileName, vintedPhotoZipName } from "@/lib/vinted/photo-zip";

describe("Vinted photo download names", () => {
  test("names the zip and files from the item SKU, in order", () => {
    expect(vintedPhotoZipName("2860")).toBe("SKU-2860-Vinted-Photos.zip");
    expect(vintedPhotoFileName("2860", 0)).toBe("SKU-2860-01.jpg");
    expect(vintedPhotoFileName("2860", 1)).toBe("SKU-2860-02.jpg");
    expect(vintedPhotoFileName("2860", 2)).toBe("SKU-2860-03.jpg");
  });

  test("stores the files in the zip without changing their bytes", () => {
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([4, 5]);
    const zip = buildStoredZip([
      { name: vintedPhotoFileName("2860", 0), data: first },
      { name: vintedPhotoFileName("2860", 1), data: second },
    ]);
    const text = new TextDecoder().decode(zip);
    expect(text.indexOf("SKU-2860-01.jpg")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("SKU-2860-01.jpg")).toBeLessThan(text.indexOf("SKU-2860-02.jpg"));
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    const name = vintedPhotoFileName("2860", 0);
    expect(Array.from(zip.slice(30 + name.length, 33 + name.length))).toEqual([1, 2, 3]);
  });
});
