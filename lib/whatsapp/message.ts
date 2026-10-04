export type SalePlatform = "ebay" | "vinted";

export interface SaleAlert {
  platform: SalePlatform;
  platformLabel: string;
  sku: string;
  title: string;
  warning: string;
}

// WhatsApp template parameters cannot contain newlines or tabs.
export function whatsappParam(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/ {5,}/g, "    ").trim();
}

export function saleAlertMessage(platform: SalePlatform, sku: string, title: string): SaleAlert {
  const warning =
    platform === "ebay"
      ? "Este artículo también está publicado en Vinted. Revisar y eliminarlo de Vinted."
      : "Revisar y eliminar este artículo en eBay.";
  return {
    platform,
    platformLabel: platform === "ebay" ? "EBAY" : "VINTED",
    sku: whatsappParam(sku),
    title: whatsappParam(title),
    warning,
  };
}
