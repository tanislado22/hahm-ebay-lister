import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {

  try {

    const body = await req.json();

    return NextResponse.json({

      success: true,

      message: "Draft route is working",

      sku: body.sku ?? null,

    });

  } catch (error) {

    return NextResponse.json(

      {

        success: false,

        error: (error as Error).message,

      },

      { status: 500 }

    );

  }

}
