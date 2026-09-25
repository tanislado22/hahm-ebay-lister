import { NextRequest, NextResponse } from "next/server";

import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";

import {

  ebayConnectionKey,

  getEbayConnection,

} from "@/lib/ebay/client-connections";

import { guardApiRequest } from "@/lib/api-guard";
import {

  fetchAccountSetup,

  publishListing,

  normalizeConditionInput,

  conditionIdsForGrade,
  buildAspects,
defaultPackageWeightAndSize,
} from "@/lib/ebay/publish";
import {

  suggestLeafCategories,

  acceptedConditionIds,

  categoryAspects,

} from "@/lib/ebay/taxonomy";
import { acceptedLabelSize, matchAllowed, sanitizeCategorySizes } from "@/lib/ebay/aspects";
import type { AspectMeta } from "@/lib/ebay/taxonomy";
const EBAY_FEED_BASE = "https://api.ebay.com/sell/feed/v1";
async function createDraftFeedTask(accessToken: string) {

  const resp = await fetch(`${EBAY_FEED_BASE}/task`, {

    method: "POST",

    headers: {

      Authorization: `Bearer ${accessToken}`,

      "Content-Type": "application/json",

      Accept: "application/json",

      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",

    },

    body: JSON.stringify({

      feedType: "FX_DRAFT",

      schemaVersion: "1.0",

    }),

  });

  const text = await resp.text();

  if (!resp.ok) {

    throw new Error(

      `eBay create feed task failed (${resp.status}): ${text}`

    );

  }

  const location = resp.headers.get("location");

  if (!location) {

    throw new Error("eBay did not return a feed task Location header.");

  }

  const taskId = location.split("/").filter(Boolean).pop();

  if (!taskId) {

    throw new Error("Could not read the eBay feed task ID.");

  }

  return taskId;

}

async function getDraftFeedTask(accessToken: string, taskId: string) {

  const resp = await fetch(`${EBAY_FEED_BASE}/task/${taskId}`, {

    method: "GET",

    headers: {

      Authorization: `Bearer ${accessToken}`,

      Accept: "application/json",

      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",

    },

  });

  const text = await resp.text();

  if (!resp.ok) {

    throw new Error(

      `eBay get feed task failed (${resp.status}): ${text}`

    );

  }

  return text ? JSON.parse(text) : {};

}

async function getDraftFeedResultFile(

  accessToken: string,

  taskId: string

) {

  const resp = await fetch(

    `${EBAY_FEED_BASE}/task/${taskId}/download_result_file`,

    {

      method: "GET",

      headers: {

        Authorization: `Bearer ${accessToken}`,

        Accept: "*/*",

        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",

      },

    }

  );

  const buffer = await resp.arrayBuffer();

  if (!resp.ok) {

    const text = new TextDecoder().decode(buffer);

    throw new Error(

      `eBay get result file failed (${resp.status}): ${text}`

    );

  }

  return Buffer.from(buffer);

}

export const maxDuration = 300;
async function uploadDraftFeedFile(

  accessToken: string,

  taskId: string,

  csvText: string

) {

  const formData = new FormData();

  const file = new Blob([csvText], {

    type: "text/csv",

  });

  formData.append("file", file, "draft-listing.csv");

  const resp = await fetch(

    `${EBAY_FEED_BASE}/task/${taskId}/upload_file`,

    {

      method: "POST",

      headers: {

        Authorization: `Bearer ${accessToken}`,

        Accept: "application/json",

      },

      body: formData,

    }

  );

  const text = await resp.text();

  if (!resp.ok) {

    throw new Error(

      `eBay upload feed file failed (${resp.status}): ${text}`

    );

  }

  return text ? JSON.parse(text) : {};

}

function csvEscape(value: unknown) {

  const text = String(value ?? "");

  if (text.includes('"') || text.includes(",") || text.includes("\n")) {

    return `"${text.replace(/"/g, '""')}"`;

  }

  return text;

}

const LABEL_FRACTION_SIZE_RE = /^\d{1,2}\s*\/\s*\d{1,2}$/;

