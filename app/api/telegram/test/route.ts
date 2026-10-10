import { NextRequest, NextResponse } from "next/server";
import { secretEqual } from "@/lib/secret";
import { connectionTestMessage } from "@/lib/telegram/message";
import { sendTelegramPlain } from "@/lib/telegram/send";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const alt = (req.headers.get("x-cron-secret") ?? "").trim();
  return (
    (bearer.length > 0 && secretEqual(bearer, expected)) ||
    (alt.length > 0 && secretEqual(alt, expected))
  );
}

function safeClientError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Telegram test failed.";
  const chatId = (process.env.TELEGRAM_CHAT_ID ?? "").trim();
  let safe = message.replace(/bot\d+:[A-Za-z0-9_-]+/gi, "bot[redacted]");
  if (chatId) safe = safe.split(chatId).join("[redacted]");
  return safe.slice(0, 300);
}

async function handle(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim() ?? "";
  if (!token || !chatId) {
    return NextResponse.json({ ok: false, error: "Telegram is not configured." }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const sent = await sendTelegramPlain(connectionTestMessage());
    return NextResponse.json({ ok: true, test: true, messageId: sent.messageId });
  } catch (error) {
    const message = safeClientError(error);
    console.error("[telegram/test]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export function GET(req: NextRequest) {
  return handle(req);
}

export function POST(req: NextRequest) {
  return handle(req);
}
