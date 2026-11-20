// A restored archive photo can be visible from its eBay address while `data`
// is empty. The Vinted assistant only uploads bytes, so a photo counts when
// either the bytes or a fetchable picture address is still there.

const MAX_PHOTO_BYTES = 7 * 1024 * 1024;
const EBAY_PHOTO = /^https:\/\/(?:[a-z0-9-]+\.)*(?:ebayimg|ebaystatic)\.com\//i;

export interface SavedPhotoRef {
  id?: string;
  mediaType?: string;
  data?: string;
  previewUrl?: string;
  url?: string;
}

export interface ReadyPhotoBytes {
  mediaType: string;
  data: string;
}

export function savedPhotoBytes(photo: SavedPhotoRef): ReadyPhotoBytes | null {
  const direct = decodeImagePayload(photo.data, photo.mediaType);
  if (direct) return direct;
  const preview = decodeImagePayload(photo.previewUrl, photo.mediaType);
  if (preview) return preview;
  const raw = (photo.data ?? "").trim();
  if (!raw || isAddress(raw)) return null;
  return { mediaType: photo.mediaType || "image/jpeg", data: raw };
}

export function savedPhotoRemoteUrl(photo: SavedPhotoRef): string {
  if (savedPhotoBytes(photo)) return "";
  for (const value of [photo.data, photo.previewUrl, photo.url]) {
    const url = (value ?? "").trim();
    if (EBAY_PHOTO.test(url)) return url;
  }
  return "";
}

export function hasSavedPhoto(photo: SavedPhotoRef): boolean {
  return Boolean(savedPhotoBytes(photo) || savedPhotoRemoteUrl(photo));
}

export function savedPhotosInOrder<T extends SavedPhotoRef>(photos: readonly T[]): T[] {
  return photos.filter((photo) => hasSavedPhoto(photo));
}

export function photosForAssist<T extends SavedPhotoRef>(
  snapshotPhotos: readonly T[],
  jobPhotos: readonly T[]
): T[] {
  const snapshot = savedPhotosInOrder(snapshotPhotos);
  const job = savedPhotosInOrder(jobPhotos);
  if (job.length === 0) return snapshot;
  if (snapshot.length === 0) return job;
  return payloadLength(job) > payloadLength(snapshot) ? job : snapshot;
}

export async function materializeSavedPhotos(
  photos: readonly SavedPhotoRef[],
  download: (url: string) => Promise<ReadyPhotoBytes | null>
): Promise<ReadyPhotoBytes[]> {
  const ready: ReadyPhotoBytes[] = [];
  for (const photo of photos) {
    const bytes = savedPhotoBytes(photo);
    if (bytes) {
      ready.push(bytes);
      continue;
    }
    const url = savedPhotoRemoteUrl(photo);
    if (!url) continue;
    try {
      const fetched = await download(url);
      if (fetched?.data) ready.push(fetched);
    } catch {
      /* one unavailable picture does not drop the rest */
    }
  }
  return ready;
}

export async function downloadEbayPhoto(url: string): Promise<ReadyPhotoBytes | null> {
  if (!EBAY_PHOTO.test(url)) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES) return null;
  const header = response.headers.get("content-type");
  let mediaType = "image/jpeg";
  if (header && /^image\//i.test(header)) mediaType = header.split(";")[0].trim();
  else if (/\.png($|\?)/i.test(url)) mediaType = "image/png";
  else if (/\.webp($|\?)/i.test(url)) mediaType = "image/webp";
  return { mediaType, data: bytes.toString("base64") };
}

function payloadLength(photos: readonly SavedPhotoRef[]): number {
  return photos.reduce((total, photo) => total + (savedPhotoBytes(photo)?.data.length ?? 0), 0);
}

function isAddress(value: string): boolean {
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("blob:")) return true;
  // JPEG base64 starts with "/9j/". Any other leading slash is a stored file path.
  if (!value.startsWith("/")) return false;
  return !(value.startsWith("/9j/") && completeBase64(value));
}

function decodeImagePayload(value: string | undefined, mediaType?: string): ReadyPhotoBytes | null {
  const raw = (value ?? "").trim();
  if (!raw || isAddress(raw)) return null;
  if (raw.startsWith("data:")) {
    const match = /^data:([^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/.exec(raw);
    if (!match) return null;
    const data = match[2].replace(/\s+/g, "");
    if (!completeBase64(data)) return null;
    return { mediaType: match[1] || mediaType || "image/jpeg", data };
  }
  const data = raw.replace(/\s+/g, "");
  if (!completeBase64(data)) return null;
  return { mediaType: mediaType || "image/jpeg", data };
}

function completeBase64(value: string): boolean {
  return value.length >= 8 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
