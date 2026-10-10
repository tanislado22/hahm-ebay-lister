// Sends one connection check to Telegram.
// Run from the project root so the Vercel link can inject Production variables
// without printing them:
//   npx vercel env run -e production -- node scripts/telegram-prod-test.mjs

const text = [
  "✅ CONEXIÓN EXITOSA",
  "🔔 My eBay Vinted Sales",
  "📦 SKU: 2830",
  "🛍️ Plataforma: eBay",
  "🟢 Notificaciones de ventas funcionando correctamente.",
].join("\n");

function hidden(value) {
  return value.replace(/bot\d+:[A-Za-z0-9_-]+/gi, "bot[redacted]");
}

function safe(message, token, chatId) {
  let out = hidden(message);
  if (token) out = out.split(token).join("[redacted]");
  if (chatId) out = out.split(chatId).join("[redacted]");
  return out.slice(0, 300);
}

function usable(value) {
  const clean = (value ?? "").trim();
  return clean.length > 0 && clean !== "[SENSITIVE]";
}

const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
const chatId = process.env.TELEGRAM_CHAT_ID ?? "";

if (!usable(token) || !usable(chatId)) {
  console.log(
    JSON.stringify({
      ok: false,
      error:
        "Production Telegram variables are not available in this process. Run this script with vercel env run -e production.",
      TELEGRAM_BOT_TOKEN: usable(token),
      TELEGRAM_CHAT_ID: usable(chatId),
    })
  );
  process.exit(1);
}

const cleanToken = token.trim();
const cleanChatId = chatId.trim();

let response;
try {
  response = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: cleanChatId,
      text,
      disable_web_page_preview: true,
    }),
  });
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      error: safe(error instanceof Error ? error.message : "request failed", cleanToken, cleanChatId),
    })
  );
  process.exit(1);
}

const data = await response.json().catch(() => null);
if (!response.ok || !data?.ok) {
  const description = typeof data?.description === "string" ? data.description : "Telegram request failed";
  console.log(
    JSON.stringify({
      ok: false,
      status: response.status,
      error: safe(description, cleanToken, cleanChatId),
    })
  );
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, messageId: data.result?.message_id ?? null }));
