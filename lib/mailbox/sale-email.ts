import { classifyVintedEmail, extractSoldTitle, htmlToText, type InboundEmail } from "@/lib/vinted/email";
import { extractDescriptionSkus } from "@/lib/vinted/sale-identity";

export const MAILBOX_CLASSIFIER = "you-just-sold";

export type MailboxPlatform = "vinted" | "poshmark" | "depop";

export type MailboxClassification =
  | { kind: "sale"; platform: MailboxPlatform; title: string }
  | { kind: "ignore"; reason: string };

const POSHMARK_SALE = [
  /you (?:just )?made a sale/i,
  /you just sold/i,
  /your item (?:just )?sold/i,
  /ka-ching/i,
  /congrats,? you sold/i,
];

const DEPOP_SALE = [
  /you just sold/i,
  /you(?:'ve| have) sold/i,
  /your item (?:just )?sold/i,
  /sold! time to ship/i,
];

const NOT_A_SALE = /offer|liked your|price drop|bundle|shipping label|has shipped|refund|question|favorit|mensaje|message from/i;

function attributeText(html: string): string {
  return [...html.matchAll(/\b(?:alt|title)=["']([^"']+)["']/gi)].map((match) => match[1] ?? "").join("\n");
}

/** Subject, plain text, HTML text, and image labels. Whitespace is kept for line parsing. */
export function mailboxVisibleText(email: InboundEmail): string {
  return [email.subject, email.text, htmlToText(email.html || ""), attributeText(email.html || "")].filter(Boolean).join("\n");
}

function flatText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function haystackOf(email: InboundEmail): string {
  return flatText(`${email.from}\n${mailboxVisibleText(email)}`);
}

function statedNetSale(flat: string): boolean {
  const sku = /\bSKU[: \t#]+[A-Za-z0-9]/i.test(flat);
  const earnings = /your earnings|net earnings|you earned/i.test(flat);
  return sku && earnings;
}

function detectPlatform(email: InboundEmail): MailboxPlatform | null {
  const from = email.from || "";
  const haystack = haystackOf(email);
  if (/poshmark\.com/i.test(from)) return "poshmark";
  if (/depop\.com/i.test(from)) return "depop";
  if (/vinted\./i.test(from) || /vinted/i.test(haystack)) return "vinted";
  if (/poshmark/i.test(haystack)) return "poshmark";
  if (/depop/i.test(haystack)) return "depop";
  return null;
}

function classifyNamedSale(
  email: InboundEmail,
  platform: "poshmark" | "depop",
  patterns: RegExp[]
): MailboxClassification {
  const readable = mailboxVisibleText(email);
  const flat = flatText(readable);
  const subject = flatText(email.subject);
  const phrase = patterns.some((pattern) => pattern.test(flat));
  const stated = statedNetSale(flat);
  const subjectIsNoise = NOT_A_SALE.test(subject) && !patterns.some((pattern) => pattern.test(subject));
  if (!phrase && !stated) {
    const sku = extractDescriptionSkus(readable)[0] ?? "";
    const reason = subjectIsNoise
      ? "not a sale: the subject is an offer, a like, or a shipping note"
      : sku
        ? `not a sale: SKU ${sku} is in the received text, but there is no sale phrase or earnings`
        : "not a sale: the received text has no You just sold phrase, SKU, or earnings";
    return { kind: "ignore", reason };
  }
  return { kind: "sale", platform, title: extractSoldTitle(email.subject, readable, patterns) };
}

function fromHost(value: string): string {
  const match = value.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return (match?.[1] ?? "").replace(/^www\./i, "").toLowerCase();
}

function clueAroundSale(flat: string): string {
  const redacted = flat.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
  const at = redacted.search(/you\s+just\s+sold|\bSKU[: \t#]+[A-Za-z0-9]|your earnings|\$\d/i);
  const start = at < 0 ? 0 : Math.max(0, at - 24);
  return redacted.slice(start, start + 90);
}

/** Safe per-email receipt. It does not include the message body, the buyer, or any secret. */
export function mailboxDiagnosis(
  email: InboundEmail,
  classification: MailboxClassification
): Record<string, string | number | boolean> {
  const visible = mailboxVisibleText(email);
  const flat = flatText(visible);
  const skus = extractDescriptionSkus(visible);
  const platform = classification.kind === "sale" ? classification.platform : detectPlatform(email) ?? "";
  return {
    classifier: MAILBOX_CLASSIFIER,
    subject: flatText(email.subject).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").slice(0, 140),
    fromHost: fromHost(email.from),
    platform,
    receivedSku: skus.length === 1 ? skus[0] : "",
    textChars: email.text.length,
    htmlChars: (email.html || "").length,
    sawYouJustSold: /you\s+just\s+sold/i.test(flat),
    sawEarnings: /your earnings|net earnings|you earned/i.test(flat),
    clue: clueAroundSale(flat),
  };
}

export function classifyMailboxEmail(email: InboundEmail): MailboxClassification {
  const platform = detectPlatform(email);
  if (!platform) return { kind: "ignore", reason: "not a supported marketplace email" };
  if (platform === "vinted") {
    const result = classifyVintedEmail(email);
    if (result.kind === "ignore") return result;
    return { kind: "sale", platform: "vinted", title: result.title };
  }
  if (platform === "poshmark") return classifyNamedSale(email, "poshmark", POSHMARK_SALE);
  return classifyNamedSale(email, "depop", DEPOP_SALE);
}
