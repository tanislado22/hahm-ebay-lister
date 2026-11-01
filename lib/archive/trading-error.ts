import { isEbayConfigured } from "@/lib/ebay/config";
import { decodeXml } from "@/lib/archive/text";

const AUTH_CODES = new Set(["931", "17470", "21916984", "21917053", "16110"]);
const LIMIT_CODES = new Set(["518", "18000"]);

export function missingEbayConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.EBAY_CLIENT_ID) missing.push("EBAY_CLIENT_ID (App ID)");
  if (!process.env.EBAY_CLIENT_SECRET) missing.push("EBAY_CLIENT_SECRET (Cert ID)");
  if (!process.env.EBAY_RU_NAME) missing.push("EBAY_RU_NAME");
  if (!process.env.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (!process.env.DATABASE_URL && !process.env.STORAGE_DATABASE_URL) missing.push("DATABASE_URL");
  if (!isEbayConfigured() && missing.length === 0) missing.push("EBAY_CLIENT_ID, EBAY_CLIENT_SECRET y EBAY_RU_NAME");
  return missing;
}

export function tradingErrorInfo(xml: string): { code: string; message: string } {
  const code = xml.match(/<ErrorCode>([^<]+)<\/ErrorCode>/i)?.[1]?.trim() ?? "";
  const longMessage = xml.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/i)?.[1] ?? "";
  const shortMessage = xml.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/i)?.[1] ?? "";
  return { code, message: decodeXml(longMessage || shortMessage).slice(0, 500) };
}

export function classifyTradingProblem(
  status: number,
  xml: string
): { retryable: boolean; config: boolean; message: string; missing: string[] } {
  const info = tradingErrorInfo(xml);
  const code = info.code;
  const ebayText = [code && `código ${code}`, info.message].filter(Boolean).join(": ");
  if (status === 429 || status === 503 || status === 504 || LIMIT_CODES.has(code)) {
    return {
      retryable: true,
      config: false,
      message: `eBay pidió esperar${ebayText ? ` (${ebayText})` : ""}. La importación quedó incompleta. No se marcó ningún anuncio como vendido o finalizado.`,
      missing: [],
    };
  }
  if (status === 401 || status === 403 || AUTH_CODES.has(code) || /scope|not authorized|auth token|iaf token/i.test(info.message)) {
    return {
      retryable: false,
      config: true,
      message: ebayText
        ? `eBay rechazó la lectura. ${ebayText}`
        : "eBay rechazó la lectura del inventario.",
      missing: [
        "Cuenta de eBay conectada",
        "Permiso de solo lectura para GetMyeBaySelling, GetItem y GetUser. Si el token es viejo, vuelve a conectar la cuenta. La importación no crea ni modifica anuncios.",
      ],
    };
  }
  if (status >= 500 || status === 0) {
    return {
      retryable: true,
      config: false,
      message: `eBay no respondió${ebayText ? ` (${ebayText})` : ""}. Se puede continuar la misma importación.`,
      missing: [],
    };
  }
  return {
    retryable: false,
    config: false,
    message: ebayText || `eBay respondió ${status}.`,
    missing: [],
  };
}

export function configError(missing: string[]): string {
  return `Falta configuración: ${missing.join("; ")}.`;
}
