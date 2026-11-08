export const STAFF_APP_NAME = "Variedades San Andrés";
export const STAFF_APP_SHORT_NAME = "San Andrés";
export const STAFF_APP_START = "/guatemala/entrada";
export const STAFF_APP_SCOPE = "/guatemala/";
export const STAFF_OFFLINE_URL = "/guatemala/sin-conexion.html";

export const STAFF_OFFLINE_NOTICE =
  "No hay internet. No se puede consultar el inventario ni registrar ventas hasta que vuelva la conexión.";
export const STAFF_SALE_OFFLINE = "No hay internet. La venta no se guardó.";
export const STAFF_SALE_NOT_SAVED = "No se pudo registrar la venta. No quedó guardada.";
export const STAFF_IOS_INSTALL =
  "En iPhone o iPad, abre esta página en Safari. Pulsa Compartir y elige Agregar a inicio. El acceso abre la entrada del personal y conserva la sesión.";
export const STAFF_MANUAL_INSTALL =
  "Si el navegador puede instalarla, confirma la ventana de instalación. Si no aparece, abre el menú del navegador y elige Instalar aplicación o Agregar a inicio.";
export const STAFF_UPDATE_NOTICE = "Hay una actualización. Recarga la aplicación para usarla.";

export type InstallSurface = "installed" | "prompt" | "ios" | "manual";
export type StaffFetchPlan = "passthrough" | "network-only" | "network-or-offline";

export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  if (/iphone|ipad|ipod/i.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

export function installSurface(input: {
  standalone: boolean;
  ios: boolean;
  canPrompt: boolean;
}): InstallSurface {
  if (input.standalone) return "installed";
  if (input.canPrompt) return "prompt";
  if (input.ios) return "ios";
  return "manual";
}

export function saleMayBeSubmitted(online: boolean): { ok: true } | { ok: false; error: string } {
  if (!online) return { ok: false, error: STAFF_SALE_OFFLINE };
  return { ok: true };
}

export function acceptedSaleUpdate<T extends { sale?: unknown }>(
  responseOk: boolean,
  body: { ok?: boolean; item?: T } | null | undefined
): T | null {
  if (!responseOk || !body?.ok || !body.item || body.item.sale == null) return null;
  return body.item;
}

// Private pages and APIs stay on the network. A failed navigation can show only
// the static offline notice, never a stored inventory or sale.
export function staffFetchPlan(input: {
  method: string;
  pathname: string;
  navigation: boolean;
}): StaffFetchPlan {
  if (input.method !== "GET") return "passthrough";
  if (input.pathname.startsWith("/api/")) return "network-only";
  if (!input.pathname.startsWith(STAFF_APP_SCOPE)) return "passthrough";
  if (input.navigation) return "network-or-offline";
  return "network-only";
}
