import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {

  try {

    const apiKey = process.env.SOLDCOMPS_API_KEY;

    if (!apiKey) {

      return NextResponse.json(

        { error: "SOLDCOMPS_API_KEY is not configured" },

        { status: 500 }

      );

    }

    const { searchParams } = new URL(request.url);

    const keyword = searchParams.get("keyword")?.trim();

    if (!keyword) {

      return NextResponse.json(

        { error: "keyword is required" },

        { status: 400 }

      );

    }

    const params = new URLSearchParams({

      keyword,

      ebaySite: "ebay.com",

      page: "1",

      count: "50",

      itemCondition: "used",

      sold: "true",

      sortOrder: "endedRecently",

    });

    const response = await fetch(

      `https://api.sold-comps.com/v1/scrape?${params.toString()}`,

      {

        headers: {

          Authorization: `Bearer ${apiKey}`,

        },

        cache: "no-store",

      }

    );

    const data = await response.json();

    if (!response.ok) {

      return NextResponse.json(

        {

          error: "SoldComps request failed",

          details: data,

        },

        { status: response.status }

      );

    }

    const items = Array.isArray(data.items) ? data.items : [];

    const prices = items

      .map((item: any) => Number.parseFloat(item.soldPrice))

      .filter((price: number) => Number.isFinite(price) && price > 0)

      .sort((a: number, b: number) => a - b);

    const average =

      prices.length > 0

        ? prices.reduce((sum: number, price: number) => sum + price, 0) /

          prices.length

        : null;

    const median =

      prices.length === 0

        ? null

        : prices.length % 2 === 1

          ? prices[Math.floor(prices.length / 2)]

          : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;

    return NextResponse.json({

      source: "soldcomps",

      keyword,

      condition: "used",

      sampleSize: prices.length,

      low: prices.length ? prices[0] : null,

      high: prices.length ? prices[prices.length - 1] : null,

      average: average === null ? null : Number(average.toFixed(2)),

      median: median === null ? null : Number(median.toFixed(2)),

      items,

    });

  } catch (error) {

    console.error("SoldComps API error:", error);

    return NextResponse.json(

      { error: "Unable to fetch SoldComps data" },

      { status: 500 }

    );

  }

}
