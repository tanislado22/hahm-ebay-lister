/**
 * Etiqueta QR de Tienda Guatemala.
 *
 * El QR puede contener uno de estos dos textos, sin precio, enlace ni sesión:
 *   VSA1:<identificador de la prenda>
 *   <SKU de la prenda>
 *
 * Ejemplos:
 *   VSA1:550e8400-e29b-41d4-a716-446655440000
 *   L1-0001
 *
 * El identificador distingue una prenda aunque el SKU se repita. El SKU se
 * busca tal como está guardado en el inventario de Guatemala: se quitan solo
 * los espacios de los extremos y se conservan los ceros iniciales. Si ese SKU
 * está en varios lotes, hay que elegir la prenda. El texto no abre el panel
 * ni registra una venta.
 */

export const GARMENT_QR_PREFIX = "VSA1";

export const GARMENT_QR_SPEC =
  "El QR puede traer el identificador de la prenda, por ejemplo VSA1:550e8400-e29b-41d4-a716-446655440000, o solo el SKU tal como está en la prenda, por ejemplo L1-0001. Se conservan los ceros iniciales. Si el SKU está en varios lotes, elige la prenda. Escanear no registra la venta.";

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QR_TEXT = new RegExp(`^${GARMENT_QR_PREFIX}:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`, "i");

export const QR_MESSAGES = {
  badCode: "Ese QR no es una etiqueta válida. Usa VSA1: y el identificador, o el SKU tal como está en la prenda.",
  unknownCode: "No hay una prenda con ese código en el inventario de Guatemala.",
  unknownSku: "No se encontró una prenda con este SKU",
  needCodeOrSku: "Escanea una etiqueta o escribe un SKU.",
  sold: "Esta prenda ya fue vendida. No se puede registrar otra venta.",
  withdrawn: "Esta prenda está retirada. No se puede registrar una venta.",
  unavailable: "Esta prenda no está disponible para la venta.",
  cameraDenied:
    "El navegador no tiene permiso para usar la cámara. Permite la cámara para este sitio y pulsa Escanear de nuevo. En iPhone: Ajustes, Safari, Cámara, Permitir. En Android: el candado de la barra de direcciones, Permisos, Cámara, Permitir. También puedes buscar la prenda por SKU.",
  cameraMissing: "Este celular no tiene una cámara que se pueda usar. Busca la prenda por SKU.",
  cameraInsecure: "La cámara solo funciona con la página en HTTPS. Ábrela con https o busca la prenda por SKU.",
  cameraFailed: "No se pudo abrir la cámara. Puedes buscar la prenda por SKU.",
} as const;

export interface ScanGarment {
  id: string;
  sku: string;
  title: string;
  priceGtq: string;
  status: string;
  published: boolean;
  lotId: string | null;
  lotNumber: number | null;
  lotName: string | null;
  photo: { mediaType: string; data: string } | null;
}

export type ScanLookup =
  | { ok: true; choice: "one"; garment: ScanGarment }
  | { ok: true; choice: "many"; garments: ScanGarment[] }
  | { ok: false; status: 404; error: string };

export type ScanQuery =
  | { ok: true; kind: "code"; itemId: string }
  | { ok: true; kind: "sku"; sku: string }
  | { ok: false; status: 400; error: string };

export type ScannedLabel = ScanQuery;

export interface ScanLock {
  code: string | null;
  saving: boolean;
}

export function garmentQrText(itemId: string): string {
  return `${GARMENT_QR_PREFIX}:${itemId}`;
}

export function parseGarmentQr(raw: unknown): { ok: true; itemId: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: QR_MESSAGES.badCode };
  const match = QR_TEXT.exec(raw.trim());
  if (!match?.[1] || !ITEM_ID.test(match[1])) return { ok: false, error: QR_MESSAGES.badCode };
  return { ok: true, itemId: match[1].toLowerCase() };
}

