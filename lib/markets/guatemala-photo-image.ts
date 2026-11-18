import sharp from "sharp";
import { buildFingerprint, imageTexture } from "@/lib/markets/guatemala-photo-search";

export async function describeImageBytes(bytes: Buffer): Promise<{ fingerprint: number[]; texture: number } | null> {
  if (!bytes.byteLength) return null;
  try {
    const { data, info } = await sharp(bytes, { failOn: "none" })
      .rotate()
      .resize(48, 48, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height) return null;
    return {
      fingerprint: buildFingerprint(data, info.width, info.height, info.channels),
      texture: imageTexture(data, info.width, info.height, info.channels),
    };
  } catch {
    return null;
  }
}

export async function fingerprintImageBytes(bytes: Buffer): Promise<number[] | null> {
  const described = await describeImageBytes(bytes);
  return described?.fingerprint ?? null;
}

export async function previewImageBytes(bytes: Buffer): Promise<{ mediaType: "image/jpeg"; data: string } | null> {
  try {
    const jpeg = await sharp(bytes, { failOn: "none" }).rotate().resize(240, 240, { fit: "inside" }).jpeg({ quality: 72 }).toBuffer();
    return { mediaType: "image/jpeg", data: jpeg.toString("base64") };
  } catch {
    return null;
  }
}

export async function varyImageBytes(bytes: Buffer): Promise<Buffer | null> {
  try {
    const meta = await sharp(bytes, { failOn: "none" }).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < 20 || height < 20) return null;
    const crop = {
      left: Math.floor(width * 0.08),
      top: Math.floor(height * 0.08),
      width: Math.floor(width * 0.84),
      height: Math.floor(height * 0.84),
    };
    return sharp(bytes, { failOn: "none" })
      .rotate()
      .extract(crop)
      .modulate({ brightness: 1.08 })
      .resize(Math.max(32, Math.floor(width * 0.9)))
      .jpeg({ quality: 70 })
      .toBuffer();
  } catch {
    return null;
  }
}
