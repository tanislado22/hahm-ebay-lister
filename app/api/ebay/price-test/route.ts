import { NextRequest, NextResponse } from "next/server";

async function getApplicationToken() {

  const clientId = process.env.EBAY_CLIENT_ID;

  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {

    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");

  }

  const credentials = Buffer.from(

    `${clientId}:${clientSecret}`

  ).toString("base64");

  const body = new URLSearchParams({

    grant_type: "client_credentials",

    scope: "https://api.ebay.com/oauth/api_scope",

  });

  const response = await fetch(

    "https://api.ebay.com/identity/v1/oauth2/token",

    {

      method: "POST",

      headers: {

        Authorization: `Basic ${credentials}`,

        "Content-Type": "application/x-www-form-urlencoded",

      },

      body: body.toString(),

    }

  );

  const text = await response.text();

  if (!response.ok) {

    throw new Error(

      `Token error (${response.status}): ${text}`

    );

  }

  const data = JSON.parse(text);

  return data.access_token as string;

}

export async function GET(request: NextRequest) {

  const { searchParams } = new URL(request.url);

  const q = searchParams.get("q");

  if (!q) {

    return NextResponse.json(

      {

        ok: false,

        error: "Escribe un artículo para buscar.",

      },

      { status: 400 }

    );

  }

  try {

    const token = await getApplicationToken();

    const url =

      "https://api.ebay.com/buy/browse/v1/item_summary/search" +

      `?q=${encodeURIComponent(q)}` +

      "&limit=50";

    const response = await fetch(url, {

      headers: {

        Authorization: `Bearer ${token}`,

        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",

      },

    });

    const text = await response.text();

    if (!response.ok) {

      return NextResponse.json(

        {

          ok: false,

          stage: "browse-api",

          status: response.status,

          ebayResponse: text,

        },

        { status: response.status }

      );

    }

    const data = JSON.parse(text);

    const items = Array.isArray(data.itemSummaries)

      ? data.itemSummaries

      : [];

    const prices = items

      .map((item: any) => Number(item?.price?.value))

      .filter((price: number) => Number.isFinite(price));

    const sorted = [...prices].sort((a, b) => a - b);

    const average =

      prices.length > 0

        ? prices.reduce((a, b) => a + b, 0) / prices.length

        : null;

    let median: number | null = null;

    if (sorted.length > 0) {

      const middle = Math.floor(sorted.length / 2);

      median =

        sorted.length % 2 === 0

          ? (sorted[middle - 1] + sorted[middle]) / 2

          : sorted[middle];

    }

    return NextResponse.json({

      ok: true,

      search: q,

      active: {

        totalReportedByEbay: data.total ?? null,

        sampleSize: prices.length,

        lowestPrice: sorted[0] ?? null,

        highestPrice:

          sorted.length > 0

            ? sorted[sorted.length - 1]

            : null,

        average:

          average !== null

            ? Number(average.toFixed(2))

            : null,

        median:

          median !== null

            ? Number(median.toFixed(2))

            : null,

      },

      sold: {

        tested: false,

        message:

          "Sold-history access will be tested next.",

      },

    });

  } catch (error) {

    console.error("[ebay/price-test]", error);

    return NextResponse.json(

      {

        ok: false,

        error:

          error instanceof Error

            ? error.message

            : "Unknown error",

      },

      { status: 500 }

    );

  }

}
