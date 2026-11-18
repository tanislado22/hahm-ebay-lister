import { scanLotLabel } from "@/lib/markets/guatemala-qr";

/**
 * Busca una prenda por una foto nueva, dentro del inventario interno.
 * No usa el SKU ni el lote. Las prendas sin publicar entran en la búsqueda
 * y siguen fuera del catálogo público.
 */

const GRID = 8;
const CLEAR_SCORE = 0.9;
const SEVERAL_GAP = 0.03;
const NONE_SCORE = 0.78;
const SHOW_SCORE = 0.7;
export const FLAT_PHOTO_TEXTURE = 0.045;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

export const PHOTO_SEARCH_MESSAGES = {
  clear: "Esta es la prenda más parecida. Revisa la foto y copia el SKU para etiquetarla.",
  several: "Hay varias prendas parecidas. Compara las fotos antes de elegir el SKU.",
  none: "No hay una coincidencia clara. Prueba otra foto de la prenda o búscalo por SKU.",
  empty: "Todavía no hay prendas con foto para comparar.",
  unreadable: "No se pudo leer esa foto. Prueba con otra.",
} as const;

export type PhotoSearchClarity = "clear" | "several" | "none";

export interface PhotoSearchCandidate {
  id: string;
  fingerprint: number[];
}

export function imageTexture(rgb: Uint8Array, width: number, height: number, channels = 3): number {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let index = 0; index < rgb.length; index += channels) {
    const gray = ((rgb[index] ?? 0) * 0.3 + (rgb[index + 1] ?? 0) * 0.59 + (rgb[index + 2] ?? 0) * 0.11) / 255;
    sum += gray;
    sumSquares += gray * gray;
    count += 1;
  }
  if (!count) return 0;
  const mean = sum / count;
  return Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
}

export function buildFingerprint(rgb: Uint8Array, width: number, height: number, channels = 3): number[] {
  const values: number[] = [];
  const gray: number[] = [];
  for (let gy = 0; gy < GRID; gy += 1) {
    for (let gx = 0; gx < GRID; gx += 1) {
      const x0 = Math.floor((gx * width) / GRID);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / GRID));
      const y0 = Math.floor((gy * height) / GRID);
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / GRID));
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < height; y += 1) {
        for (let x = x0; x < x1 && x < width; x += 1) {
          const index = (y * width + x) * channels;
          red += rgb[index] ?? 0;
          green += rgb[index + 1] ?? 0;
          blue += rgb[index + 2] ?? 0;
          count += 1;
        }
      }
      const safe = count || 1;
      const r = red / safe / 255;
      const g = green / safe / 255;
      const b = blue / safe / 255;
      values.push(r, g, b);
      gray.push(r * 0.3 + g * 0.59 + b * 0.11);
    }
  }
  for (let index = 0; index < gray.length; index += 1) {
    if ((index + 1) % GRID === 0) continue;
    values.push((gray[index] ?? 0) - (gray[index + 1] ?? 0));
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

export function fingerprintSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let dot = 0;
  for (let index = 0; index < length; index += 1) dot += (left[index] ?? 0) * (right[index] ?? 0);
  return dot;
}

export function rankPhotoFingerprints(
  query: number[],
  candidates: readonly PhotoSearchCandidate[],
  queryTexture = 1
): { clarity: PhotoSearchClarity; ranked: { id: string; similarity: number }[] } {
  if (queryTexture < FLAT_PHOTO_TEXTURE) return { clarity: "none", ranked: [] };
  const ranked = candidates
    .map((candidate) => ({ id: candidate.id, similarity: fingerprintSimilarity(query, candidate.fingerprint) }))
    .filter((candidate) => Number.isFinite(candidate.similarity))
    .sort((left, right) => right.similarity - left.similarity || (left.id < right.id ? -1 : 1));
  const best = ranked[0]?.similarity ?? 0;
  const second = ranked[1]?.similarity ?? 0;
  if (best < NONE_SCORE) {
    return { clarity: "none", ranked: ranked.filter((item) => item.similarity >= SHOW_SCORE).slice(0, 4) };
  }
  const close = best - second < SEVERAL_GAP && second >= NONE_SCORE;
  const clarity: PhotoSearchClarity = close ? "several" : best >= CLEAR_SCORE ? "clear" : "several";
  return { clarity, ranked: ranked.filter((item) => item.similarity >= SHOW_SCORE).slice(0, 5) };
}

export function photoSearchMessage(clarity: PhotoSearchClarity, count: number): string {
  if (count === 0 && clarity === "none") return PHOTO_SEARCH_MESSAGES.none;
  if (clarity === "several") return PHOTO_SEARCH_MESSAGES.several;
  if (clarity === "clear") return PHOTO_SEARCH_MESSAGES.clear;
  return PHOTO_SEARCH_MESSAGES.none;
}

export function photoSearchLotLabel(lotNumber: number | null, lotName: string | null): string {
  return scanLotLabel(lotNumber, lotName);
}

/** Unpublished garments stay searchable inside inventory and out of the public catalog. */
export function photoSearchKeepsInternalPhoto(published: boolean): boolean {
  return published === false || published === true;
}

export function decodeInventoryPhoto(
  mediaType: unknown,
  data: unknown
): { ok: true; photo: { mediaType: string; data: string; bytes: Buffer } | null } | { ok: false; error: string } {
  const type = typeof mediaType === "string" ? mediaType.trim().toLowerCase() : "";
  const raw = typeof data === "string" ? data.trim() : "";
  if (!type && !raw) return { ok: true, photo: null };
  if (!/^image\/(jpeg|png|webp)$/.test(type) || !raw) return { ok: false, error: PHOTO_SEARCH_MESSAGES.unreadable };
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES) return { ok: false, error: PHOTO_SEARCH_MESSAGES.unreadable };
  return { ok: true, photo: { mediaType: type, data: raw, bytes } };
}
