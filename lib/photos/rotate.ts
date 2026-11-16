// Quarter-turns are baked into the stored JPEG. eBay, the workspace, and the
// Guatemala catalog all publish `data`, so a CSS-only turn would snap back.

export const ROTATE_JPEG_QUALITY = 0.92;

export function clockwiseSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(1, height), height: Math.max(1, width) };
}

export function photoRevision(photos: readonly { id: string; data: string }[]): string {
  return photos.map((photo) => `${photo.id}:${photo.data.length}:${photo.data.slice(-24)}`).join("|");
}

export function applyRotatedPhoto<T extends { id: string }>(
  photos: readonly T[],
  id: string,
  next: Partial<T>
): T[] {
  return photos.map((photo) => (photo.id === id ? { ...photo, ...next } : photo));
}

export interface RotatedPhoto {
  mediaType: "image/jpeg";
  data: string;
  previewUrl: string;
}

const PREVIEW_DIM = 240;
const PREVIEW_QUALITY = 0.8;

export async function rotatePhotoClockwise(photo: {
  mediaType?: string;
  data: string;
}): Promise<RotatedPhoto> {
  const image = await loadImage(imageSource(photo.mediaType || "image/jpeg", photo.data));
  const full = clockwiseSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const preview = scaleDown(full.width, full.height, PREVIEW_DIM);
  return {
    mediaType: "image/jpeg",
    data: stripPrefix(drawRotated(image, full.width, full.height, ROTATE_JPEG_QUALITY)),
    previewUrl: drawRotated(image, preview.width, preview.height, PREVIEW_QUALITY),
  };
}

function imageSource(mediaType: string, data: string): string {
  return data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
}

function stripPrefix(url: string): string {
  const comma = url.indexOf(",");
  return comma >= 0 ? url.slice(comma + 1) : url;
}

function scaleDown(width: number, height: number, max: number) {
  if (width <= max && height <= max) return { width, height };
  const ratio = Math.min(max / width, max / height);
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

function drawRotated(
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo rotar la foto.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.translate(width, 0);
  context.rotate(Math.PI / 2);
  context.drawImage(source, 0, 0, height, width);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo rotar la foto."));
    image.src = src;
  });
}
