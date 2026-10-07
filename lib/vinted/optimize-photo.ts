const TARGET_BYTES = 2 * 1024 * 1024;
const HARD_MAX_BYTES = 7 * 1024 * 1024;
const QUALITIES = [0.92, 0.9, 0.88, 0.86];

function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const payload = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  const binary = atob(payload);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return createImageBitmap(blob);
  }
}

function fittedSize(width: number, height: number, maxLongEdge: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function renderJpeg(bitmap: ImageBitmap, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return Promise.reject(new Error("Could not prepare the photo."));
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) reject(new Error("Could not prepare the photo."));
        else resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function optimizePhotoCopy(data: string, mediaType: string): Promise<Uint8Array> {
  const source = base64ToBytes(data);
  const type = mediaType || "image/jpeg";
  if (/jpe?g/i.test(type) && source.byteLength <= TARGET_BYTES) return source;

  const bitmap = await decodeImage(new Blob([source], { type }));
  try {
    let maxLongEdge = Math.max(bitmap.width, bitmap.height);
    let bestSafe: Uint8Array | null = null;
    while (maxLongEdge >= 1200) {
      const size = fittedSize(bitmap.width, bitmap.height, maxLongEdge);
      let safeAtThisSize: Uint8Array | null = null;
      for (const quality of QUALITIES) {
        const jpeg = await blobBytes(await renderJpeg(bitmap, size.width, size.height, quality));
        if (jpeg.byteLength <= TARGET_BYTES) return jpeg;
        if (jpeg.byteLength <= HARD_MAX_BYTES && !safeAtThisSize) safeAtThisSize = jpeg;
      }
      if (safeAtThisSize) bestSafe = safeAtThisSize;
      const longEdge = Math.max(size.width, size.height);
      const nextEdge = Math.round(longEdge * 0.8);
      if (nextEdge >= longEdge || nextEdge < 1200) break;
      if (nextEdge < 1800 && bestSafe) break;
      maxLongEdge = nextEdge;
    }
    if (!bestSafe || bestSafe.byteLength > HARD_MAX_BYTES) {
      throw new Error("Could not prepare a photo under Vinted's 9 MB limit.");
    }
    return bestSafe;
  } finally {
    bitmap.close();
  }
}
