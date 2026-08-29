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

} from "@/lib/ebay/publish";
import { suggestLeafCategories } from "@/lib/ebay/taxonomy";
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

      feedType: "FX_LISTING",

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

async function buildDraftCsv(body: any) {



  const listing = body?.listing ?? {};
  const suggestions = await suggestLeafCategories(

  `${listing.category_hint || ""} ${listing.title || ""}`,

  3

);

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
"Duration",
    "Location",
];

  const row = [

  "VerifyAddItem",

  body?.sku ?? "",

  suggestions[0]?.id ?? listing?.category_id ?? "",



  listing?.title ?? "",
"",
  listing?.price ?? body?.price ?? 11,

  1,

 

  imageUrls.join("|"),

  "NEW",

  listing?.description ?? body?.description ?? "Draft listing",

  "FixedPrice",
"GTC",
    "New Bedford, MA",
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

const csvText = await buildDraftCsv(body);



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
