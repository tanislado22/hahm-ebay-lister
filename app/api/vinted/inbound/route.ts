import { NextRequest, NextResponse } from "next/server";
import { secretEqual } from "@/lib/secret";
import type { InboundEmail } from "@/lib/vinted/email";
import { handleVintedSaleEmail } from "@/lib/vinted/handle-inbound";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface PostmarkHeader {
  Name?: string;
  Value?: string;
}

interface PostmarkInbound {
  From?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  MessageID?: string;
  Headers?: PostmarkHeader[];
}

function authorized(req: NextRequest): boolean {
  const user = process.env.VINTED_INBOUND_USER ?? "";
  const password = process.env.VINTED_INBOUND_PASSWORD ?? "";
  if (!user || !password) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const split = decoded.indexOf(":");
  if (split < 0) return false;
  return secretEqual(decoded.slice(0, split), user) && secretEqual(decoded.slice(split + 1), password);
}

function headerValue(headers: PostmarkHeader[] | undefined, name: string): string {
  const found = headers?.find((header) => header.Name?.toLowerCase() === name.toLowerCase());
  return found?.Value?.trim() ?? "";
}

export async function POST(req: NextRequest) {
  if (!process.env.VINTED_INBOUND_USER || !process.env.VINTED_INBOUND_PASSWORD) {
    return NextResponse.json({ ok: false, error: "Inbound email is not configured." }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let payload: PostmarkInbound;
  try {
    payload = (await req.json()) as PostmarkInbound;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const email: InboundEmail = {
    from: payload.From ?? "",
    subject: payload.Subject ?? "",
    text: payload.TextBody ?? "",
    html: payload.HtmlBody ?? "",
    messageId: (payload.MessageID ?? "").trim() || headerValue(payload.Headers, "Message-ID"),
  };

  try {
    const result = await handleVintedSaleEmail(email);
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (error) {
    console.error("[vinted/inbound]", error);
    return NextResponse.json({ ok: false, error: "Could not process the email." }, { status: 500 });
  }
}
