import { NextRequest, NextResponse } from "next/server";

import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";

import {

  ebayConnectionKey,

  getEbayConnection,

} from "@/lib/ebay/client-connections";

import { guardApiRequest } from "@/lib/api-guard";
import { fetchAccountSetup, publishListing } from "@/lib/ebay/publish";
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

    const setup = await fetchAccountSetup(accessToken);

const result = await publishListing(accessToken, setup, {

  ...body,

  saveAsDraft: true,

});

return NextResponse.json(

  result,

  { status: result.success ? 200 : 422 }

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