function alignAudienceAspects(
  aspects: Record<string, string[]>,
  meta: AspectMeta[],
  categoryName: string
): void {
  const name = categoryName.toLowerCase();
  const prefer = /\bgirls?\b/.test(name)
    ? ["Girls", "Unisex Kids", "Kids"]
    : /\bboys?\b/.test(name)
      ? ["Boys", "Unisex Kids", "Kids"]
      : /\bkids?|youth|children|child\b/.test(name)
        ? ["Unisex Kids", "Girls", "Boys", "Kids"]
        : /\bwomen|ladies\b/.test(name)
          ? ["Women", "Women's"]
          : [];
  if (!prefer.length) return;
  for (const aspectName of ["Department", "Gender"]) {
    const aspect = meta.find((a) => a.name.toLowerCase() === aspectName.toLowerCase());
    if (!aspect?.values.length) continue;
    const current = aspects[aspectName]?.[0] || "";
    if (current && matchAllowed(current, aspect.values)) continue;
    for (const candidate of prefer) {
      const matched = matchAllowed(candidate, aspect.values);
      if (!matched) continue;
      aspects[aspectName] = [matched];
      break;
    }
  }
}

async function buildDraftCsv(body: any, accessToken: string) {
  const listing = body?.listing ?? {};
  await fetchAccountSetup(accessToken);
  const catKey = String(listing.category || "other");
  const aspects = buildAspects(listing, catKey);
  const labelSize = String(listing.size || aspects.Size?.[0] || "").trim();
  const fractionSize = LABEL_FRACTION_SIZE_RE.test(labelSize);

  const baseQuery = `${listing.category_hint || ""} ${listing.title || ""}`.trim();
  const suggestions = await suggestLeafCategories(baseQuery, fractionSize ? 5 : 3);
  let candidates = suggestions;
  if (fractionSize) {
    const garment = String(
      listing.item_type || listing.title || listing.category_hint || "clothing"
    ).trim();
    const extras = await Promise.all(
      ["girls", "kids", "boys", "women"].map((dept) =>
        suggestLeafCategories(`${dept} ${garment}`, 3)
      )
    );
    const seen = new Set<string>();
    candidates = [];
    for (const candidate of [...suggestions, ...extras.flat()]) {
      if (!candidate?.id || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      candidates.push(candidate);
    }
  }

  let categoryId = "";
  let categoryName = "";
  let sizeMeta: AspectMeta[] = [];

  if (fractionSize) {
    for (const candidate of candidates) {
      let meta: AspectMeta[] = [];
      try {
        meta = await categoryAspects(candidate.id);
      } catch {
        meta = [];
      }
      const formatted = acceptedLabelSize(meta, labelSize);
      if (!formatted) continue;
      categoryId = candidate.id;
      categoryName = candidate.name;
      sizeMeta = meta;
      aspects.Size = [formatted];
      break;
    }
  }

  if (!categoryId) {
    categoryId = candidates[0]?.id ?? listing?.category_id ?? "";
    categoryName = candidates[0]?.name ?? "";
    if (categoryId) {
      try {
        sizeMeta = await categoryAspects(categoryId);
      } catch {
        sizeMeta = [];
      }
    }
  }

  if (fractionSize && categoryName) {
    alignAudienceAspects(aspects, sizeMeta, categoryName);
  }

  const acceptedConds = await acceptedConditionIds(categoryId, accessToken);
  const conditionId =
    conditionIdsForGrade(normalizeConditionInput(listing.condition), acceptedConds, catKey)[0] ??
    3000;

  const droppedSizes = sanitizeCategorySizes(aspects, sizeMeta);
  if (droppedSizes.length) {
    console.warn(
      `[ebay/draft] dropped size value(s) that are not valid for category ${categoryId || catKey}: ${droppedSizes.join(", ")}`
    );
  }
  if (fractionSize && !aspects.Size?.some((v) => String(v || "").trim())) {
    aspects.Size = [labelSize.replace(/\s*\/\s*/, "/")];
  }

// Seller Hub / File Exchange maps item specifics from `C:` columns. The
// generic "Attribute Name N" pairs often never land in Size/Color/Gender.
const CORE_ASPECT_ORDER = [
  "Brand",
  "Type",
  "Department",
  "Gender",
  "Size Type",
  "Size",
  "Color",
  "Material",
];
const coreNames = new Set(CORE_ASPECT_ORDER);
const extraAspectEntries = Object.entries(aspects).filter(
  ([name, values]) =>
    !coreNames.has(name) && Array.isArray(values) && values.some((v) => String(v || "").trim())
);

function aspectCell(name: string): string {
  const values = aspects[name];
  return Array.isArray(values)
    ? values.filter((v) => String(v || "").trim()).join("|")
    : "";
}

  const imageUrls = Array.isArray(body?.imageUrls) ? body.imageUrls : [];
const headers = [

  "Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)",

  "Custom label (SKU)",

  "Category ID",

  "Title",

  "UPC",

  "Price",

  "Quantity",

  "Item photo URL",

  "Condition ID",

  "Description",

  "Format",
  ...CORE_ASPECT_ORDER.map((name) => `C:${name}`),
  ...extraAspectEntries.map(([name]) => `C:${name}`),
];

const row = [

 "Draft",

  body?.sku ?? "",

  categoryId,

  listing?.title ?? "",

  "",

  listing?.suggested_price ?? listing?.price ?? body?.price ?? 11,

  1,

  imageUrls.join("|"),

  conditionId,

  listing?.description ?? body?.description ?? "Draft listing",

  "FixedPrice",
  ...CORE_ASPECT_ORDER.map(aspectCell),
  ...extraAspectEntries.map(([, values]) =>
    Array.isArray(values) ? values.filter((v) => String(v || "").trim()).join("|") : ""
  ),
];

  return [

  "#INFO,Version=0.0.2,Template= eBay-draft-listings-template_US",

  "#INFO Action and Category ID are required fields.",

  "#INFO After you've successfully uploaded your draft, complete the listing in Seller Hub.",

  "#INFO",

  headers.map(csvEscape).join(","),

  row.map(csvEscape).join(","),

].join("\n");

}
export async function POST(req: NextRequest) {

  const denied = guardApiRequest(req);

  if (denied) return denied;

  try {

    const body = await req.json();

    if (!body?.sku || !body?.listing) {

      return NextResponse.json(

        {

          success: false,

          error: "Missing SKU or listing.",

        },

        { status: 400 }

      );

    }

    let accessToken: string | null = null;

    const workMode = body.workMode ?? "store";

    if (workMode === "client") {

      const connectionKey = ebayConnectionKey(

        "client",

        body.clientId ?? null

      );

      if (!connectionKey) {

        throw new Error("Select a client before creating a draft.");

      }

      const sealedConnection = await getEbayConnection(connectionKey);

      if (!sealedConnection) {

        throw new Error(

          "Selected client is not connected to eBay."

        );

      }

      accessToken = await accessTokenFromCookie(sealedConnection);

    } else {

      const sealedConnection = req.cookies.get(EBAY_COOKIE)?.value;

      accessToken = await accessTokenFromCookie(sealedConnection);

    }

    if (!accessToken) {

      return NextResponse.json(

        {

          success: false,

          error: "eBay isn't connected. Connect the account and try again.",

        },

        { status: 401 }

      );

    }

   const taskId = await createDraftFeedTask(accessToken);

const csvText = await buildDraftCsv(body, accessToken);



await uploadDraftFeedFile(accessToken, taskId, csvText);
    let task = await getDraftFeedTask(accessToken, taskId);

for (let i = 0; i < 10; i++) {

  if (

    task?.status === "COMPLETED" ||

    task?.status === "COMPLETED_WITH_ERROR"

  ) {

    break;

  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  task = await getDraftFeedTask(accessToken, taskId);

}

console.log("EBAY DRAFT TASK RESULT:", JSON.stringify(task));
    if (
task?.status === "COMPLETED" ||
  task?.status === "COMPLETED_WITH_ERROR" ||

  task?.uploadSummary?.failureCount > 0

) {

  const resultBuffer = await getDraftFeedResultFile(accessToken, taskId);

  const resultText = resultBuffer.toString("utf8");

  console.log("EBAY DRAFT ERROR FILE:", resultText);

}

return NextResponse.json(

  {

    success: true,

    taskId,

    message: "Draft feed uploaded to eBay.",

  },

  { status: 200 }

);



  } catch (e) {

    console.error("[ebay/draft] error", e);

    return NextResponse.json(

      {

        success: false,

        error: (e as Error).message,

      },

      { status: 500 }

    );

  }

}