/** A scanned label is either the VSA1 identifier or the garment SKU itself. */
export function readScannedLabel(raw: unknown): ScannedLabel {
  if (typeof raw !== "string") return { ok: false, status: 400, error: QR_MESSAGES.badCode };
  const text = raw.trim();
  if (!text) return { ok: false, status: 400, error: QR_MESSAGES.badCode };
  if (text.toUpperCase().startsWith(`${GARMENT_QR_PREFIX}:`)) {
    const parsed = parseGarmentQr(text);
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
    return { ok: true, kind: "code", itemId: parsed.itemId };
  }
  return { ok: true, kind: "sku", sku: text };
}

export function scanQuery(input: { codigo?: unknown; sku?: unknown }): ScanQuery {
  const codigo = typeof input.codigo === "string" ? input.codigo : "";
  const sku = typeof input.sku === "string" ? input.sku : "";
  if (codigo.trim()) return readScannedLabel(codigo);
  if (sku.trim()) return readScannedLabel(sku);
  return { ok: false, status: 400, error: QR_MESSAGES.needCodeOrSku };
}

export function normalizeScanStatus(value: unknown): string {
  if (value === "disponible" || value === "vendida" || value === "retirada") return value;
  return "desconocido";
}

export function scanSaleDecision(status: string): { canSell: true } | { canSell: false; message: string } {
  if (status === "disponible") return { canSell: true };
  if (status === "vendida") return { canSell: false, message: QR_MESSAGES.sold };
  if (status === "retirada") return { canSell: false, message: QR_MESSAGES.withdrawn };
  return { canSell: false, message: QR_MESSAGES.unavailable };
}

export function scanLotLabel(lotNumber: number | null, lotName: string | null): string {
  if (lotNumber == null) return "Sin lote";
  const name = lotName?.trim() ?? "";
  return name ? `Lote ${lotNumber} · ${name}` : `Lote ${lotNumber}`;
}

export function presentGuatemalaScan(kind: "code" | "sku", rows: ScanGarment[]): ScanLookup {
  if (rows.length === 0) {
    return { ok: false, status: 404, error: kind === "code" ? QR_MESSAGES.unknownCode : QR_MESSAGES.unknownSku };
  }
  if (rows.length === 1) {
    const garment = rows[0];
    return garment ? { ok: true, choice: "one", garment } : { ok: false, status: 404, error: QR_MESSAGES.unknownCode };
  }
  return {
    ok: true,
    choice: "many",
    garments: rows.map((row) => ({ ...row, photo: null })),
  };
}

export function beginScan(lock: ScanLock, code: string): ScanLock | null {
  if (lock.saving || lock.code) return null;
  return { code, saving: false };
}

export function beginSale(lock: ScanLock): ScanLock | null {
  if (!lock.code || lock.saving) return null;
  return { code: lock.code, saving: true };
}

export function releaseScan(): ScanLock {
  return { code: null, saving: false };
}

export function cameraFailureMessage(error: unknown): string {
  const name = typeof error === "object" && error && "name" in error ? String(error.name) : "";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const blob = `${name} ${message}`.toLowerCase();
  if (!blob.trim()) return QR_MESSAGES.cameraFailed;
  if (blob.includes("notallowed") || blob.includes("permission") || blob.includes("denied") || blob.includes("security")) {
    return QR_MESSAGES.cameraDenied;
  }
  if (blob.includes("https") || blob.includes("secure")) return QR_MESSAGES.cameraInsecure;
  if (blob.includes("notfound") || blob.includes("devicesnotfound") || blob.includes("overconstrained") || blob.includes("notreadable")) {
    return QR_MESSAGES.cameraMissing;
  }
  return QR_MESSAGES.cameraFailed;
}

export function cameraMayRetry(error: unknown): boolean {
  const message = cameraFailureMessage(error);
  return message !== QR_MESSAGES.cameraDenied && message !== QR_MESSAGES.cameraInsecure;
}
