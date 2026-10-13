import { parseVintedItemLink } from "@/lib/vinted/inventory-match";

export type VintedPresence = "" | "active" | "removed" | "unverified";

export interface PresenceListing {
  vintedItemId: string;
  sku: string;
  ebayItemId: string;
  archivedAt: string | null;
  presence: VintedPresence;
}

const REMOVED_TEXT = /no longer available|isn.?t available|item not found|has been removed|no longer for sale|ya no está disponible|ya no esta disponible|no está disponible|no esta disponible|artículo eliminado|articulo eliminado|n'est plus disponible|nicht mehr verfügbar|non è più disponibile/i;
const BLOCKED_TEXT = /captcha|access denied|just a moment|cf-browser-verification|enable javascript|iniciar sesión|log in to|sign in/i;

export function canonicalVintedId(vintedItemId: string, url = ""): string {
  const fromUrl = parseVintedItemLink(url);
  if (fromUrl?.vintedItemId) return fromUrl.vintedItemId;
  const raw = vintedItemId.trim();
  const prefixed = raw.match(/^(\d+)(?:-|$)/);
  return prefixed?.[1] || raw;
}

export function classifyVintedPage(input: { status: number; body: string; finalUrl?: string; requestedUrl?: string }): VintedPresence {
  const status = input.status;
  const body = input.body || "";
  if (!status || status === 401 || status === 403 || status === 408 || status === 429 || status >= 500) return "unverified";
  if (BLOCKED_TEXT.test(body)) return "unverified";
  const requestedId = input.requestedUrl ? canonicalVintedId("", input.requestedUrl) : "";
  const finalId = input.finalUrl ? canonicalVintedId("", input.finalUrl) : "";
  if (status >= 300 && status < 400) return "unverified";
  if (status === 404 || status === 410) return "removed";
  if (status !== 200) return "unverified";
  if (requestedId && finalId && requestedId !== finalId) return "unverified";
  if (REMOVED_TEXT.test(body)) return "removed";
  if (body.trim().length < 400) return "unverified";
  return "active";
}

export function applyPresenceResult<T extends PresenceListing>(
  rows: T[],
  vintedItemId: string,
  presence: VintedPresence,
  checkedAt: string
): { ok: true; rows: T[] } | { ok: false; error: string } {
  const id = vintedItemId.trim();
  if (!id) return { ok: false, error: "Falta la publicación de Vinted." };
  if (!rows.some((row) => row.vintedItemId === id)) return { ok: false, error: "No existe esa publicación." };
  if (presence !== "active" && presence !== "removed" && presence !== "unverified") {
    return { ok: false, error: "No se pudo confirmar el estado." };
  }
  return {
    ok: true,
    rows: rows.map((row) => {
      if (row.vintedItemId !== id) return row;
      return {
        ...row,
        presence,
        archivedAt: presence === "removed" ? checkedAt : row.archivedAt,
      };
    }),
  };
}

export function markListingRemoved<T extends PresenceListing>(rows: T[], vintedItemId: string): { ok: true; rows: T[] } | { ok: false; error: string } {
  const id = vintedItemId.trim();
  const current = rows.find((row) => row.vintedItemId === id);
  if (!current) return { ok: false, error: "No existe esa publicación." };
  if (current.archivedAt) return { ok: false, error: "Ese registro ya está archivado." };
  return {
    ok: true,
    rows: rows.map((row) => (row.vintedItemId === id ? { ...row, presence: "removed" } : row)),
  };
}

export function dropRemovedRecord<T extends PresenceListing>(
  rows: T[],
  vintedItemId: string,
  archivedAt: string
): { ok: true; rows: T[] } | { ok: false; error: string } {
  const id = vintedItemId.trim();
  const current = rows.find((row) => row.vintedItemId === id);
  if (!current) return { ok: false, error: "No existe esa publicación." };
  if (current.presence !== "removed") return { ok: false, error: "Ese registro no está marcado como eliminado en Vinted." };
  if (current.archivedAt) return { ok: false, error: "Ese registro ya está archivado." };
  return {
    ok: true,
    rows: rows.map((row) => (row.vintedItemId === id ? { ...row, archivedAt } : row)),
  };
}

export async function readVintedListingPresence(url: string): Promise<VintedPresence> {
  const requested = parseVintedItemLink(url);
  if (!requested) return "unverified";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(requested.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "text/html" },
    });
    const readable = response.status === 200 || response.status === 404 || response.status === 410;
    const body = readable ? (await response.text()).slice(0, 20000) : "";
    return classifyVintedPage({ status: response.status, body, requestedUrl: requested.url, finalUrl: response.url });
  } catch {
    return "unverified";
  } finally {
    clearTimeout(timer);
  }
}

export function planInventoryImport(existing: { archivedAt: string | null } | null): "insert" | "update" | "skip-archived" {
  if (!existing) return "insert";
  if (existing.archivedAt) return "skip-archived";
  return "update";
}
