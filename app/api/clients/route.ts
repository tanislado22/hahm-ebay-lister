import { NextResponse } from "next/server";

export async function GET() {

  return NextResponse.json({

    success: true,

    clients: [],

  });

}

export async function POST(request: Request) {

  try {

    const body = await request.json();

    return NextResponse.json({

      success: true,

      client: body,

    });

  } catch {

    return NextResponse.json(

      { success: false, error: "Invalid request" },

      { status: 400 }

    );

  }

}

