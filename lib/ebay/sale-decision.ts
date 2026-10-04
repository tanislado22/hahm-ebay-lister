export type EbaySaleDecision =
  | { action: "ignore" }
  | { action: "record"; status: "skipped" | "needs_review"; detail: string; sku: string; title: string }
  | { action: "alert"; sku: string; title: string };

export function decideEbaySale(input: {
  cancelled: boolean;
  lookup: "none" | "ambiguous" | "one";
  publishedOnVinted: boolean;
  sku: string;
  title: string;
}): EbaySaleDecision {
  if (input.cancelled) {
    return {
      action: "record",
      status: "skipped",
      detail: "eBay order was cancelled",
      sku: input.sku,
      title: input.title,
    };
  }
  if (input.lookup === "none") return { action: "ignore" };
  if (input.lookup === "ambiguous") {
    return {
      action: "record",
      status: "needs_review",
      detail: "More than one inventory row matches this eBay sale",
      sku: input.sku,
      title: input.title,
    };
  }
  if (!input.publishedOnVinted) {
    return {
      action: "record",
      status: "skipped",
      detail: "SKU is not published on Vinted",
      sku: input.sku,
      title: input.title,
    };
  }
  return { action: "alert", sku: input.sku, title: input.title };
}
