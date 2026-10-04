import { saleAlertMessage, type SaleAlert, type SalePlatform } from "./message";

interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  recipient: string;
  templateName: string;
  templateLang: string;
}

function configFromEnv(): WhatsAppConfig {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim() ?? "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
  const recipient = (process.env.WHATSAPP_RECIPIENT ?? "").replace(/\D/g, "");
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME?.trim() ?? "";
  const templateLang = process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "es";
  if (!token || !phoneNumberId || !recipient || !templateName) {
    throw new Error(
      "WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_RECIPIENT, and WHATSAPP_TEMPLATE_NAME."
    );
  }
  return { token, phoneNumberId, recipient, templateName, templateLang };
}

export async function sendSaleWhatsApp(alert: SaleAlert): Promise<void> {
  if (!alert.sku || !alert.title) {
    throw new Error("WhatsApp alert is missing the SKU or title.");
  }
  const cfg = configFromEnv();
  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: cfg.recipient,
      type: "template",
      template: {
        name: cfg.templateName,
        language: { code: cfg.templateLang },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: alert.platformLabel },
              { type: "text", text: alert.sku },
              { type: "text", text: alert.title },
              { type: "text", text: alert.warning },
            ],
          },
        ],
      },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`WhatsApp request failed (${resp.status}): ${text.slice(0, 300)}`);
  }
}

export async function sendPlatformSaleAlert(
  platform: SalePlatform,
  sku: string,
  title: string
): Promise<void> {
  await sendSaleWhatsApp(saleAlertMessage(platform, sku, title));
}
