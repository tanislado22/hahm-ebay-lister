import { describe, expect, test } from "vitest";
import { classifyVintedEmail, extractSoldTitle, htmlToText } from "@/lib/vinted/email";

describe("vinted sale emails", () => {
  test("detects a sale and extracts the item title from the body", () => {
    const result = classifyVintedEmail({
      from: "me@gmail.com",
      subject: "You sold an item on Vinted",
      text: [
        "You sold an item on Vinted",
        "",
        "Levi's 550 Jeans Mens 34x29 Blue Relaxed Fit",
        "",
        "Please ship the item within 5 days.",
      ].join("\n"),
      html: "",
      messageId: "msg-1",
    });
    expect(result).toEqual({
      kind: "sale",
      title: "Levi's 550 Jeans Mens 34x29 Blue Relaxed Fit",
    });
  });

  test("ignores shipping updates and promotions", () => {
    expect(
      classifyVintedEmail({
        from: "no-reply@vinted.com",
        subject: "Your item has been shipped",
        text: "Track your parcel on Vinted.",
        html: "",
        messageId: "msg-2",
      }).kind
    ).toBe("ignore");
    expect(
      classifyVintedEmail({
        from: "no-reply@vinted.com",
        subject: "A special offer just for you",
        text: "Promotion: sellers like you get a discount on Vinted.",
        html: "",
        messageId: "msg-3",
      }).kind
    ).toBe("ignore");
  });

  test("reads a title out of simple html", () => {
    const text = htmlToText("<p>You sold an item on Vinted</p><p>Navy Wool Coat</p>");
    expect(extractSoldTitle("You sold an item on Vinted", text)).toBe("Navy Wool Coat");
  });
});
