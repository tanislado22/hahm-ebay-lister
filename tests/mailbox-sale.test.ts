import { describe, expect, test } from "vitest";
import { classifyMailboxEmail, mailboxDiagnosis } from "@/lib/mailbox/sale-email";

const NEW_DATE = "2026-10-11T15:00:00.000Z";

describe("marketplace sale emails", () => {
  test("recognizes the Poshmark email that says You just sold", () => {
    expect(
      classifyMailboxEmail({
        from: "no-reply@poshmark.com",
        subject: "You just sold an item",
        text: "You just sold an item\n\nBlue Shirt\nSKU 3053\nPrice $8\nYour earnings $5.05\n",
        html: "",
        messageId: "posh-3053",
        date: NEW_DATE,
      })
    ).toMatchObject({ kind: "sale", platform: "poshmark", title: "Blue Shirt" });
  });

  test("reports why a Poshmark message was ignored without including the body", () => {
    const email = {
      from: "Poshmark <news@poshmark.com>",
      subject: "Someone liked your item",
      text: "Your listing is getting attention.",
      html: "<p>Secret buyer@example.com</p>",
      messageId: "liked-1",
      date: NEW_DATE,
    };
    const classification = classifyMailboxEmail(email);
    expect(classification.kind).toBe("ignore");
    const diagnosis = mailboxDiagnosis(email, classification);
    expect(diagnosis).toMatchObject({
      classifier: "you-just-sold",
      subject: "Someone liked your item",
      fromHost: "poshmark.com",
      platform: "poshmark",
      receivedSku: "",
      sawYouJustSold: false,
    });
    expect(JSON.stringify(diagnosis)).not.toContain("buyer@example.com");
    expect(String(diagnosis.clue).length).toBeLessThanOrEqual(90);
  });

  test("a split You just sold line and SKU 3053 still count as the sale", () => {
    const email = {
      from: "no-reply@poshmark.com",
      subject: "Update",
      text: "",
      html: "<div>You just</div><div>sold</div><p>SKU 3053</p><p>Price $8</p><p>Your earnings $5.05</p>",
      messageId: "posh-3053-html",
      date: NEW_DATE,
    };
    expect(classifyMailboxEmail(email)).toMatchObject({ kind: "sale", platform: "poshmark" });
    expect(mailboxDiagnosis(email, classifyMailboxEmail(email))).toMatchObject({
      receivedSku: "3053",
      sawYouJustSold: true,
      sawEarnings: true,
      htmlChars: email.html.length,
    });
  });

  test("recognizes a Poshmark sale and ignores an offer", () => {
    expect(
      classifyMailboxEmail({
        from: "support@poshmark.com",
        subject: "You made a sale!",
        text: "You made a sale!\n\nNavy Wool Coat\n",
        html: "",
        messageId: "p1",
        date: NEW_DATE,
      })
    ).toEqual({ kind: "sale", platform: "poshmark", title: "Navy Wool Coat" });

    expect(
      classifyMailboxEmail({
        from: "support@poshmark.com",
        subject: "You received an offer",
        text: "Someone made an offer on your listing.",
        html: "",
        messageId: "p2",
        date: NEW_DATE,
      }).kind
    ).toBe("ignore");
  });

  test("recognizes a Depop sale and ignores a like", () => {
    expect(
      classifyMailboxEmail({
        from: "no-reply@depop.com",
        subject: "You've sold an item",
        text: "You've sold an item\n\nBlue Denim Jacket\n",
        html: "",
        messageId: "d1",
        date: NEW_DATE,
      })
    ).toEqual({ kind: "sale", platform: "depop", title: "Blue Denim Jacket" });

    expect(
      classifyMailboxEmail({
        from: "no-reply@depop.com",
        subject: "Someone liked your item",
        text: "Your listing is getting attention on Depop.",
        html: "",
        messageId: "d2",
        date: NEW_DATE,
      }).kind
    ).toBe("ignore");
  });

  test("does not treat a Vinted shipping label as a sale", () => {
    expect(
      classifyMailboxEmail({
        from: "no-reply@vinted.com",
        subject: "Your USPS shipping label and sale confirmation",
        text: "Your shipping label is ready.",
        html: "",
        messageId: "v-label",
        date: NEW_DATE,
      }).kind
    ).toBe("ignore");
  });

  test("does not treat a Vinted shipping email as a sale", () => {
    expect(
      classifyMailboxEmail({
        from: "no-reply@vinted.com",
        subject: "Your item has been shipped",
        text: "Track your parcel on Vinted.",
        html: "",
        messageId: "v1",
        date: NEW_DATE,
      }).kind
    ).toBe("ignore");
  });
});
