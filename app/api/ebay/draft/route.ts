import { NextRequest, NextResponse } from "next/server";

import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";

import {

  ebayConnectionKey,

  getEbayConnection,

} from "@/lib/ebay/client-connections";

import { guardApiRequest } from "@/lib/api-guard";
import { fetchAccountSetup, publishListing } from "@/lib/ebay/publish";


export const maxDuration = 300;

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
