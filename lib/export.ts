import type { ItemGroup, ListingResult } from "@/lib/types";

function priceNumber(value: ListingResult["suggested_price"]): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return n === undefined || Number.isNaN(n) ? "" : n.toFixed(2);
}

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  // Always quote and escape embedded quotes so commas/newlines stay safe.
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS: { header: string; get: (l: ListingResult) => string }[] = [
  { header: "Title", get: (l) => l.title ?? "" },
  { header: "Suggested Price", get: (l) => priceNumber(l.suggested_price) },
  { header: "Condition", get: (l) => (l.condition ?? "").replace(/_/g, " ") },
  { header: "Brand", get: (l) => l.brand ?? "" },
  { header: "Item Type", get: (l) => l.item_type ?? "" },
  {
    header: "Color",
    get: (l) => (Array.isArray(l.color) ? l.color.join(", ") : l.color ?? ""),
  },
  { header: "Size", get: (l) => l.size ?? "" },
  { header: "Material", get: (l) => l.material ?? "" },
  { header: "Category Hint", get: (l) => l.category_hint ?? "" },
  { header: "Description", get: (l) => l.description ?? "" },
  {
    header: "Keywords",
    get: (l) => (l.seo_keywords ?? []).join(", "),
  },
];

// A general-purpose spreadsheet of all finished listings. Not eBay File
// Exchange format (that's category-specific) — a clean starting point you can
// open in Numbers/Excel or adapt.
export function listingsToCsv(
  groups: ItemGroup[],
  pictureUrlsBySku: Record<string, string[]> = {},
): string {
  const done = groups.filter((g) => g.listing);

  const infoRow = "Info,Version=1.0.0,Template=fx_category_template_EBAY_US";

  const headers = [
    "*Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)",
    "CustomLabel",
    "*Category",
    "*Title",
    "*ConditionID",
    "*C:Brand",
    "*C:Style",
    "*C:Color",
    "*C:Department",
    "*C:Size Type",
    "*C:Size",
    "C:Material",
    "PicURL",
    "*Description",
    "*Format",
    "*Duration",
    "*StartPrice",
    "*Quantity",
  ];

  const rows = done.map((g) => {
    const l = g.listing as ListingResult;
    const colors = Array.isArray(l.color) ? l.color.join(", ") : l.color ?? "";
    const photoUrls = pictureUrlsBySku[g.sku] ?? [];

    return [
      csvCell("Add"),
      csvCell(g.sku),
      csvCell("11555"),
      csvCell(l.title ?? ""),
      csvCell("3000"),
      csvCell(l.brand ?? "Unbranded"),
      csvCell(l.item_type ?? "Shorts"),
      csvCell(colors),
      csvCell("Women"),
      csvCell("Regular"),
      csvCell(l.size ?? ""),
      csvCell(l.material ?? ""),
      csvCell(photoUrls.join("|")),
      csvCell(l.description ?? ""),
      csvCell("FixedPrice"),
      csvCell("GTC"),
      csvCell(priceNumber(l.suggested_price)),
      csvCell("1"),
    ].join(",");
  });

  return [infoRow, headers.join(","), ...rows].join("\r\n");
}

export function listingsToJson(groups: ItemGroup[]): string {
  const payload = groups
    .filter((g) => g.listing)
    .map((g) => ({ sku: g.sku, folder: g.name, ...g.listing }));
  return JSON.stringify(payload, null, 2);
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
