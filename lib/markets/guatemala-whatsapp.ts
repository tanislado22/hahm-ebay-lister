import { STORE_WWW_HOST } from "@/lib/markets/store-host";

export const GUATEMALA_WHATSAPP_PHONE = "50232672767";
export const GUATEMALA_WHATSAPP_DISPLAY = "+502 32672767";
export const GUATEMALA_ARTICLE_WHATSAPP_LABEL = "Consultar por WhatsApp";
export const GUATEMALA_CATALOG_WHATSAPP_LABEL = `WhatsApp ${GUATEMALA_WHATSAPP_DISPLAY}`;
export const GUATEMALA_CATALOG_WHATSAPP_MESSAGE = "Hola, quisiera información sobre la ropa disponible";

export function catalogRequestOrigin(host: string | null | undefined, proto: string | null | undefined): string {
  const hostname = (host ?? "").split(",")[0]?.trim() ?? "";
  if (!hostname) return `https://${STORE_WWW_HOST}`;
  const name = hostname.split(":")[0]?.toLowerCase() ?? "";
  const forwarded = (proto ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  const scheme = forwarded === "http" || forwarded === "https"
    ? forwarded
    : name === "localhost" || name === "127.0.0.1" ? "http" : "https";
  return `${scheme}://${hostname}`;
}

export function publicArticleUrl(origin: string, storefront: boolean, id: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}${storefront ? "/prenda/" : "/tienda/prenda/"}${encodeURIComponent(id)}`;
}

export function guatemalaArticleWhatsappMessage(item: {
  title: string;
  sku: string;
  priceGtq: string;
  publicUrl: string;
}): string {
  const title = item.title.trim() ? item.title.trim() : "Prenda sin título";
  return `Hola, me interesa este artículo: ${title}. SKU: ${item.sku}. Precio: Q${item.priceGtq}. Enlace: ${item.publicUrl}`;
}

// Opens WhatsApp with the text ready to review. The visitor sends it themselves.
export function guatemalaWhatsappUrl(message: string): string {
  return `https://wa.me/${GUATEMALA_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
}
