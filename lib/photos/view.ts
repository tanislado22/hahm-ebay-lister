// The thumbnail reads previewUrl. The large viewer used to rebuild a data URL
// from `data` only, so a restored photo that only has an eBay URL opened as a
// broken image. Keep the stored bytes when they are a real image, and otherwise
// show the same address the thumbnail already uses.

export function photoViewSrc(photo: {
  mediaType?: string;
  data?: string;
  previewUrl?: string;
}): string {
  const preview = (photo.previewUrl ?? "").trim();
  const raw = (photo.data ?? "").trim();
  if (!raw) return preview;
  if (isDirectImageSrc(raw)) return raw;
  const base64 = normalizedBase64(raw);
  if (!base64) return preview;
  return `data:${photo.mediaType?.trim() || "image/jpeg"};base64,${base64}`;
}

function isDirectImageSrc(value: string): boolean {
  return (
    value.startsWith("data:") ||
    value.startsWith("https://") ||
    value.startsWith("http://") ||
    value.startsWith("/")
  );
}

function normalizedBase64(value: string): string {
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 8 || compact.length % 4 !== 0) return "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return "";
  return compact;
}
