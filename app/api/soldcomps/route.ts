import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {

  try {

    const apiToken = process.env.APIFY_API_TOKEN;

    if (!apiToken) {

      return NextResponse.json(

        { error: "APIFY_API_TOKEN is not configured" },

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

    const actorInput = {

      query: keyword,

      condition: "used",

      country: "US",

      maxResults: 20,

      soldWithinDays: 30,

      includeDetails: false,

      compact: false,

      incrementalMode: false,

      emitUnchanged: false,

      excludeEmptyFields: false,

      descriptionFormat: "all",

      freeShipping: false,

      returnsAccepted: false,

      skipReposts: false,

      maxPages: 5,

    };

    const response = await fetch(

      "https://api.apify.com/v2/acts/blackfalcondata~ebay-sold-listings-scraper/run-sync-get-dataset-items",

      {

        method: "POST",

        headers: {

          Authorization: `Bearer ${apiToken}`,

          "Content-Type": "application/json",

        },

        body: JSON.stringify(actorInput),

        cache: "no-store",

      }

    );

    const data = await response.json();

    if (!response.ok) {

      return NextResponse.json(

        {

          error: "Apify sold comps request failed",

          details: data,

        },

        { status: response.status }

      );

    }

    const rawItems = Array.isArray(data) ? data : [];
const searchWords = keyword

  .toLowerCase()

  .split(/\s+/)

  .filter((word) => word.length > 2);

const badTitlePattern = /\b(lot|bundle|bulk|wholesale|set of|lot of)\b/i;
    
    const items = rawItems

      .map((item: any) => {

        const rawPrice =

          item.priceValue ??

          item.soldPrice ??

          item.price ??

          null;

        const soldPrice =

          typeof rawPrice === "number"

            ? rawPrice

            : Number.parseFloat(String(rawPrice ?? ""));

        return {

          ...item,

          soldPrice,

          soldDate: item.soldDate ?? null,

          title: item.title ?? "",

          condition: item.condition ?? null,

          currency: item.priceCurrency ?? item.currency ?? "USD",

          url:

            item.canonicalUrl ??

            item.sourceUrl ??

            item.url ??

            null,

        };

      })

     .filter((item: any) => {

  const title = (item.title ?? "").toLowerCase();

  const query = keyword.toLowerCase();

  if (!Number.isFinite(item.soldPrice) || item.soldPrice <= 0) {

    return false;

  }

  if (badTitlePattern.test(title)) {

    return false;

  }

  if (

    query.includes("long sleeve") &&

    (title.includes("short sleeve") || title.includes("sleeveless"))

  ) {

    return false;

  }

  if (

    query.includes("short sleeve") &&

    (title.includes("long sleeve") || title.includes("sleeveless"))

  ) {

    return false;

  }

  if (

    query.includes("sleeveless") &&

    (title.includes("long sleeve") || title.includes("short sleeve"))

  ) {

    return false;

  }

  return true;

})

.sort((a: any, b: any) => {

  const aTitle = (a.title ?? "").toLowerCase();

  const bTitle = (b.title ?? "").toLowerCase();

  const query = keyword.toLowerCase();
  const queryWords = query.split(/\s+/);

const audienceIndex = queryWords.findIndex((word) =>

  /^(women|womens|men|mens|girls|boys|kids|youth|unisex)$/i.test(word)

);

const brandPhrase =

  audienceIndex > 0

    ? queryWords.slice(0, audienceIndex).join(" ")

    : queryWords[0] ?? "";

  const scoreTitle = (title: string) => {

    let score = 0;
if (brandPhrase && title.includes(brandPhrase)) {



  score += 8;



}
    // Coincidencia normal de palabras

    for (const word of searchWords) {

      if (title.includes(word)) score += 1;

    }

    // Características importantes reciben más peso

    const importantTerms = [

      "sheer",

      "blouse",

      "shirt",

      "top",

      "long sleeve",

      "short sleeve",

      "sleeveless",

      "polka dot",

      "floral",

      "plaid",

      "striped",

      "silk",

      "linen",

      "cami"

    ];

    for (const term of importantTerms) {

      if (query.includes(term) && title.includes(term)) {

        score += 3;

      }

    }

    // Penalizar características contradictorias

    if (query.includes("long sleeve") && title.includes("short sleeve")) score -= 5;

    if (query.includes("long sleeve") && title.includes("sleeveless")) score -= 5;

    if (query.includes("short sleeve") && title.includes("long sleeve")) score -= 5;

    if (query.includes("sleeveless") && title.includes("long sleeve")) score -= 5;

    return score;

  };

  return scoreTitle(bTitle) - scoreTitle(aTitle);

})

.slice(0, 10);

    const prices = items

      .map((item: any) => item.soldPrice)

      .sort((a: number, b: number) => a - b);

    const average =

      prices.length > 0

        ? prices.reduce(

            (sum: number, price: number) => sum + price,

            0

          ) / prices.length

        : null;

    const median =

      prices.length === 0

        ? null

        : prices.length % 2 === 1

        ? prices[Math.floor(prices.length / 2)]

        : (

            prices[prices.length / 2 - 1] +

            prices[prices.length / 2]

          ) / 2;

    return NextResponse.json({

      source: "soldcomps",

      provider: "apify",

      keyword,

      condition: "used",

      sampleSize: prices.length,

      low: prices.length ? prices[0] : null,

      high: prices.length

        ? prices[prices.length - 1]

        : null,

      average:

        average === null

          ? null

          : Number(average.toFixed(2)),

      median:

        median === null

          ? null

          : Number(median.toFixed(2)),

      items,

    });

  } catch (error) {

    console.error("Apify SoldComps API error:", error);

    return NextResponse.json(

      { error: "Unable to fetch sold comps data" },

      { status: 500 }

    );

  }

}

