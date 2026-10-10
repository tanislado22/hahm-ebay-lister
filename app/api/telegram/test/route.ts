import { NextRequest, NextResponse } from "next/server";
import { secretEqual } from "@/lib/secret";
import type { SalePlatform } from "@/lib/telegram/message";
import { sendTelegramSale } from "@/lib/telegram/send";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SAMPLE_TITLE = "Levi’s 550 Men’s Relaxed Fit Jeans";
const SAMPLE_SKU = "2830";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const alt = req.headers.get("x-cron-secret") ?? "";
  return secretEqual(bearer, secret) || secretEqual(alt, secret);
}

function asPlatform(value: unknown): SalePlatform | null {
  if (value === "ebay" || value === "vinted") return value;
  if (value == null || value === "") return "ebay";
  return null;
}

function clip(value: unknown, fallback: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

async function readInput(req: NextRequest): Promise<
  | { platform: SalePlatform; sku: string; title: string }
  | { error: string }
> {
  const fromQuery = {
    platform: asPlatform(req.nextUrl.searchParams.get("platform")),
    sku: clip(req.nextUrl.searchParams.get("sku"), SAMPLE_SKU, 40),
    title: clip(req.nextUrl.searchParams.get("title"), SAMPLE_TITLE, 180),
  };
  if (!fromQuery.platform) return { error: "Platform must be ebay or vinted." };

  if (req.method === "GET") return { platform: fromQuery.platform, sku: fromQuery.sku, title: fromQuery.title };

  const raw = await req.text();
  if (!raw.trim()) return { platform: fromQuery.platform, sku: fromQuery.sku, title: fromQuery.title };

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "Invalid request." };
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return { error: "Invalid request." };
  }

  const platform = asPlatform(body.platform ?? fromQuery.platform);
  if (!platform) return { error: "Platform must be ebay or vinted." };
  return {
    platform,
    sku: clip(body.sku, fromQuery.sku, 40),
    title: clip(body.title, fromQuery.title, 180),
  };
}

async function handle(req: NextRequest) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return NextResponse.json({ ok: false, error: "Telegram is not configured." }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const input = await readInput(req);
  if ("error" in input) {
    return NextResponse.json({ ok: false, error: input.error }, { status: 400 });
  }

  try {
    const sent = await sendTelegramSale(input.platform, input.sku, input.title);
    return NextResponse.json({
      ok: true,
      test: true,
      platform: input.platform,
      sku: input.sku,
      title: input.title,
      messageId: sent.messageId,
    });
  } catch (error) {
    console.error("[telegram/test]", error);
    return NextResponse.json({ ok: false, error: "Telegram test failed." }, { status: 502 });
  }
}

export function GET(req: NextRequest) {
  return handle(req);
}

export function POST(req: NextRequest) {
  return handle(req);
}
