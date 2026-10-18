export const STORE_APEX_HOST = "variedadessanandres.com";
export const STORE_WWW_HOST = "www.variedadessanandres.com";

export type StoreDecision =
  | { kind: "app" }
  | { kind: "redirect"; hostname: string; pathname: string }
  | { kind: "rewrite"; pathname: string }
  | { kind: "public" }
  | { kind: "hidden" };

export function storeHostname(host: string | null | undefined): string {
  return (host ?? "").split(":")[0].trim().toLowerCase();
}

export function isStoreHostname(host: string | null | undefined): boolean {
  const name = storeHostname(host);
  return name === STORE_APEX_HOST || name === STORE_WWW_HOST;
}

export function decideStoreRequest(host: string | null | undefined, pathname: string): StoreDecision {
  const name = storeHostname(host);
  if (name === STORE_APEX_HOST) return { kind: "redirect", hostname: STORE_WWW_HOST, pathname };
  if (name !== STORE_WWW_HOST) return { kind: "app" };
  if (pathname === "/") return { kind: "rewrite", pathname: "/tienda" };
  if (pathname === "/prenda" || pathname.startsWith("/prenda/")) {
    return { kind: "rewrite", pathname: `/tienda${pathname}` };
  }
  if (pathname === "/tienda" || pathname.startsWith("/tienda/")) return { kind: "public" };
  if (isPublicStoreApi(pathname)) return { kind: "public" };
  if (pathname.startsWith("/api/")) return { kind: "hidden" };
  return { kind: "redirect", hostname: STORE_WWW_HOST, pathname: "/" };
}

export function isPublicStoreApi(pathname: string): boolean {
  return /^\/api\/markets\/guatemala\/catalog(?:\/foto\/[^/]+|\/[^/]+)?\/?$/.test(pathname);
}
